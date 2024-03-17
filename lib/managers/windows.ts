/**
 * Exports helper functions to install a command as a Windows service
 *
 * @file      lib/managers/windows.ts
 * @license   MIT
 */

import { existsSync } from "../../deps.ts"
import { InstallServiceOptions, UninstallServiceOptions } from "../service.ts"

class WindowsService {
  constructor() {}

  /**
   * Installs a command as a Windows service, checking for existing services with the same name.
   *
   * @async
   * @function install
   * @param {InstallServiceOptions} options - Options for the installService function.
   */
  async install(config: InstallServiceOptions, onlyGenerate: boolean) {
    const batchFileName = `${config.name}.bat`
    const serviceBatchPath = `${config.home}/.service/${batchFileName}`

    if (existsSync(serviceBatchPath)) {
      console.error(
        `Service '${config.name}' already exists in '${serviceBatchPath}'. Exiting.`,
      )
      Deno.exit(1)
    }

    const batchFileContent = this.generateConfig(config)

    if (onlyGenerate) {
      console.log("\nThis is a dry-run, nothing will be written to disk or installed.")
      console.log("\nPath: ", serviceBatchPath)
      console.log("\nConfiguration:\n")
      console.log(batchFileContent)
    } else {
      // Ensure that the service directory exists
      const serviceDirectory = `${config.home}/.service/`
      if (!existsSync(serviceDirectory)) {
        await Deno.mkdir(serviceDirectory, { recursive: true })
      }

      // Write configuration
      await Deno.writeTextFile(serviceBatchPath, batchFileContent)

      // Install the service
      // - Arguments to sc.exe while creating the service
      const scArgs = `create ${config.name} binPath="cmd.exe /C ${serviceBatchPath}" start= auto DisplayName= "${config.name}" obj= LocalSystem`
      // - Arguments to powershell.exe while escalating sc.exe though powershell Start-Process -Verb RunAs
      const psArgs = [
        "-Command",
        "Start-Process",
        "sc.exe",
        "-ArgumentList",
        `'${scArgs}'`,
        "-Verb",
        "RunAs",
      ]
      const installServiceCommand = new Deno.Command("powershell.exe", {
        args: psArgs,
        stderr: "piped",
        stdout: "piped",
      })
      const installService = installServiceCommand.spawn()
      installService.ref()
      const installServiceOutput = await installService.output()
      const installServiceText = new TextDecoder().decode(installServiceOutput.stderr)
      if (!installServiceOutput.success) {
        await this.rollback(serviceBatchPath)
        throw new Error("Failed to install service. Error: \n" + installServiceText)
      }

      console.log(`Service '${config.name}' installed at '${serviceBatchPath}' and enabled.`)
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
  async uninstall(config: UninstallServiceOptions) {
    const batchFileName = `${config.name}.bat`
    const serviceBatchPath = `${config.home}/.service/${batchFileName}`

    // Check if the service exists
    if (!existsSync(serviceBatchPath)) {
      console.error(`Service '${config.name}' does not exist. Exiting.`)
      Deno.exit(1)
    }

    // Try to remove service
    // - Arguments to sc.exe while creating the service
    const scArgs = `delete ${config.name}`
    // - Arguments to powershell.exe while escalating sc.exe though powershell Start-Process -Verb RunAs
    const psArgs = [
      "-Command",
      "Start-Process",
      "sc.exe",
      "-ArgumentList",
      `'${scArgs}'`,
      "-Verb",
      "RunAs",
    ]
    const uninstallServiceCommand = new Deno.Command("powershell.exe", {
      args: psArgs,
      stderr: "piped",
      stdout: "piped",
    })
    const uninstallService = uninstallServiceCommand.spawn()
    uninstallService.ref()
    const uninstallServiceOutput = await uninstallService.output()
    const uninstallServiceText = new TextDecoder().decode(uninstallServiceOutput.stderr)
    if (!uninstallServiceOutput.success) {
      await this.rollback(serviceBatchPath)
      throw new Error("Failed to uninstall service. Error: \n" + uninstallServiceText)
    }

    try {
      await Deno.remove(serviceBatchPath)
      console.log(`Service '${config.name}' uninstalled successfully.`)
    } catch (error) {
      console.error(`Failed to uninstall service: Could not remove '${serviceBatchPath}'. Error:`, error.message)
    }
  }

  /**
   * Generates a batch file content as a string based on the given options.
   *
   * @param {InstallServiceOptions} options - The options used to generate the batch file.
   * @returns {string} The generated batch file content as a string.
   */
  generateConfig(options: InstallServiceOptions): string {
    const denoPath = Deno.execPath()
    const defaultPath = `%PATH%;${denoPath};${options.home}\\.deno\\bin`
    const envPath = options.path ? `${defaultPath};${options.path.join(";")}` : defaultPath
    const workingDirectory = options.cwd ? options.cwd : Deno.cwd()

    let batchFileContent = `@echo off\n`
    batchFileContent += `cd "${workingDirectory}"\n`
    batchFileContent += `set "PATH=${envPath}"\n`

    // Add extra environment variables
    if (options.env && options.env.length > 0) {
      for (const env of options.env) {
        batchFileContent += `set "${env}"\n`
      }
    }

    batchFileContent += `"${denoPath}" run -A --allow-ffi --unstable https://deno.land/x/windows_service@1.0.11/run.ts --serviceName ${options.name} -- ${options.cmd}\n`

    return batchFileContent
  }

  /**

    Rolls back any changes made during the Windows service installation process
    by removing the batch file.
    @function rollback
    @param {string} serviceBatchPath - The path of the batch file to be removed.
    */
  private async rollback(serviceBatchPath: string) {
    try {
      await Deno.remove(serviceBatchPath)
      console.log(`Changes rolled back: Removed '${serviceBatchPath}'.`)
    } catch (error) {
      console.error(`Failed to rollback changes: Could not remove '${serviceBatchPath}'. Error:`, error.message)
    }
  }
}
export { WindowsService }
