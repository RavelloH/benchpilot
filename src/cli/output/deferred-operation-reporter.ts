import type {
  CommandReference,
  JsonObject,
  OutputFrame,
} from "../../contracts/index.js";
import type {
  Json,
  OperationReporter,
  OperationReportOptions,
} from "../../core.js";
import {
  OperationFrameReporter,
  type OperationFrameWriter,
} from "./operation-frame-reporter.js";

/** Configures a public operation stream only after dynamic command resolution. */
export class DeferredOperationReporter implements OperationReporter {
  private reporter: OperationFrameReporter | undefined;

  constructor(private readonly output: OperationFrameWriter) {}

  configure(command: CommandReference) {
    if (this.reporter)
      throw new Error("Operation reporter may only be configured once.");
    this.reporter = new OperationFrameReporter(this.output, command);
    return this;
  }

  emit(type: string, data?: Json, options?: OperationReportOptions) {
    this.requireReporter().emit(type, data, options);
  }

  child(context: Json): OperationReporter {
    const parent = this;
    return {
      emit(type: string, data?: Json, options?: OperationReportOptions) {
        parent.requireReporter().child(context).emit(type, data, options);
      },
      child(childContext: Json) {
        return parent.child({
          ...(context as JsonObject),
          ...(childContext as JsonObject),
        });
      },
    } satisfies OperationReporter;
  }

  complete(
    frame: Extract<
      OutputFrame,
      { type: "command.completed" | "command.failed" }
    >,
  ) {
    this.requireReporter().complete(frame);
  }

  get terminalEmitted() {
    return this.reporter?.terminalEmitted === true;
  }

  private requireReporter() {
    if (!this.reporter)
      throw new Error("Operation reporter was used before command resolution.");
    return this.reporter;
  }
}
