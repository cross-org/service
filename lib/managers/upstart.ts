/**
 * Exports helper functions to install a command as a upstart service
 *
 * @file      lib/managers/upstart.ts
 * @license   MIT
 */

import { exists, mktempdir, unlink, writeFile } from "@cross/fs";
import { InstallServiceOptions, UninstallServiceOptions } from "../service.ts";
import { getEnv } from "@cross/env";
import { join } from "@std/path";
import { ServiceInstallResult, ServiceUninstallResult } from "../result.ts";

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

exec $SERVICE_COMMAND
`;

class UpstartService {
  /**
   * Generates the Upstart configuration file content based on the given options.
   * @param config - The configuration options for the service.
   * @returns The generated Upstart configuration file content.
   */
  generateConfig(config: InstallServiceOptions): string {
    const defaultPath = getEnv("PATH") || "";
    const envPath = config.path ? `${defaultPath}:${config.path.join(":")}` : defaultPath;

    let upstartFileContent = upstartFileTemplate.replace(
      /{{name}}/g,
      config.name,
    );
    upstartFileContent = upstartFileContent.replace(
      "{{command}}",
      config.cmd,
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

    const upstartFileContent = this.generateConfig(config);

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
      let manualSteps = "";
      manualSteps += "\Service installer do not have (and should not have) root permissions, so the next steps have to be carried out manually.";
      manualSteps += `\nStep 1: The upstart configuration has been saved to a temporary file, copy this file to the correct location using the following command:`;
      manualSteps += `\n  sudo cp ${tempFilePath} ${upstartFilePath}`;
      manualSteps += `\nStep 2: Start the service now`;
      manualSteps += `\n  sudo start ${config.name}\n`;
      return {
        servicePath: tempFilePath,
        serviceFileContent: upstartFileContent,
        manualSteps: manualSteps,
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
      return {
        servicePath: upstartFilePath,
        manualSteps: `Please run the following command as root to reload the systemctl daemon:\nsudo systemctl daemon-reload\nsudo stop ${config.name}`,
      };
    } catch (error) {
      throw new Error(
        `Failed to uninstall service: Could not remove '${upstartFilePath}'. Error: '${error.message}`,
      );
    }
  }
}

export { UpstartService };
