import type { Writable } from "node:stream";
import type {
  Json,
  OperationReporter,
  OperationReportOptions,
} from "../../core.js";

/** Temporary v2 JSONL adapter. Remove when the v3 Output Engine is active. */
export class LegacyEventReporter implements OperationReporter {
  constructor(
    private readonly output: Writable,
    private readonly context: Json = {},
  ) {}

  emit(type: string, data: Json = {}, _options?: OperationReportOptions) {
    this.output.write(
      `${JSON.stringify({
        schema: "benchpilot.event",
        version: 2,
        event: { type, timestamp: new Date().toISOString() },
        context: this.context,
        data,
      })}\n`,
    );
  }

  child(context: Json) {
    return new LegacyEventReporter(this.output, {
      ...this.context,
      ...context,
    });
  }
}
