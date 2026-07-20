import {
  CliEventEncoder,
  type CommandReference,
  type JsonObject,
  type OutputFrame,
} from "../../contracts/index.js";
import type {
  Json,
  OperationReporter,
  OperationReportOptions,
} from "../../core.js";

export interface OperationFrameWriter {
  write(value: string): unknown;
}

const object = (value: Json): JsonObject => value as JsonObject;

/**
 * CLI-only adapter from Core's domain events to the public Event v3 stream.
 * It does not own terminal Result construction; callers complete it exactly once.
 */
export class OperationFrameReporter implements OperationReporter {
  private readonly encoder: CliEventEncoder;

  constructor(
    private readonly output: OperationFrameWriter,
    command: CommandReference,
    private readonly context: JsonObject = {},
    encoder?: CliEventEncoder,
    private readonly state = { started: false, terminal: false },
  ) {
    this.encoder = encoder ?? new CliEventEncoder({ command });
  }

  emit(type: string, data: Json = {}, options?: OperationReportOptions) {
    this.ensureStarted();
    const publicType = type.startsWith("operation.")
      ? type
      : type.startsWith("device.operation.")
        ? `operation.device.${type.slice("device.operation.".length)}`
        : type.startsWith("system.operation.")
          ? `operation.system.${type.slice("system.operation.".length)}`
          : `operation.${type}`;
    this.write({
      type: publicType as `operation.${string}`,
      data: {
        event: type,
        ...object(data),
        ...(options?.level ? { level: options.level } : {}),
        ...(options?.audience ? { audience: options.audience } : {}),
      },
    });
  }

  child(context: Json) {
    return new OperationFrameReporter(
      this.output,
      { id: "unused", path: [] },
      { ...this.context, ...object(context) },
      this.encoder,
      this.state,
    );
  }

  complete(
    frame: Extract<
      OutputFrame,
      { type: "command.completed" | "command.failed" }
    >,
  ) {
    this.ensureStarted();
    if (this.state.terminal)
      throw new Error("Operation terminal frame already emitted.");
    this.state.terminal = true;
    this.write(frame);
  }

  get terminalEmitted() {
    return this.state.terminal;
  }

  private ensureStarted() {
    if (this.state.started) return;
    this.state.started = true;
    this.write({ type: "command.started" });
  }

  private write(frame: OutputFrame) {
    this.output.write(
      `${JSON.stringify(this.encoder.encode(frame, this.context))}\n`,
    );
  }
}
