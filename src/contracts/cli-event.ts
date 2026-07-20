import type { CommandReference, CommandResultV3 } from "./command-result.js";
import type { JsonObject, JsonValue } from "./json.js";
import type { MessageRef } from "./message-ref.js";

export const CLI_EVENT_SCHEMA = "benchpilot.event" as const;
export const CLI_EVENT_VERSION = 3 as const;

export type NoticeLevel = "info" | "success" | "warning" | "error";

export type OutputFrame =
  | { readonly type: "command.started" }
  | {
      readonly type: "snapshot";
      readonly key: string;
      readonly value: JsonValue;
    }
  | { readonly type: "update"; readonly key: string; readonly value: JsonValue }
  | { readonly type: "append"; readonly key: string; readonly value: JsonValue }
  | {
      readonly type: "progress";
      readonly key: string;
      readonly current: number;
      readonly total?: number;
      readonly status?: string;
      readonly data?: JsonObject;
    }
  | {
      readonly type: "notice";
      readonly key?: string;
      readonly level: NoticeLevel;
      readonly message: MessageRef;
      readonly data?: JsonObject;
    }
  | {
      readonly type: `operation.${string}`;
      readonly data?: JsonObject;
    }
  | {
      readonly type: "command.completed";
      readonly result: CommandResultV3;
    }
  | {
      readonly type: "command.failed";
      readonly result: CommandResultV3;
    };

export interface CliEventV3 {
  readonly schema: typeof CLI_EVENT_SCHEMA;
  readonly version: typeof CLI_EVENT_VERSION;
  readonly sequence: number;
  readonly timestamp: string;
  readonly command: CommandReference;
  readonly context: JsonObject;
  readonly event: OutputFrame;
}

export interface CliEventEncoderOptions {
  readonly command: CommandReference;
  readonly clock?: () => Date;
}

export class CliEventEncoder {
  private sequence = 0;
  private readonly clock: () => Date;

  constructor(private readonly options: CliEventEncoderOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  encode(frame: OutputFrame, context: JsonObject = {}): CliEventV3 {
    return {
      schema: CLI_EVENT_SCHEMA,
      version: CLI_EVENT_VERSION,
      sequence: this.sequence++,
      timestamp: this.clock().toISOString(),
      command: this.options.command,
      context,
      event: frame,
    };
  }
}

export const cliEventV3Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "benchpilot://schemas/event/v3",
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "version",
    "sequence",
    "timestamp",
    "command",
    "context",
    "event",
  ],
  properties: {
    schema: { const: CLI_EVENT_SCHEMA },
    version: { const: CLI_EVENT_VERSION },
    sequence: { type: "integer", minimum: 0 },
    timestamp: { type: "string", format: "date-time" },
    command: {
      type: "object",
      additionalProperties: false,
      required: ["id", "path"],
      properties: {
        id: { type: "string", minLength: 1 },
        path: { type: "array", items: { type: "string" } },
      },
    },
    context: { type: "object" },
    event: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          properties: { type: { const: "command.started" } },
        },
        ...["snapshot", "update", "append"].map((type) => ({
          type: "object",
          additionalProperties: false,
          required: ["type", "key", "value"],
          properties: {
            type: { const: type },
            key: { type: "string", minLength: 1 },
            value: true,
          },
        })),
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "key", "current"],
          properties: {
            type: { const: "progress" },
            key: { type: "string", minLength: 1 },
            current: { type: "number", minimum: 0 },
            total: { type: "number", exclusiveMinimum: 0 },
            status: { type: "string" },
            data: { type: "object" },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "level", "message"],
          properties: {
            type: { const: "notice" },
            key: { type: "string", minLength: 1 },
            level: { enum: ["info", "success", "warning", "error"] },
            message: { $ref: "#/$defs/messageRef" },
            data: { type: "object" },
          },
        },
        {
          type: "object",
          required: ["type"],
          properties: {
            type: { type: "string", pattern: "^operation\\." },
            data: { type: "object" },
          },
        },
        ...["command.completed", "command.failed"].map((type) => ({
          type: "object",
          additionalProperties: false,
          required: ["type", "result"],
          properties: {
            type: { const: type },
            result: { $ref: "benchpilot://schemas/result/v3" },
          },
        })),
      ],
    },
  },
  $defs: {
    messageRef: {
      type: "object",
      additionalProperties: false,
      required: ["key"],
      properties: {
        key: { type: "string", minLength: 1 },
        values: {
          type: "object",
          additionalProperties: {
            anyOf: [
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
              { type: "null" },
            ],
          },
        },
        fallback: { type: "string" },
      },
    },
  },
} as const;
