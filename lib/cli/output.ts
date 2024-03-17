/**
 * Exports helper functions to print standardised messages
 * Belongs to Service cli entrypoint
 *
 * @file      lib/cli/output.ts
 * @license   MIT
 */

import metadata from "../../deno.json" with { type: "json" };

export function printHeader() {
  console.log(metadata.name + " " + metadata.version);
}

export function printUsage() {
  console.log(`Usage: service [OPTIONS...]`);
}

export function printFlags() {
  console.log("General:");
  console.log("  -h, --help                Display this help and exit");

  console.log("\nService installation:");
  console.log("  install                   Install service");
  console.log("  uninstall                 Uninstall service");
  console.log("  generate                  Generate and output service configuration, do not install");

  console.log("\nMandatory flags:");
  console.log("  -c, --cmd                 Command to be run by the service");

  console.log("\nOptional flags:");
  console.log("  -w, --cwd                 Set working directory for service");
  console.log("  -n, --name                Set service name");
  console.log("  -u, --user (if applicable) Set service run-as user");
  console.log("  -H, --home (if applicable) Set service home directory");

  console.log("\nSystemd and Launchd specific flags:");
  console.log("  --system                  Install the service system-wide (requires root, if applicable)");

  console.log("\nForce specific service manager:");
  console.log("  -f, --force               Generate configuration for a specific service manager");

  console.log("");
}
