/**
 * Exports helper functions to install a command as a systemd service
 *
 * @file      lib/managers/systemd.ts
 * @license   MIT
 */

import { exists } from "../utils/exists.ts"
import { InstallServiceOptions, UninstallServiceOptions } from "../service.ts"
import { dirname, join } from "@std/path"
import { cwd, exit, spawn } from "@cross/utils"
import { mkdir, mkdtemp, unlink, writeFile } from "node:fs/promises"

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
`

class SystemdService {
  constructor() {}

  /**
   * Installs a command as a systemd service, checking for existing services with the same name
   * and enabling linger if running in user mode.
   *
   * @async
   * @function install
   * @param {InstallServiceOptions} options - Options for the installService function.
   */
  async install(config: InstallServiceOptions, onlyGenerate: boolean) {
    const serviceFileName = `${config.name}.service`

    const servicePathUser = `${config.home}/.config/systemd/user/${serviceFileName}`
    const servicePathSystem = `/etc/systemd/system/${serviceFileName}`
    const servicePath = config.system ? servicePathSystem : servicePathUser

    if (await exists(servicePathUser)) {
      console.error(`Service '${config.name}' already exists in '${servicePathUser}'. Exiting.`)
      exit(1)
    }
    if (await exists(servicePathSystem)) {
      console.error(`Service '${config.name}' already exists in '${servicePathSystem}'. Exiting.`)
      exit(1)
    }

    // Automatically enable linger for current user using loginctl if running in user mode
    if (!config.system && !onlyGenerate) {
      if (!config.user) {
        throw new Error("Username not found in $USER, must be specified using the --username flag.")
      }
      const enableLinger = await spawn(["loginctl", "enable-linger", config.user])
      if (!enableLinger.code) {
        throw new Error("Failed to enable linger for user mode.")
      }
    }

    const serviceFileContent = this.generateConfig(config)

    if (onlyGenerate) {
      console.log("\nThis is a dry-run, nothing will be written to disk or installed.")
      console.log("\nPath: ", servicePath)
      console.log("\nConfiguration:\n")
      console.log(serviceFileContent)
    } else if (config.system) {
      // Store temporary file
      const tempFilePath = await mkdtemp("svcinstall")
      await writeFile(join(tempFilePath, "cfg"), serviceFileContent)

      console.log("\Service installer do not have (and should not have) root permissions, so the next steps have to be carried out manually.")
      console.log(`\nStep 1: The systemd configuration has been saved to a temporary file, copy this file to the correct location using the following command:`)
      console.log(`\n  sudo cp ${tempFilePath} ${servicePath}`)
      console.log(`\nStep 2: Reload systemd configuration`)
      console.log(`\n  sudo systemctl daemon-reload`)
      console.log(`\nStep 3: Enable the service`)
      console.log(`\n  sudo systemctl enable ${config.name}`)
      console.log(`\nStep 4: Start the service now`)
      console.log(`\n  sudo systemctl start ${config.name}\n`)
    } else {
      // Ensure directory of servicePath exists
      const serviceDir = dirname(servicePath)
      await mkdir(serviceDir, { recursive: true })

      // Write configuration
      await writeFile(servicePath, serviceFileContent)

      // Run systemctl daemon-reload
      const daemonReload = await spawn(["systemctl", config.system ? "" : "--user", "daemon-reload"])
      if (daemonReload.code !== 0) {
        await this.rollback(servicePath, config.system)
        throw new Error("Failed to reload daemon, rolled back any changes. Error: \n" + daemonReload.stderr)
      }

      // Run systemctl enable
      const enableService = await spawn(["systemctl", config.system ? "" : "--user", "enable", config.name])
      if (enableService.code !== 0) {
        await this.rollback(servicePath, config.system)
        throw new Error("Failed to enable service, rolled back any changes. Error: \n" + enableService.stderr)
      }

      // Run systemctl start
      const startServiceCommand = await spawn(["systemctl", config.system ? "" : "--user", "start", config.name])
      if (startServiceCommand.code !== 0) {
        await this.rollback(servicePath, config.system)
        throw new Error("Failed to start service, rolled back any changes. Error: \n" + startServiceCommand.stdout)
      }

      console.log(`Service '${config.name}' installed at '${servicePath}' and enabled.`)
    }
  }
  /**
   * Uninstalls a systemd service by removing the service file.
   * Checks if the service exists and removes it if found.
   *
   * @async
   * @function uninstallService
   * @param {UninstallServiceOptions} config - Options for the uninstallService function.
   * @throws Will throw an error if unable to remove the service file.
   */
  async uninstall(config: UninstallServiceOptions) {
    const serviceFileName = `${config.name}.service`

    // Different paths for user and system mode
    const servicePathUser = `${config.home}/.config/systemd/user/${serviceFileName}`
    const servicePathSystem = `/etc/systemd/system/${serviceFileName}`
    const servicePath = config.system ? servicePathSystem : servicePathUser

    // Check if the service exists
    if (!await exists(servicePath)) {
      console.error(`Service '${config.name}' does not exist. Exiting.`)
      exit(1)
    }

    try {
      await unlink(servicePath)
      console.log(`Service '${config.name}' uninstalled successfully.`)

      if (config.system) {
        console.log("Please run the following command as root to reload the systemctl daemon:")
        console.log(`sudo systemctl daemon-reload`)
      } else {
        console.log("Please run the following command to reload the systemctl daemon:")
        console.log(`systemctl --user daemon-reload`)
      }
    } catch (error) {
      console.error(`Failed to uninstall service: Could not remove '${servicePath}'. Error:`, error.message)
    }
  }

  /**
   * Generates a systemd service configuration file content as a string based on the given options.
   *
   * @param {InstallServiceOptions} options - The options used to generate the systemd service configuration file.
   * @returns {string} The generated systemd service configuration file content as a string.
   */
  generateConfig(options: InstallServiceOptions): string {
    const denoPath = Deno.execPath()
    const defaultPath = `PATH=${denoPath}:${options.home}/.deno/bin`
    const envPath = options.path ? `${defaultPath}:${options.path.join(":")}` : defaultPath
    const workingDirectory = options.cwd ? options.cwd : cwd()

    let serviceFileContent = serviceFileTemplate.replace("{{name}}", options.name)
    serviceFileContent = serviceFileContent.replace("{{command}}", options.cmd)
    serviceFileContent = serviceFileContent.replace("{{path}}", envPath)
    serviceFileContent = serviceFileContent.replace("{{workingDirectory}}", workingDirectory)

    // Add user to service file if running in system mode
    if (options.system) {
      serviceFileContent = serviceFileContent.replace("{{extraServiceContent}}", `User=${options.user}`)
      serviceFileContent = serviceFileContent.replace("{{wantedByTarget}}", "multi-user.target")
    } else {
      serviceFileContent = serviceFileContent.replace("{{extraServiceContent}}", "")
      serviceFileContent = serviceFileContent.replace("{{wantedByTarget}}", "default.target")
    }

    // Add extra environment variables
    if (options.env && options.env.length > 0) {
      let extraEnvs = ""
      for (const env of options.env) {
        extraEnvs += `Environment=${env}\n`
      }
      serviceFileContent = serviceFileContent.replace("{{extraEnvs}}", extraEnvs)
    } else {
      serviceFileContent = serviceFileContent.replace("{{extraEnvs}}", "")
    }

    return serviceFileContent
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
      await unlink(servicePath)

      const daemonReload = await spawn(["systemctl", system ? "" : "--user", "daemon-reload"])
      if (daemonReload.code !== 0) {
        throw new Error("Failed to reload daemon while rolling back.")
      }
      console.log(`Changes rolled back: Removed '${servicePath}'.`)
    } catch (error) {
      console.error(`Failed to rollback changes: Could not remove '${servicePath}'. Error:`, error.message)
    }
  }
}

export { SystemdService }
