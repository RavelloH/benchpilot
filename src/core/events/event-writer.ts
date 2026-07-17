import type { Writable } from "node:stream";
import type { Json } from "../../core.js";
import type { BenchPilotEventWriter } from "./types.js";

/** Writes the public, newline-delimited event protocol without using RLog. */
export class EventWriter implements BenchPilotEventWriter {
  constructor(
    private output: Writable,
    private context: Json = {},
  ) {}

  emit(type: string, payload: Json = {}) {
    this.output.write(
      `${JSON.stringify({
        schema: "benchpilot.event",
        version: 2,
        event: { type, timestamp: new Date().toISOString() },
        context: this.context,
        data: payload,
      })}\n`,
    );
  }

  completed(result: Json) {
    this.emit("operation.completed", { result });
  }

  failed(error: Json) {
    this.emit("operation.failed", { error });
  }

  child(context: Json) {
    return new EventWriter(this.output, { ...this.context, ...context });
  }
}
