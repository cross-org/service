/**
 * Exports main function of Service cli entrypoint
 *
 * @file      lib/cli/main.ts
 * @license   MIT
 */

// Import CLI utilities
import { printFlags, printUsage } from "./output.ts"
import { checkArguments, parseArguments } from "./args.ts"
import { installService, uninstallService } from "../service.ts"
import { exit } from "@cross/utils"

/**
 * Define the main entry point of the CLI application
 *
 * @private
 * @async
 */
async function main(inputArgs: string[]) {
  // Parse and check arguments
  let args
  try {
    args = checkArguments(parseArguments(inputArgs))
  } catch (e) {
    console.error(e.message)
    exit(1)
    return
  }

  // Extract base argument
  const baseArgument = args.countLoose() > 0 ? args.getLoose()[0] : undefined

  if (args.count("help") || !baseArgument) {
    printUsage()
    console.log("")
    printFlags()
    exit(0)
  }

  // Handle arguments
  const system = args.get("system") as boolean
  const name = args.get("name") as string
  const cmd = (args.get("cmd") || args.getRest()) as string
  const cwd = args.get("cwd") as string | undefined
  const user = args.get("user") as string | undefined
  const home = args.get("home") as string | undefined
  const force = args.get("force") as string | undefined
  const path = args.getArray("path") as string[]
  const env = args.getArray("env") as string[]

  /**
   * Handle the install argument
   */
  if (baseArgument === "install" || baseArgument === "generate") {
    try {
      await installService({ system, name, cmd, cwd, user, home, path, env }, baseArgument === "generate", force)
      exit(0)
    } catch (e) {
      console.error(`Could not install service, error: ${e.message}`)
      exit(1)
    }
    /**
     * Handle the uninstall argument
     */
  } else if (baseArgument === "uninstall") {
    try {
      await uninstallService({ system, name, home })
      exit(0)
    } catch (e) {
      console.error(`Could not install service, error: ${e.message}`)
      exit(1)
    }
  } else {
    console.error(`Unknown  command '${baseArgument}', exiting.`)
    exit(1)
  }
}

export { main }
