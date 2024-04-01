/**
 * Exports main function of Service cli entrypoint
 *
 * @file      lib/cli/main.ts
 * @license   MIT
 */

// Import CLI utilities
import { printFlags, printUsage } from "./output.ts";
import { checkArguments, parseArguments } from "./args.ts";
import { installService, uninstallService } from "../service.ts";
import { Colors, exit } from "@cross/utils";

/**
 * Define the main entry point of the CLI application
 *
 * @private
 * @async
 */
async function main(inputArgs: string[]) {
  // Parse and check arguments
  let args;
  try {
    args = parseArguments(inputArgs);
  } catch (e) {
    console.error(e.message);
    exit(1);
    return;
  }

  // Extract base argument
  const baseArgument = args.countLoose() > 0 ? args.getLoose()[0] : undefined;

  // Handle --help
  if (args.count("help") || !baseArgument) {
    printUsage();
    console.log("");
    printFlags();
    exit(0);
  }

  // Check arguments
  try {
    args = checkArguments(args);
  } catch (e) {
    console.error(e.message);
    exit(1);
    return;
  }

  // Handle arguments
  const system = args.getBoolean("system");
  const name = args.get("name") as string;
  const cmd = (args.get("cmd") || args.getRest()) as string;
  const cwd = args.get("cwd") as string | undefined;
  const user = args.get("user") as string | undefined;
  const home = args.get("home") as string | undefined;
  const force = args.get("force") as string | undefined;
  const path = args.getArray("path") as string[];
  const env = args.getArray("env") as string[];

  /**
   * Handle the install argument
   */
  if (baseArgument === "install" || baseArgument === "generate") {
    try {
      const result = await installService({ system, name, cmd, cwd, user, home, path, env }, baseArgument === "generate", force);
      if (baseArgument === "generate") {
        console.log(result.serviceFileContent);
      } else {
        if (result.manualSteps && result.manualSteps.length) {
          console.log(Colors.bold("To complete the installation, carry out these manual steps:"));
          result.manualSteps.forEach((step, index) => {
            console.log(Colors.cyan(`${index + 1}. ${step.text}`));
            if (step.command) {
              console.log("   " + Colors.yellow("Command: ") + step.command);
            }
          });
        } else {
          console.log(`Service ´${name}' successfully installed at '${result.servicePath}'.`);
        }
      }
      exit(0);
    } catch (e) {
      console.error(`Could not install service, error: ${e.message}`);
      exit(1);
    }
    /**
     * Handle the uninstall argument
     */
  } else if (baseArgument === "uninstall") {
    try {
      const result = await uninstallService({ system, name, home });
      if (result.manualSteps && result.manualSteps.length) {
        console.log(Colors.bold("To complete the uninstallation, carry out these manual steps:"));
        result.manualSteps.forEach((step, index) => {
          console.log(Colors.cyan(`${index + 1}. ${step.text}`));
          if (step.command) {
            console.log("   " + Colors.yellow("Command: ") + step.command);
          }
        });
      } else {
        console.log(`Service '${name}' at '${result.servicePath}' is now uninstalled.`);
      }
      exit(0);
    } catch (e) {
      console.error(`Could not uninstall service, error: ${e.message}`);
      exit(1);
    }
  } else {
    console.error(`Unknown  command '${baseArgument}', exiting.`);
    exit(1);
  }
}

export { main };
