/**
 * Exports helper functions to install a command as a sysvinit/docker-init service
 *
 * @file      lib/managers/init.ts
 * @license   MIT
 */

import { exists, mktempdir, writeFile } from "@cross/fs";
import { dirname } from "@std/path";
import { resolvedExecPath } from "@cross/utils/execpath";
import { join } from "@std/path";
import type { InstallServiceOptions, UninstallServiceOptions } from "../service.ts";
import type { ServiceInstallResult, ServiceManualStep, ServiceUninstallResult } from "../result.ts";

const initScriptTemplate = `#!/bin/sh
### BEGIN INIT INFO
# Provides:          {{name}}
# Required-Start:    $remote_fs $syslog
# Required-Stop:     $remote_fs $syslog
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: {{name}} (Deno Service)
# Description:       Start {{name}} service
### END INIT INFO

PATH={{path}}
{{extraEnvs}}

# Change the next line to match your installation
DENO_COMMAND="{{command}}"

case "$1" in
  start)
    echo "Starting {{name}}..."
    $DENO_COMMAND &
    echo $! > /var/run/{{name}}.pid
    ;;
  stop)
    echo "Stopping {{name}}..."
    PID=$(cat /var/run/{{name}}.pid)
    kill $PID
    rm /var/run/{{name}}.pid
    ;;
  restart)
    $0 stop
    $0 start
    ;;
  status)
    if [ -e /var/run/{{name}}.pid ]; then
      echo "{{name}} is running"
    else
      echo "{{name}} is not running"
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac

exit 0
`;

class InitService {
  /**
   * Generates the configuration file content for the init service.
   *
   * @param {InstallServiceOptions} config - Options for the installService function.
   * @returns {string} - The configuration file content.
   */
  async generateConfig(config: InstallServiceOptions): Promise<string> {
    const runtimePath = await resolvedExecPath();
    const runtimeDir = dirname(runtimePath);
    const servicePath = config.path?.length ? `${config.path?.join(":")}:${runtimeDir}` : runtimeDir;
    const command = config.cmd;
    let initScriptContent = initScriptTemplate.replace(/{{name}}/g, config.name);
    initScriptContent = initScriptContent.replace("{{command}}", command);
    initScriptContent = initScriptContent.replace("{{path}}", servicePath);

    // Add extra environment variables
    if (config.env && config.env.length > 0) {
      let extraEnvs = "";
      for (const env of config.env) {
        extraEnvs += `${env}\n`;
      }
      initScriptContent = initScriptContent.replace("{{extraEnvs}}", extraEnvs);
    } else {
      initScriptContent = initScriptContent.replace("{{extraEnvs}}", "");
    }

    return initScriptContent;
  }

  async install(config: InstallServiceOptions, onlyGenerate: boolean): Promise<ServiceInstallResult> {
    const initScriptPath = `/etc/init.d/${config.name}`;

    if (await exists(initScriptPath)) {
      throw new Error(`Service '${config.name}' already exists in '${initScriptPath}'.`);
    }

    const initScriptContent = await this.generateConfig(config);

    if (onlyGenerate) {
      return {
        servicePath: initScriptPath,
        serviceFileContent: initScriptContent,
        manualSteps: null,
      };
    } else {
      // Store temporary file
      const tempFilePathDir = await mktempdir("svcinstall");
      const tempFilePath = join(tempFilePathDir, "svc-init");
      await writeFile(tempFilePath, initScriptContent);
      const manualSteps: ServiceManualStep[] = [];
      manualSteps.push({
        text: "The service installer does not have (and should not have) root permissions, so the next steps have to be carried out manually.",
      });
      manualSteps.push({
        text: "Step 1: The init script has been saved to a temporary file, copy this file to the correct location using the following command:",
        command: `sudo cp ${tempFilePath} ${initScriptPath}`,
      });
      manualSteps.push({
        text: "Step 2: Make the script executable:",
        command: `sudo chmod +x ${initScriptPath}`,
      });
      manualSteps.push({
        text: "Step 3: Enable the service to start at boot:",
        command: `sudo update-rc.d ${config.name} defaults`,
      });
      manualSteps.push({
        text: "Step 4: Start the service now:",
        command: `sudo service ${config.name} start`,
      });
      return {
        servicePath: tempFilePath,
        serviceFileContent: initScriptContent,
        manualSteps,
      };
    }
  }

  async uninstall(config: UninstallServiceOptions): Promise<ServiceUninstallResult> {
    const initScriptPath = `/etc/init.d/${config.name}`;

    if (!await exists(initScriptPath)) {
      throw new Error(`Service '${config.name}' does not exist in '${initScriptPath}'.`);
    }

    const manualSteps: ServiceManualStep[] = [
      {
        text: "The uninstaller does not have (and should not have) root permissions, so the next steps have to be carried out manually.",
      },
      {
        text: "Step 1: Stop the service (if it's running):",
        command: `sudo service ${config.name} stop`,
      },
      {
        text: "Step 2: Disable the service from starting at boot:",
        command: `sudo update-rc.d -f ${config.name} remove`,
      },
      {
        text: `Step 3: Remove the init script:`,
        command: `sudo rm ${initScriptPath}`,
      },
    ];
    return {
      servicePath: initScriptPath,
      manualSteps,
    };
  }
}

export { InitService };
