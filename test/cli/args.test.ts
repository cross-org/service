import { parseArguments } from "../../lib/cli/args.ts";
import { assertEquals } from "@std/assert";
import { test } from "@cross/test";

test("parseArguments should correctly parse CLI arguments", () => {
  const args = parseArguments([
    "install",
    "-c",
    "deno",
    "-n",
    "deno-service",
    "--help",
    "--",
    "run",
    "--allow-net",
    "app.ts",
  ]);

  assertEquals(args.getLoose()[0], "install");
  assertEquals(args.getBoolean("help"), true);
  assertEquals(args.getRest(), "run --allow-net app.ts");
});
