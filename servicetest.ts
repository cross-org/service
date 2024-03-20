import { Cron } from "jsr:@hexagon/croner";
import { ConsoleLogger, FileLogger, Log } from "jsr:@cross/log";
import { installService, uninstallService } from "./mod.ts";

const logger = new Log([new ConsoleLogger(), new FileLogger()]);

const install = false;
if (install) {
  logger.log("Installing");
  logger.log(
    await installService({
      "cmd": "deno run -A servicetest.ts",
      "name": "test-service",
      "system": false,
      "cwd": "/home/robin/git/service",
      "user": "robin",
    }, false),
  );
} else {
  logger.log("Uninstalling");
  const result = await uninstallService({
    "name": "test-service",
    "system": false,
  });
  logger.log("Starting");
  new Cron("10 * * * * *", { maxRuns: 5 }, () => {
    logger.log("Hello");
  });
}
