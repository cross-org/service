/**
 * Exports helper functions to install a command as a sysvinit/docker-init service
 *
 * @file      lib/managers/init.ts
 * @license   MIT
 */

import { exists } from "../utils/exists.ts";
import { InstallServiceOptions, UninstallServiceOptions } from "../service.ts";
import { getEnv } from "@cross/env";
import { join } from "@std/path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { ServiceInstallResult, ServiceUninstallResult } from "../result.ts";

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
  generateConfig(config: InstallServiceOptions): string {
    const command = config.cmd;
    const servicePath = `${config.path?.join(":")}:${getEnv("PATH")}`;

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
      throw new Error(`Service '${config.name}' already exists in '${initScriptPath}'. Exiting.`);
    }

    const initScriptContent = this.generateConfig(config);

    if (onlyGenerate) {
      return {
        servicePath: null,
        serviceFileContent: initScriptContent,
        manualSteps: null,
      };
    } else {
      // Store temporary file
      const tempFilePathDir = await mkdtemp("svcinstall");
      const tempFilePath = join(tempFilePathDir, "svc-init");
      await writeFile(tempFilePath, initScriptContent);
      let manualSteps = "";
      manualSteps += "\nThe service installer does not have (and should not have) root permissions, so the next steps have to be carried out manually.";
      manualSteps += `\nStep 1: The init script has been saved to a temporary file, copy this file to the correct location using the following command:`;
      manualSteps += `\n  sudo cp ${tempFilePath} ${initScriptPath}`;
      manualSteps += `\nStep 2: Make the script executable:`;
      manualSteps += `\n  sudo chmod +x ${initScriptPath}`;
      manualSteps += `\nStep 3: Enable the service to start at boot:`;
      manualSteps += `\n  sudo update-rc.d ${config.name} defaults`;
      manualSteps += `\nStep 4: Start the service now`;
      manualSteps += `\n  sudo service ${config.name} start`;
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
      throw new Error(`Service '${config.name}' does not exist in '${initScriptPath}'. Exiting.`);
    }

    let manualSteps = "";
    manualSteps += "The uninstaller does not have (and should not have) root permissions, so the next steps have to be carried out manually.";
    manualSteps += `\nStep 1: Stop the service (if it's running):`;
    manualSteps += `\n  sudo service ${config.name} stop`;
    manualSteps += `\nStep 2: Disable the service from starting at boot:`;
    manualSteps += `\n  sudo update-rc.d -f ${config.name} remove`;
    manualSteps += `\nStep 3: Remove the init script:`;
    manualSteps += `\n  sudo rm ${initScriptPath}`;

    return {
      servicePath: initScriptPath,
      manualSteps,
    };
  }
}

export { InitService };
