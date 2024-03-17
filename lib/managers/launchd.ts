/**
 * Exports helper functions to install a command as a launchd service
 *
 * @file      lib/managers/launchd.ts
 * @license   MIT
 */

import { existsSync, path } from "../../deps.ts"
import { InstallServiceOptions, UninstallServiceOptions } from "../service.ts"

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
`

class LaunchdService {
  /**
   * Generates a Launchd plist configuration file content as a string based on the given options.
   *
   * @param {InstallServiceOptions} options - The options used to generate the Launchd plist configuration file.
   * @returns {string} The generated Launchd plist configuration file content as a string.
   */
  generateConfig(options: InstallServiceOptions): string {
    const denoPath = Deno.execPath()
    const commandArgs = options.cmd.split(" ")
    const servicePath = `${options.path?.join(":")}:${denoPath}:${options.home}/.deno/bin`
    const workingDirectory = options.cwd ? options.cwd : Deno.cwd()

    let plistContent = plistTemplate.replace(/{{name}}/g, options.name)
    plistContent = plistContent.replace(/{{path}}/g, servicePath)
    plistContent = plistContent.replace(/{{workingDirectory}}/g, workingDirectory)

    let programArguments = ""
    for (const arg of commandArgs) {
      programArguments += `      <string>${arg}</string>\n`
    }
    plistContent = plistContent.replace("{{command}}", programArguments)

    // Add extra environment variables
    if (options.env && options.env.length > 0) {
      let extraEnvs = ""
      for (const env of options.env) {
        const envSplit = env.split("=")
        extraEnvs += `      <key>${envSplit[0]}</key>\n      <string>${envSplit[1]}</string>\n`
      }
      plistContent = plistContent.replace("{{extraEnvs}}", extraEnvs)
    } else {
      plistContent = plistContent.replace("{{extraEnvs}}", "")
    }

    return plistContent
  }

  async install(config: InstallServiceOptions, onlyGenerate: boolean) {
    const plistFileName = `${config.name}.plist`

    // Different paths for user and system mode
    const plistPathUser = `${config.home}/Library/LaunchAgents/${plistFileName}`
    const plistPathSystem = `/Library/LaunchDaemons/${plistFileName}`
    const plistPath = config.system ? plistPathSystem : plistPathUser

    // Do not allow to overwrite existing services, regardless of mode
    if (existsSync(plistPathUser) || existsSync(plistPathSystem)) {
      console.error(`Service '${config.name}' already exists. Exiting.`)
      Deno.exit(1)
    }

    const plistContent = this.generateConfig(config)

    if (onlyGenerate) {
      console.log("\nThis is a dry-run, nothing will be written to disk or installed.")
      console.log("\nPath: ", plistPath)
      console.log("\nConfiguration:\n")
      console.log(plistContent)
    } else {
      const plistDir = path.dirname(plistPath)
      await Deno.mkdir(plistDir, { recursive: true })

      // ToDo: Remember to rollback on failure
      await Deno.writeTextFile(plistPath, plistContent)

      console.log(`Service '${config.name}' installed at '${plistPath}'.`)

      // ToDo: Actually run the service and verify that it works, if not - use the rollback function
      if (config.system) {
        console.log("Please run the following command as root to load the service:")
        console.log(`sudo launchctl load ${plistPath}`)
      } else {
        console.log("Please run the following command to load the service:")
        console.log(`launchctl load ${plistPath}`)
      }
    }
  }

  /**

  * Rolls back any changes made during the launchd service installation process
  * by removing the plist file.
  * @param {string} plistPath - The path of the plist file to be removed.
  */
  async rollback(plistPath: string) {
    try {
      await Deno.remove(plistPath)
      console.log(`Changes rolled back: Removed '${plistPath}'.`)
    } catch (error) {
      console.error(`Failed to rollback changes: Could not remove '${plistPath}'. Error: ${error.message}`)
    }
  }

  /**
   * Uninstalls a Launchd service by removing the service configuration file (plist).
   * Checks if the service exists and removes it if found.
   * @param {UninstallServiceOptions} config - Options for the uninstallService function.
   * @throws Will throw an error if unable to remove the service configuration file.
   */
  async uninstall(config: UninstallServiceOptions) {
    const plistFileName = `${config.name}.plist`
    // Different paths for user and system mode
    const plistPathUser = `${config.home}/Library/LaunchAgents/${plistFileName}`
    const plistPathSystem = `/Library/LaunchDaemons/${plistFileName}`
    const plistPath = config.system ? plistPathSystem : plistPathUser

    // Check if the service exists
    if (!existsSync(plistPath)) {
      console.error(`Service '${config.name}' does not exist. Exiting.`)
      Deno.exit(1)
    }

    try {
      await Deno.remove(plistPath)
      console.log(`Service '${config.name}' uninstalled successfully.`)

      // Unload the service
      if (config.system) {
        console.log("Please run the following command as root to unload the service (if it's running):")
        console.log(`sudo launchctl unload ${plistPath}`)
      } else {
        console.log("Please run the following command to unload the service (if it's running):")
        console.log(`launchctl unload ${plistPath}`)
      }
    } catch (error) {
      console.error(`Failed to uninstall service: Could not remove '${plistPath}'. Error:`, error.message)
    }
  }
}

export { LaunchdService }
