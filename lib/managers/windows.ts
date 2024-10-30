/**
 * Exports helper functions to install a command as a Windows service
 *
 * @file      lib/managers/windows.ts
 * @license   MIT
 */

import { exists, mkdir, unlink, writeFile } from "@cross/fs";
import { spawn } from "@cross/utils";
import { cwd } from "@cross/fs";
import type { InstallServiceOptions, UninstallServiceOptions } from "../service.ts";
import type { ServiceInstallResult, ServiceUninstallResult } from "../result.ts";
import { CurrentRuntime, Runtime } from "@cross/runtime";

class WindowsService {
  constructor() {}

  /**
   * Installs a command as a Windows service, checking for existing services with the same name.
   *
   * @async
   * @function install
   * @param {InstallServiceOptions} options - Options for the installService function.
   */
  async install(config: InstallServiceOptions, onlyGenerate: boolean): Promise<ServiceInstallResult> {
    const batchFileName = `${config.name}.bat`;
    const serviceBatchPath = `${config.home}/.service/${batchFileName}`;

    if (await exists(serviceBatchPath)) {
      throw new Error(`Service '${config.name}' already exists in '${serviceBatchPath}'.`);
    }

    const batchFileContent = await this.generateConfig(config);

    if (onlyGenerate) {
      return {
        servicePath: serviceBatchPath,
        serviceFileContent: batchFileContent,
        manualSteps: null,
      };
    } else {
      // Ensure that the service directory exists
      const serviceDirectory = `${config.home}/.service/`;
      if (!await exists(serviceDirectory)) {
        await mkdir(serviceDirectory, { recursive: true });
      }

      // Write configuration
      await writeFile(serviceBatchPath, batchFileContent);

      // Install the service
      // - Arguments to sc.exe while creating the service
      const scArgs = `create ${config.name} binPath="cmd.exe /C ${serviceBatchPath}" start= auto DisplayName= "${config.name}" obj= LocalSystem`;
      // - Arguments to powershell.exe while escalating sc.exe though powershell Start-Process -Verb RunAs
      const psAndArgs = [
        "powershell.exe",
        "-Command",
        "Start-Process",
        "sc.exe",
        "-ArgumentList",
        `'${scArgs}'`,
        "-Verb",
        "RunAs",
      ];
      const installService = await spawn(psAndArgs);
      if (installService.code !== 0) {
        await this.rollback(serviceBatchPath);
        throw new Error("Failed to install service. Error: \n" + installService.stdout + installService.stderr);
      }
      return {
        servicePath: serviceBatchPath,
        serviceFileContent: batchFileContent,
        manualSteps: null,
      };
    }
  }

  /**
   * Uninstalls a Windows service by removing the batch file.
   * Checks if the service exists and removes it if found.
   *
   * @async
   * @function uninstall
   * @param {UninstallServiceOptions} config - Options for the uninstallService function.
   * @throws Will throw an error if unable to remove the batch file.
   */
  async uninstall(config: UninstallServiceOptions): Promise<ServiceUninstallResult> {
    const batchFileName = `${config.name}.bat`;
    const serviceBatchPath = `${config.home}/.service/${batchFileName}`;

    // Check if the service exists
    if (!await exists(serviceBatchPath)) {
      throw new Error(`Service '${config.name}' does not exist.`);
    }

    // Try to remove service
    // - Arguments to sc.exe while creating the service
    const scArgs = `delete ${config.name}`;
    // - Arguments to powershell.exe while escalating sc.exe though powershell Start-Process -Verb RunAs
    const psArgs = [
      "powershell.exe",
      "-Command",
      "Start-Process",
      "sc.exe",
      "-ArgumentList",
      `'${scArgs}'`,
      "-Verb",
      "RunAs",
    ];
    const uninstallService = await spawn(psArgs);
    if (uninstallService.code !== 0) {
      await this.rollback(serviceBatchPath);
      throw new Error("Failed to uninstall service. Error: \n" + uninstallService.stderr);
    }
    try {
      await unlink(serviceBatchPath);
      return {
        servicePath: config.name,
        manualSteps: null,
      };
    } catch (error) {
      throw new Error(`Failed to uninstall service: Could not remove '${serviceBatchPath}'. Error: '${(error as Error).message}'`);
    }
  }

  /**
   * Generates a batch file content as a string based on the given options.
   *
   * @param {InstallServiceOptions} options - The options used to generate the batch file.
   * @returns {string} The generated batch file content as a string.
   */
  async generateConfig(options: InstallServiceOptions): Promise<string> {
    let defaultPath = "%PATH%;";
    if (CurrentRuntime === Runtime.Deno) {
      const denoPath = Deno.execPath();
      defaultPath += `${denoPath};${options.home}\\.deno\\bin`;
    }
    const envPath = options.path ? `${defaultPath};${options.path.join(";")}` : defaultPath;
    const workingDirectory = options.cwd ? options.cwd : cwd();

    let batchFileContent = `@echo off\n`;
    batchFileContent += `cd "${workingDirectory}"\n`;
    batchFileContent += `set "PATH=${envPath}"\n`;

    // Add extra environment variables
    if (options.env && options.env.length > 0) {
      for (const env of options.env) {
        batchFileContent += `set "${env}"\n`;
      }
    }

    batchFileContent += `deno run -A --unstable https://deno.land/x/windows_service@1.0.11/run.ts --serviceName ${options.name} -- ${options.cmd}\n`;
    await true;

    return batchFileContent;
  }

  /**

    Rolls back any changes made during the Windows service installation process
    by removing the batch file.
    @function rollback
    @param {string} serviceBatchPath - The path of the batch file to be removed.
    */
  private async rollback(serviceBatchPath: string) {
    try {
      await unlink(serviceBatchPath);
    } catch (error) {
      console.error(`Failed to rollback changes: Could not remove '${serviceBatchPath}'. Error:`, (error as Error).message);
    }
  }
}
export { WindowsService };
