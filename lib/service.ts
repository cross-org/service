import { SystemdService } from "./managers/systemd.ts";
import { InitService } from "./managers/init.ts";
import { UpstartService } from "./managers/upstart.ts";
import { LaunchdService } from "./managers/launchd.ts";
import { WindowsService } from "./managers/windows.ts";
import { CurrentOS, OperatingSystem } from "@cross/runtime";
import { getEnv } from "@cross/env";
import { cwd, spawn } from "@cross/utils";
import { stat } from "@cross/fs";
import type { ServiceInstallResult, ServiceUninstallResult } from "./result.ts";
/**
 * Exports helper functions to install any command as a system service
 * Throws an error on Windows.
 *
 * @file      lib/service.ts
 * @license   MIT
 */

/**
 * Options for the installService function.
 *
 * @interface InstallServiceOptions
 * @property {boolean} [system] - Indicates whether to use system mode (default is to use user mode).
 * @property {string} [name='deno-service'] - Name of the service (default: 'deno-service').
 * @property {string} [cmd] - Full command for the service to run. Always use absolute paths, or pass needed paths to the PATH parameter, as services don't have access to the normal shell.
 * @property {string} [user] - The username to run the service as (default: current user).
 * @property {string} [home] - The user's home directory path (default: current user's home).
 * @property {string} [cwd] - The working directory for the service (default: current working directory).
 * @property {string[]} [path] - Folders passed to PATH, as services normally don't have the normal PATH of shell, you'll have to pass all needed paths here
 */
interface InstallServiceOptions {
  system: boolean;
  name: string;
  cmd: string;
  user?: string;
  home?: string;
  cwd?: string;
  path?: string[];
  env?: string[];
}

/**
 * Options for the uninstallService function.
 *
 * @interface UninstallServiceOptions
 * @property {boolean} [system] - Indicates whether to use system mode (default is to use user mode).
 * @property {string} [name='deno-service'] - Name of the service (default: 'deno-service').
 * @property {string} [home] - The user's home directory path (default: current user's home). Needed if the service is installed as a user service
 */
interface UninstallServiceOptions {
  system: boolean;
  name: string;
  home?: string;
}

interface ServiceManagerImplementation {
  install(options: InstallServiceOptions, onlyGenerate: boolean): Promise<ServiceInstallResult>;
  uninstall(options: UninstallServiceOptions): Promise<ServiceUninstallResult>;
  generateConfig(options: InstallServiceOptions): string;
}

/**
 * Prepares the configuration object with defaults for the installService and uninstallService functions.
 *
 * @function prepareServiceConfig
 * @param {T} options - Options for the installService and uninstallService functions.
 * @returns {T} - The configuration object with default values set.
 */
function prepareConfig<T extends InstallServiceOptions | UninstallServiceOptions>(options: T): T {
  return {
    system: options.system || false,
    name: options.name || "deno-service",
    home: options.home || getEnv("HOME") || getEnv("userprofile"),
    cmd: "cmd" in options ? options.cmd : undefined,
    user: "user" in options ? options.user || getEnv("USER") : undefined,
    cwd: "cwd" in options ? options.cwd || cwd() : undefined,
    path: "path" in options ? options.path : undefined,
    env: "env" in options ? options.env : undefined,
  } as T;
}

class ServiceManager {
  private managers: Map<string, ServiceManagerImplementation> = new Map();

  register(initSystem: string, manager: ServiceManagerImplementation) {
    this.managers.set(initSystem, manager);
  }

  async installService(initSystem: string, options: InstallServiceOptions, onlyGenerate: boolean): Promise<ServiceInstallResult> {
    const manager = this.managers.get(initSystem);

    if (!manager) {
      throw new Error(`Unsupported init system: ${initSystem}`);
    }

    return await manager.install(options, onlyGenerate);
  }

  async generateConfig(initSystem: string, options: InstallServiceOptions): Promise<string> {
    const manager = this.managers.get(initSystem);

    if (!manager) {
      throw new Error(`Unsupported init system: ${initSystem}`);
    }

    return await manager.generateConfig(options);
  }

  async uninstallService(initSystem: string, options: UninstallServiceOptions): Promise<ServiceUninstallResult> {
    const manager = this.managers.get(initSystem);

    if (!manager) {
      throw new Error(`Unsupported init system: ${initSystem}`);
    }

    return await manager.uninstall(options);
  }
}

const serviceManager = new ServiceManager(); // Register available managers

serviceManager.register("systemd", new SystemdService());
serviceManager.register("sysvinit", new InitService());
serviceManager.register("docker-init", new InitService());
serviceManager.register("upstart", new UpstartService());
serviceManager.register("launchd", new LaunchdService());
serviceManager.register("windows", new WindowsService());

async function installService(options: InstallServiceOptions, onlyGenerate: boolean, forceInitSystem?: string): Promise<ServiceInstallResult> {
  if (forceInitSystem && !onlyGenerate) {
    throw new Error("Manually selecting an init system is not possible while installing.");
  }
  const config = prepareConfig(options);
  const initSystem = forceInitSystem || await detectInitSystem();
  return await serviceManager.installService(initSystem, config, onlyGenerate);
}

/**
 * Uninstalls a command from a systemd service using the currently installed service manager.
 * Throws an error on failure, or unsupported system.
 *
 * @async
 * @function uninstallService
 * @param {InstallServiceOptions} options - Options for the uninstallService function.
 */
async function uninstallService(options: UninstallServiceOptions, forceInitSystem?: string): Promise<ServiceUninstallResult> {
  const config = prepareConfig(options);
  const initSystem = forceInitSystem || await detectInitSystem();
  return await serviceManager.uninstallService(initSystem, config);
}

/**
 * Generate configuration string
 *
 * @async
 * @function generateConfig
 * @param {InstallServiceOptions} options - Options for the generateConfig function.
 */
async function generateConfig(options: InstallServiceOptions, forceInitSystem?: string): Promise<string> {
  const config = prepareConfig(options);
  const initSystem = forceInitSystem || await detectInitSystem();
  return await serviceManager.generateConfig(initSystem, config);
}

async function detectInitSystem(): Promise<string> {
  if (CurrentOS === OperatingSystem.macOS) {
    return "launchd";
  }

  if (CurrentOS === OperatingSystem.Windows) {
    return "windows";
  }

  const process = await spawn(["ps", "-p", "1", "-o", "comm="]);

  if (process.stdout.includes("systemd")) {
    return "systemd";
  } else if (process.stdout.includes("init")) {
    // Check for Upstart
    try {
      const statInitCtl = await stat("/sbin/initctl");
      const statInit = await stat("/etc/init");
      if (statInitCtl.isFile && statInit.isDirectory) {
        return "upstart";
      } else {
        return "sysvinit";
      }
    } catch (_e) {
      return "sysvinit";
    }
  } else if (process.stdout.includes("openrc")) {
    return "openrc";
  } else if (process.stdout.includes("docker-init")) {
    return "dockerinit";
  } else {
    throw new Error("Unsupported init system.");
  }
}

export { generateConfig, installService, uninstallService };
export type { InstallServiceOptions, UninstallServiceOptions };
