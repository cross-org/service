/**
 * Exports helper functions to install a command as a systemd service
 *
 * @file      lib/managers/systemd.ts
 * @license   MIT
 */

import { cwd, exists, mkdir, mktempdir, unlink, writeFile } from "@cross/fs";
import { dirname, join } from "@std/path";
import { resolvedExecPath, spawn } from "@cross/utils";
import type { ServiceInstallResult, ServiceManualStep, ServiceUninstallResult } from "../result.ts";
import type { InstallServiceOptions, UninstallServiceOptions } from "../service.ts";

const serviceFileTemplate = `[Unit]
Description={{name}} (Deno Service)

[Service]
ExecStart=/bin/sh -c "{{command}}"
Restart=always
RestartSec=30
Environment={{path}}
{{extraEnvs}}
WorkingDirectory={{workingDirectory}}
{{extraServiceContent}}

[Install]
WantedBy={{wantedByTarget}}
`;

class SystemdService {
  constructor() {}

  /**
   * Installs a command as a systemd service, checking for existing services with the same name
   * and enabling linger if running in user mode.
   *
   * @async
   * @function install
   * @param options - Options for the installService function.
   */
  async install(config: InstallServiceOptions, onlyGenerate: boolean): Promise<ServiceInstallResult> {
    const serviceFileName = `${config.name}.service`;

    const servicePathUser = `${config.home}/.config/systemd/user/${serviceFileName}`;
    const servicePathSystem = `/etc/systemd/system/${serviceFileName}`;
    const servicePath = config.system ? servicePathSystem : servicePathUser;

    if (await exists(servicePathUser)) {
      throw new Error(`Service '${config.name}' already exists in '${servicePathUser}'.`);
    }
    if (await exists(servicePathSystem)) {
      throw new Error(`Service '${config.name}' already exists in '${servicePathSystem}'.`);
    }

    // Automatically enable linger for current user using loginctl if running in user mode
    if (!config.system && !onlyGenerate) {
      if (!config.user) {
        throw new Error("Username not found in $USER, must be specified using the --username flag or via the user option.");
      }
      const enableLinger = await spawn(["loginctl", "enable-linger", config.user]);
      if (enableLinger.code !== 0) {
        throw new Error("Failed to enable linger for user mode.");
      }
    }

    const serviceFileContent = await this.generateConfig(config);

    if (onlyGenerate) {
      return {
        servicePath,
        serviceFileContent,
        manualSteps: null,
      };
    } else if (config.system) {
      // Store temporary file
      const tempFilePath = await mktempdir("svcinstall");
      const tempFileFullPath = join(tempFilePath, "cfg");
      await writeFile(tempFileFullPath, serviceFileContent);
      const manualSteps: ServiceManualStep[] = [];
      manualSteps.push({
        text: "The systemd configuration has been saved to a temporary file. Copy this file to the correct location using the following command:",
        command: `sudo cp ${tempFileFullPath} ${servicePath}`,
      });
      manualSteps.push({
        text: "Reload the systemd configuration:",
        command: `sudo systemctl daemon-reload`,
      });
      manualSteps.push({
        text: "Enable the service:",
        command: `sudo systemctl enable ${config.name}`,
      });
      manualSteps.push({
        text: "Start the service now:",
        command: `sudo systemctl start ${config.name}`,
      });
      return {
        servicePath: tempFilePath,
        serviceFileContent,
        manualSteps: manualSteps,
      };
    } else {
      // Ensure directory of servicePath exists
      const serviceDir = dirname(servicePath);
      await mkdir(serviceDir, { recursive: true });

      // Write configuration
      await writeFile(servicePath, serviceFileContent);

      // Run systemctl daemon-reload
      const daemonReload = await spawn(["systemctl", config.system ? "" : "--user", "daemon-reload"]);
      if (daemonReload.code !== 0) {
        await this.rollback(servicePath, config.system);
        throw new Error("Failed to reload daemon, rolled back any changes. Error: \n" + daemonReload.stderr);
      }

      // Run systemctl enable
      const enableService = await spawn(["systemctl", config.system ? "" : "--user", "enable", config.name]);
      if (enableService.code !== 0) {
        await this.rollback(servicePath, config.system);
        throw new Error("Failed to enable service, rolled back any changes. Error: \n" + enableService.stderr);
      }

      // Run systemctl start
      const startServiceCommand = await spawn(["systemctl", config.system ? "" : "--user", "start", config.name]);
      if (startServiceCommand.code !== 0) {
        await this.rollback(servicePath, config.system);
        throw new Error("Failed to start service, rolled back any changes. Error: \n" + startServiceCommand.stdout);
      }
      return {
        servicePath,
        serviceFileContent,
        manualSteps: null,
      };
    }
  }
  /**
   * Uninstalls a systemd service by removing the service file.
   * Checks if the service exists and removes it if found.
   *
   * @async
   * @function uninstallService
   * @param config - Options for the uninstallService function.
   * @throws Will throw an error if unable to remove the service file.
   */
  async uninstall(config: UninstallServiceOptions): Promise<ServiceUninstallResult> {
    const serviceFileName = `${config.name}.service`;

    // Different paths for user and system mode
    const servicePathUser = `${config.home}/.config/systemd/user/${serviceFileName}`;
    const servicePathSystem = `/etc/systemd/system/${serviceFileName}`;
    const servicePath = config.system ? servicePathSystem : servicePathUser;

    // Check if the service exists
    if (!await exists(servicePath)) {
      throw new Error(`Service '${config.name}' does not exist.`);
    }
    try {
      const manualSteps: ServiceManualStep[] = [];
      if (config.system) {
        const removeCommand = `sudo rm ${servicePathSystem}`;
        const stopCommand = `sudo systemctl stop ${config.name}`;
        const reloadCommand = "sudo systemctl daemon-reload";
        manualSteps.push(
          {
            text: `Please run this command to stop the service:`,
            command: stopCommand,
          },
          {
            text: `Please run the following command to remove the service:`,
            command: removeCommand,
          },
          {
            text: `And this command to reload the systemctl daemon:`,
            command: reloadCommand,
          },
        );
      } else {
        const stopServiceCommand = await spawn(["systemctl", "--user", "stop", config.name]);
        await unlink(servicePath);
        const reloadServiceCommand = await spawn(["systemctl", "--user", "daemon-reload"]);
        if (!(stopServiceCommand.code === 0 && reloadServiceCommand.code === 0)) {
          throw new Error("Could not remove the service.");
        }
      }
      return {
        servicePath,
        manualSteps: manualSteps,
      };
    } catch (error) {
      throw new Error(`Failed to uninstall service: Could not remove '${servicePath}'. Error: '${(error as Error).message}'`);
    }
  }

