import RlogModule from "rlog-js";
import type {
  BusinessLog,
  BusinessLogFactory,
  BusinessLogOpenOptions,
} from "../core/reporting/business-log.js";

const Rlog = RlogModule.default;

/** Production business-log adapter. Public CLI output is never enabled here. */
export class RLogBusinessLogFactory implements BusinessLogFactory {
  open(options: BusinessLogOpenOptions): BusinessLog {
    const logger = new Rlog({
      logFilePath: options.logFilePath,
      jsonlFilePath: options.jsonlFilePath,
      jsonlOutput: "none",
      screenOutput: "none",
      enableColorfulOutput: false,
      screenLogLevel: "debug",
      context: options.context,
      fileErrorPolicy: "throw",
    });
    return {
      debug(message) {
        logger.debug(message);
      },
      info(message) {
        logger.info(message);
      },
      warn(message) {
        logger.warn(message);
      },
      event(type, data = {}, eventOptions) {
        logger.event(type, data, eventOptions);
      },
      async close() {
        await logger.close();
      },
    };
  }
}
