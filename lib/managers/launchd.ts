/**
 * Exports helper functions to install a command as a launchd service
 *
 * @file      lib/managers/launchd.ts
 * @license   MIT
 */
import { exists, mkdir, unlink, writeFile } from "@cross/fs";
import { InstallServiceOptions, UninstallServiceOptions } from "../service.ts";
import { dirname } from "@std/path";
import { cwd } from "@cross/utils";
import { getEnv } from "@cross/env";
import { ServiceInstallResult, ServiceUninstallResult } from "../result.ts";

const plistTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>{{name}}</string>
    <key>ProgramArguments</key>
    <array>
{{command}}    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>{{path}}</string>
{{extraEnvs}}    </dict>
    <key>WorkingDirectory</key>
    <string>{{workingDirectory}}</string>
    <key>KeepAlive</key>
    <true/>
  </dict>
</plist>
`;

class LaunchdService {
  /**
   * Generates a Launchd plist configuration file content as a string based on the given options.
   *
   * @param {InstallServiceOptions} options - The options used to generate the Launchd plist configuration file.
   * @returns {string} The generated Launchd plist configuration file content as a string.
   */
  generateConfig(options: InstallServiceOptions): string {
    const commandArgs = options.cmd.split(" ");
    const servicePath = `${options.path?.join(":")}:${getEnv("PATH")}`;
    const workingDirectory = options.cwd ? options.cwd : cwd();

    let plistContent = plistTemplate.replace(/{{name}}/g, options.name);
    plistContent = plistContent.replace(/{{path}}/g, servicePath);
    plistContent = plistContent.replace(/{{workingDirectory}}/g, workingDirectory);

    let programArguments = "";
    for (const arg of commandArgs) {
      programArguments += `      <string>${arg}</string>\n`;
    }
    plistContent = plistContent.replace("{{command}}", programArguments);

    // Add extra environment variables
    if (options.env && options.env.length > 0) {
      let extraEnvs = "";
      for (const env of options.env) {
        const envSplit = env.split("=");
        extraEnvs += `      <key>${envSplit[0]}</key>\n      <string>${envSplit[1]}</string>\n`;
      }
      plistContent = plistContent.replace("{{extraEnvs}}", extraEnvs);
    } else {
      plistContent = plistContent.replace("{{extraEnvs}}", "");
    }

    return plistContent;
  }

  async install(config: InstallServiceOptions, onlyGenerate: boolean): Promise<ServiceInstallResult> {
    const plistFileName = `${config.name}.plist`;

    // Different paths for user and system mode
    const plistPathUser = `${config.home}/Library/LaunchAgents/${plistFileName}`;
    const plistPathSystem = `/Library/LaunchDaemons/${plistFileName}`;
    const plistPath = config.system ? plistPathSystem : plistPathUser;

    // Do not allow to overwrite existing services, regardless of mode
    if (await exists(plistPathUser) || await exists(plistPathSystem)) {
      throw new Error(`Service '${config.name}' already exists.`);
    }

    const plistContent = this.generateConfig(config);

    if (onlyGenerate) {
      return {
        servicePath: plistPath,
        serviceFileContent: plistContent,
        manualSteps: null,
      };
    } else {
      const plistDir = dirname(plistPath);
      await mkdir(plistDir, { recursive: true });

      // ToDo: Remember to rollback on failure
      await writeFile(plistPath, plistContent);

      // ToDo: Actually run the service and verify that it works, if not - use the rollback function
      let manualSteps = "";
      if (config.system) {
        manualSteps += "Please run the following command as root to load the service:";
        manualSteps += `sudo launchctl load ${plistPath}`;
      } else {
        manualSteps += "Please run the following command to load the service:";
        manualSteps += `launchctl load ${plistPath}`;
      }

      return {
        servicePath: plistPath,
        serviceFileContent: plistContent,
        manualSteps,
      };
    }
  }

  /**

  * Rolls back any changes made during the launchd service installation process
  * by removing the plist file.
  * @param {string} plistPath - The path of the plist file to be removed.
  */
  async rollback(plistPath: string) {
    try {
      await unlink(plistPath);
    } catch (error) {
      throw new Error(`Failed to rollback changes: Could not remove '${plistPath}'. Error: ${error.message}`);
    }
  }

  /**
   * Uninstalls a Launchd service by removing the service configuration file (plist).
   * Checks if the service exists and removes it if found.
   * @param {UninstallServiceOptions} config - Options for the uninstallService function.
   * @throws Will throw an error if unable to remove the service configuration file.
   */
  async uninstall(config: UninstallServiceOptions): Promise<ServiceUninstallResult> {
    const plistFileName = `${config.name}.plist`;
    // Different paths for user and system mode
    const plistPathUser = `${config.home}/Library/LaunchAgents/${plistFileName}`;
    const plistPathSystem = `/Library/LaunchDaemons/${plistFileName}`;
    const plistPath = config.system ? plistPathSystem : plistPathUser;

    // Check if the service exists
    if (!await exists(plistPath)) {
      throw new Error(`Service '${config.name}' does not exist.`);
    }

    try {
      await unlink(plistPath);

      // Unload the service
      let manualSteps = "";
      if (config.system) {
        manualSteps += "Please run the following command as root to unload the service (if it's running):";
        manualSteps += `sudo launchctl unload ${plistPath}`;
      } else {
        manualSteps += "Please run the following command to unload the service (if it's running):";
        manualSteps += `launchctl unload ${plistPath}`;
      }

      return {
        servicePath: plistPath,
        manualSteps,
      };
    } catch (error) {
      throw new Error(`Failed to uninstall service: Could not remove '${plistPath}'. Error:`, error.message);
    }
  }
}

export { LaunchdService };
