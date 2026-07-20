import {
  CliEventEncoder,
  reduceOutputFrames,
  type CommandReference,
  type CommandResultKind,
  type CommandResultV3,
  type JsonObject,
  type JsonValue,
  type OutputFrame,
} from "../../contracts/index.js";
import type { Locale } from "../../i18n/index.js";

export type OutputMode = "screen" | "json" | "jsonl";

export interface OutputWriter {
  write(value: string): unknown;
}

export interface ScreenRenderContext {
  readonly locale: Locale;
  readonly color: boolean;
  readonly columns: number;
  readonly messageResolver?: ExternalMessageResolver;
}

export interface ExternalMessageResolverInput {
  readonly adapter?: string;
  readonly key: string;
  readonly values: Readonly<Record<string, string | number | boolean>>;
  readonly fallback: string;
}

export type ExternalMessageResolver = (
  input: ExternalMessageResolverInput,
) => string | undefined;

export interface StaticOutputDefinition<Data extends JsonValue> {
  readonly command: CommandReference;
  readonly kind: CommandResultKind;
  readonly data: Data;
  readonly snapshots?: readonly {
    readonly key: string;
    readonly value: JsonValue;
  }[];
  renderScreen(data: Data, context: ScreenRenderContext): string;
}

export interface OutputEngineOptions {
  readonly mode: OutputMode;
  readonly locale: Locale;
  readonly color: boolean;
  readonly columns: number;
  readonly output: OutputWriter;
  readonly clock?: () => Date;
  readonly eventContext?: JsonObject;
  readonly messageResolver?: ExternalMessageResolver;
}

/** Renders one semantic definition to Screen, Result v3, or Event v3. */
export class OutputEngine {
  private readonly clock: () => Date;

  constructor(private readonly options: OutputEngineOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  render<Data extends JsonValue>(
    definition: StaticOutputDefinition<Data>,
  ): CommandResultV3 {
    const started = this.clock();
    const ended = this.clock();
    const result: CommandResultV3 = {
      schema: "benchpilot.result",
      version: 3,
      ok: true,
      command: definition.command,
      kind: definition.kind,
      data: definition.data,
      meta: {
        startedAt: started.toISOString(),
        endedAt: ended.toISOString(),
        durationMs: Math.max(0, ended.getTime() - started.getTime()),
      },
    };
    const frames: OutputFrame[] = [
      { type: "command.started" },
      ...(
        definition.snapshots ?? [{ key: "result", value: definition.data }]
      ).map(({ key, value }): OutputFrame => ({
        type: "snapshot",
        key,
        value,
      })),
      { type: "command.completed", result },
    ];
    reduceOutputFrames(frames);

    if (this.options.mode === "screen")
      this.options.output.write(
        definition.renderScreen(definition.data, {
          locale: this.options.locale,
          color: this.options.color,
          columns: this.options.columns,
          ...(this.options.messageResolver
            ? { messageResolver: this.options.messageResolver }
            : {}),
        }),
      );
    else if (this.options.mode === "json")
      this.options.output.write(`${JSON.stringify(result)}\n`);
    else {
      const encoder = new CliEventEncoder({
        command: definition.command,
        clock: this.clock,
      });
      this.options.output.write(
        `${frames
          .map((frame) =>
            JSON.stringify(
              encoder.encode(frame, this.options.eventContext ?? {}),
            ),
          )
          .join("\n")}\n`,
      );
    }
    return result;
  }
}

export const outputMode = (flags: { json?: unknown; jsonl?: unknown }) =>
  flags.json === true ? "json" : flags.jsonl === true ? "jsonl" : "screen";
