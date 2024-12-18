/**
 * Exports helper functions to install a command as a upstart service
 *
 * @file      lib/managers/upstart.ts
 * @license   MIT
 */

import { cwd, exists, mktempdir, unlink, writeFile } from "@cross/fs";
import { dirname, join } from "@std/path";
import { resolvedExecPath } from "@cross/utils";
import type { InstallServiceOptions, UninstallServiceOptions } from "../service.ts";
import type { ServiceInstallResult, ServiceManualStep, ServiceUninstallResult } from "../result.ts";

const upstartFileTemplate = `# {{name}} (Deno Service)

description "{{name}} Deno Service"
author "Service user"

start on (filesystem and net-device-up IFACE!=lo)
stop on runlevel [!2345]

respawn
respawn limit 10 5

env PATH={{path}}
{{extraEnvs}}

# Change the next line to match your service installation
env SERVICE_COMMAND="{{command}}"

chdir {{workingDirectory}}

exec $SERVICE_COMMAND

console log
`;

class UpstartService {
  /**
   * Generates the Upstart configuration file content based on the given options.
   * @param config - The configuration options for the service.
   * @returns The generated Upstart configuration file content.
   */
  async generateConfig(config: InstallServiceOptions): Promise<string> {
    const runtimePath = await resolvedExecPath();
    const runtimeDir = dirname(runtimePath);
    const envPath = config.path?.length ? `${config.path?.join(":")}:${runtimeDir}` : runtimeDir;
    const workingDirectory = config.cwd ? config.cwd : cwd();

    let upstartFileContent = upstartFileTemplate.replace(
      /{{name}}/g,
      config.name,
    );
    upstartFileContent = upstartFileContent.replace(
      "{{command}}",
      config.cmd,
    );
    upstartFileContent = upstartFileContent.replace(
      "{{workingDirectory}}",
      workingDirectory,
    );
    upstartFileContent = upstartFileContent.replace("{{path}}", envPath);

    // Add extra environment variables
    if (config.env && config.env.length > 0) {
      let extraEnvs = "";
      for (const env of config.env) {
        extraEnvs += `env ${env}\n`;
      }
      upstartFileContent = upstartFileContent.replace("{{extraEnvs}}", extraEnvs);
    } else {
      upstartFileContent = upstartFileContent.replace("{{extraEnvs}}", "");
    }

    return upstartFileContent;
  }

  /**
   * Installs the service based on the given options.
   * @param config - The configuration options for the service.
   * @param onlyGenerate - A flag indicating whether to only generate the configuration or
   * also install the service.
   */
  async install(config: InstallServiceOptions, onlyGenerate: boolean): Promise<ServiceInstallResult> {
    const upstartFilePath = `/etc/init/${config.name}.conf`;

    if (await exists(upstartFilePath)) {
      throw new Error(`Service '${config.name}' already exists in '${upstartFilePath}'.`);
    }

    const upstartFileContent = await this.generateConfig(config);

    if (onlyGenerate) {
      return {
        servicePath: upstartFilePath,
        serviceFileContent: upstartFileContent,
        manualSteps: null,
      };
    } else {
      // Store temporary file
      const tempFileDir = await mktempdir("svc-installer");
      const tempFilePath = join(tempFileDir, "svc-upstart");
      await writeFile(tempFilePath, upstartFileContent);
      const manualSteps: ServiceManualStep[] = [];
      manualSteps.push({
        text: "The Upstart configuration has been saved to a temporary file. Copy this file to the correct location using the following command:",
        command: `sudo cp ${tempFilePath} ${upstartFilePath}`,
      });
      manualSteps.push({
        text: "Start the service now:",
        command: `sudo start ${config.name}`,
      });

      return {
        servicePath: tempFilePath,
        serviceFileContent: upstartFileContent,
        manualSteps: manualSteps, // Assign structured steps
      };
    }
  }

  /**
   * Uninstalls the service based on the given options.
   * @param config - The configuration options for uninstalling the service.
   */
  async uninstall(config: UninstallServiceOptions): Promise<ServiceUninstallResult> {
    const upstartFilePath = `/etc/init/${config.name}.conf`;

    // Check if the service exists
    if (!await exists(upstartFilePath)) {
      throw new Error(`Service '${config.name}' does not exist.`);
    }

    try {
      await unlink(upstartFilePath);
      const manualSteps: ServiceManualStep[] = [];
      const reloadCommand = `sudo stop ${config.name}`;
      manualSteps.push({
        text: `Please run the following commands as root to stop the service and reload the systemctl daemon:`,
        command: reloadCommand,
      });
      return {
        servicePath: upstartFilePath,
        manualSteps: manualSteps, // Assign structured steps
      };
    } catch (error) {
      throw new Error(
        `Failed to uninstall service: Could not remove '${upstartFilePath}'. Error: '${(error as Error).message}`,
      );
    }
  }
}

export { UpstartService };
