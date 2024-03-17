/**
 * Exports helper functions to install a command as a systemd service
 *
 * @file      lib/managers/systemd.ts
 * @license   MIT
 */

import { existsSync, path } from "../../deps.ts"
import { InstallServiceOptions, UninstallServiceOptions } from "../service.ts"

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

    if (existsSync(servicePathUser)) {
      console.error(`Service '${config.name}' already exists in '${servicePathUser}'. Exiting.`)
      Deno.exit(1)
    }
    if (existsSync(servicePathSystem)) {
      console.error(`Service '${config.name}' already exists in '${servicePathSystem}'. Exiting.`)
      Deno.exit(1)
    }

    // Automatically enable linger for current user using loginctl if running in user mode
    if (!config.system && !onlyGenerate) {
      if (!config.user) {
        throw new Error("Username not found in $USER, must be specified using the --username flag.")
      }
      const enableLingerCommand = new Deno.Command("loginctl", { args: ["enable-linger", config.user] })
      const enableLinger = enableLingerCommand.spawn()
      const status = await enableLinger.status
      if (!status.success) {
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
      const tempFilePath = await Deno.makeTempFile()
      await Deno.writeTextFile(tempFilePath, serviceFileContent)

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
      const serviceDir = path.dirname(servicePath)
      await Deno.mkdir(serviceDir, { recursive: true })

      // Write configuration
      await Deno.writeTextFile(servicePath, serviceFileContent)

      // Run systemctl daemon-reload
      const daemonReloadCommand = new Deno.Command("systemctl", { args: [config.system ? "" : "--user", "daemon-reload"], stderr: "piped", stdout: "piped" })
      const daemonReload = daemonReloadCommand.spawn()
      const daemonReloadOutput = await daemonReload.output()
      const daemonReloadText = new TextDecoder().decode(daemonReloadOutput.stderr)
      if (!daemonReloadOutput.success) {
        await this.rollback(servicePath, config.system)
        throw new Error("Failed to reload daemon, rolled back any changes. Error: \n" + daemonReloadText)
      }

      // Run systemctl enable
      const enableServiceCommand = new Deno.Command("systemctl", { args: [config.system ? "" : "--user", "enable", config.name], stderr: "piped", stdout: "piped" })
      const enableService = enableServiceCommand.spawn()
      const enableServiceOutput = await enableService.output()
      const enableServiceText = new TextDecoder().decode(enableServiceOutput.stderr)
      if (!enableServiceOutput.success) {
        await this.rollback(servicePath, config.system)
        throw new Error("Failed to enable service, rolled back any changes. Error: \n" + enableServiceText)
      }

      // Run systemctl start
      const startServiceCommand = new Deno.Command("systemctl", { args: [config.system ? "" : "--user", "start", config.name], stderr: "piped", stdout: "piped" })
      const startService = startServiceCommand.spawn()
      const startServiceOutput = await startService.output()
      const startServiceText = new TextDecoder().decode(startServiceOutput.stderr)
      if (!startServiceOutput.success) {
        await this.rollback(servicePath, config.system)
        throw new Error("Failed to start service, rolled back any changes. Error: \n" + startServiceText)
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
    if (!existsSync(servicePath)) {
      console.error(`Service '${config.name}' does not exist. Exiting.`)
      Deno.exit(1)
    }

    try {
      await Deno.remove(servicePath)
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
    const workingDirectory = options.cwd ? options.cwd : Deno.cwd()

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
      await Deno.remove(servicePath)

      const daemonReloadCommand = new Deno.Command("systemctl", { args: [system ? "" : "--user", "daemon-reload"] })
      const daemonReload = daemonReloadCommand.spawn()
      const daemonStatus = await daemonReload.status
      if (!daemonStatus.success) {
        throw new Error("Failed to reload daemon while rolling back.")
      }
      console.log(`Changes rolled back: Removed '${servicePath}'.`)
    } catch (error) {
      console.error(`Failed to rollback changes: Could not remove '${servicePath}'. Error:`, error.message)
    }
  }
}

export { SystemdService }
