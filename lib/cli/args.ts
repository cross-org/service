/**
 * Exports helper functions to parse and check arguments of Service Cli program
 *
 * @file      lib/cli/args.ts
 * @license   MIT
 */

import { ArgsParser } from "@cross/utils/args";

/**
 * Parses command line arguments and returns a parsed object.
 *
 * @param args - An array of command line arguments.
 * @returns - A parsed object containing the command line arguments.
 */
function parseArguments(args: string[]): ArgsParser {
  const aliases = {
    "help": "h",
    "system": "s",
    "name": "n",
    "cwd": "w",
    "cmd": "c",
    "user": "u",
    "home": "H",
    "force": "f",
    "path": "p",
    "env": "e",
  };
  return new ArgsParser(args, { aliases });
}

/**
 * Checks the parsed arguments and throws an error if any of the arguments are invalid.
 * @param args - The parsed arguments.
 * @returns - The parsed and checked arguments.
 * @throws - An error if any of the arguments are invalid.
 */
function checkArguments(args: ArgsParser): ArgsParser {
  // Check if the base argument is undefined or valid
  const baseArgument = args.countLoose() > 0 ? args.getLoose()[0] : undefined;
  const validBaseArguments = ["install", "uninstall", "generate"];
  if (baseArgument !== undefined && (typeof baseArgument !== "string" || !validBaseArguments.includes(baseArgument))) {
    throw new Error(`Invalid base argument: ${baseArgument}`);
  }

  // Require a command unless we're uninstalling
  if (baseArgument !== "uninstall" && !args.count("cmd") && !args.hasRest()) {
    throw new Error(`Specify a command using '--cmd'`);
  }

  // Check that each env specificers contain an equal sign
  if (args.count("env")) {
    for (const env of args.getArray("env")) {
      if (!(env as string).includes("=")) {
        throw new Error("Environment variables must be specified like '--env NAME=VALUE'.");
      }
    }
  }

  // Check that name is set
  if (!args.count("name")) {
    throw new Error("Service name must be specified.");
  }

  return args;
}

export { checkArguments, parseArguments };
