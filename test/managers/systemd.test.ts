import { SystemdService } from "../../lib/managers/systemd.ts";
import { InstallServiceOptions } from "../../lib/service.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { test } from "@cross/test";
import { ServiceInstallResult } from "../../lib/result.ts";

test("generateConfig should create a valid service configuration", () => {
  const options: InstallServiceOptions = {
    name: "test-service",
    cmd: "deno run --allow-net server.ts",
    home: "/home/testuser",
    user: "testuser",
    system: false,
    path: ["/usr/local/bin"],
  };
  const systemdService = new SystemdService();
  const generatedConfig = systemdService.generateConfig(options);

  assertStringIncludes(generatedConfig, "Description=test-service (Deno Service)");
  assertStringIncludes(generatedConfig, 'ExecStart=/bin/sh -c "deno run --allow-net server.ts"');
  assertStringIncludes(generatedConfig, "Environment=PATH=");
  assertStringIncludes(generatedConfig, "WantedBy=default.target");
  assertStringIncludes(generatedConfig, "/usr/local/bin");
});

test("install should create and display service configuration in user mode (dry-run)", async () => {
  const options: InstallServiceOptions = {
    name: "test-service",
    cmd: "deno run --allow-net server.ts",
    home: "/home/testuser",
    user: "testuser",
    system: false,
  };
  const systemdService = new SystemdService();

  let installResult: ServiceInstallResult | undefined;
  try {
    installResult = await systemdService.install(options, true);
  } catch (error) {
    throw error;
  }

  assertEquals(installResult.manualSteps, null);

  // Assert that the console output contains expected values
  assertStringIncludes(installResult.serviceFileContent, "/home/testuser/.config/systemd/user/test-service.service");
  assertStringIncludes(installResult.serviceFileContent, "Description=test-service (Deno Service)");
  assertStringIncludes(installResult.serviceFileContent, 'ExecStart=/bin/sh -c "deno run --allow-net server.ts"');
});

test("generateConfig should contain multi-user.target in system mode", () => {
  const options: InstallServiceOptions = {
    name: "test-service",
    cmd: "deno run --allow-net server.ts",
    home: "/home/testuser",
    user: "testuser",
    system: true,
    path: ["/usr/local/bin"],
  };
  const systemdService = new SystemdService();
  const generatedConfig = systemdService.generateConfig(options);

  assertStringIncludes(generatedConfig, "WantedBy=multi-user.target");
});