  /**
   * Generates a systemd service configuration file content as a string based on the given options.
   *
   * @param {InstallServiceOptions} options - The options used to generate the systemd service configuration file.
   * @returns {string} The generated systemd service configuration file content as a string.
   */
  async generateConfig(options: InstallServiceOptions): Promise<string> {
    const runtimePath = await resolvedExecPath();
    const runtimeDir = dirname(runtimePath);
    const envPath = "PATH=" + (options.path?.length ? `${options.path?.join(":")}:${runtimeDir}` : runtimeDir);
    const workingDirectory = options.cwd ? options.cwd : cwd();

    let serviceFileContent = serviceFileTemplate.replace("{{name}}", options.name);
    serviceFileContent = serviceFileContent.replace("{{command}}", options.cmd);
    serviceFileContent = serviceFileContent.replace("{{path}}", envPath);
    serviceFileContent = serviceFileContent.replace("{{workingDirectory}}", workingDirectory);

    // Add user to service file if running in system mode
    if (options.system) {
      serviceFileContent = serviceFileContent.replace("{{extraServiceContent}}", `User=${options.user}`);
      serviceFileContent = serviceFileContent.replace("{{wantedByTarget}}", "multi-user.target");
    } else {
      serviceFileContent = serviceFileContent.replace("{{extraServiceContent}}", "");
      serviceFileContent = serviceFileContent.replace("{{wantedByTarget}}", "default.target");
    }

    // Add extra environment variables
    if (options.env && options.env.length > 0) {
      let extraEnvs = "";
      for (const env of options.env) {
        extraEnvs += `Environment=${env}\n`;
      }
      serviceFileContent = serviceFileContent.replace("{{extraEnvs}}", extraEnvs);
    } else {
      serviceFileContent = serviceFileContent.replace("{{extraEnvs}}", "");
    }

    return serviceFileContent;
  }

  /**
   * Rolls back any changes made during the systemd service installation process
   * by removing the service file.
   * @function rollbac
   * @param {string} servicePath - The path of the service file to be removed.
   * @param {boolean} system - Whether the service is installed in system mode.
   */
  private async rollback(servicePath: string, system: boolean) {
    try {
      await unlink(servicePath);
      const daemonReload = await spawn(["systemctl", system ? "" : "--user", "daemon-reload"]);
      if (daemonReload.code !== 0) {
        throw new Error("Failed to reload daemon while rolling back.");
      }
    } catch (error) {
      throw new Error(`Failed to rollback changes: Could not remove '${servicePath}'. Error: '${(error as Error).message}'`);
    }
  }
}

export { SystemdService };
