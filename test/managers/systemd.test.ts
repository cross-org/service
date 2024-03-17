import { SystemdService } from "../../lib/managers/systemd.ts"
import { InstallServiceOptions } from "../../lib/service.ts"
import { assertStringIncludes } from "../deps.ts"

Deno.test("generateConfig should create a valid service configuration", () => {
  const options: InstallServiceOptions = {
    name: "test-service",
    cmd: "deno run --allow-net server.ts",
    home: "/home/testuser",
    user: "testuser",
    system: false,
    path: ["/usr/local/bin"],
  }
  const systemdService = new SystemdService()
  const generatedConfig = systemdService.generateConfig(options)

  assertStringIncludes(generatedConfig, "Description=test-service (Deno Service)")
  assertStringIncludes(generatedConfig, 'ExecStart=/bin/sh -c "deno run --allow-net server.ts"')
  assertStringIncludes(generatedConfig, "Environment=PATH=")
  assertStringIncludes(generatedConfig, "/home/testuser/.deno/bin")
  assertStringIncludes(generatedConfig, "WantedBy=default.target")
  assertStringIncludes(generatedConfig, "/usr/local/bin")
})

Deno.test("install should create and display service configuration in user mode (dry-run)", async () => {
  const options: InstallServiceOptions = {
    name: "test-service",
    cmd: "deno run --allow-net server.ts",
    home: "/home/testuser",
    user: "testuser",
    system: false,
  }
  const systemdService = new SystemdService()

  // Capture console output
  const consoleOutput: string[] = []
  const originalConsoleLog = console.log
  console.log = (...args: unknown[]): void => {
    consoleOutput.push(args.join(" "))
  }

  try {
    await systemdService.install(options, true)
  } catch (error) {
    console.log = originalConsoleLog
    throw error
  }

  console.log = originalConsoleLog

  // Assert that the console output contains expected values
  assertStringIncludes(consoleOutput.join("\n"), "This is a dry-run, nothing will be written to disk or installed.")
  assertStringIncludes(consoleOutput.join("\n"), "/home/testuser/.config/systemd/user/test-service.service")
  assertStringIncludes(consoleOutput.join("\n"), "Description=test-service (Deno Service)")
  assertStringIncludes(consoleOutput.join("\n"), 'ExecStart=/bin/sh -c "deno run --allow-net server.ts"')
})

Deno.test("generateConfig should contain multi-user.target in system mode", () => {
  const options: InstallServiceOptions = {
    name: "test-service",
    cmd: "deno run --allow-net server.ts",
    home: "/home/testuser",
    user: "testuser",
    system: true,
    path: ["/usr/local/bin"],
  }
  const systemdService = new SystemdService()
  const generatedConfig = systemdService.generateConfig(options)

  assertStringIncludes(generatedConfig, "WantedBy=multi-user.target")
})
