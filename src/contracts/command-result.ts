import type { JsonObject, JsonValue } from "./json.js";
import type { MessageRef } from "./message-ref.js";

export const COMMAND_RESULT_SCHEMA = "benchpilot.result" as const;
export const COMMAND_RESULT_VERSION = 3 as const;

export type CommandResultKind = "data" | "help" | "operation" | "interaction";

export interface CommandReference {
  readonly id: string;
  readonly path: readonly string[];
}

export interface CommandErrorV3 {
  readonly kind: string;
  readonly diagnosticId: string;
  readonly message?: string;
  readonly messageRef?: MessageRef;
  readonly retryable?: boolean;
  readonly stage?: string;
  readonly recovery?: readonly MessageRef[];
  readonly details?: JsonObject;
}

export interface CommandResultMetaV3 {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly runId?: string;
  readonly dryRun?: boolean;
}

export interface CommandResultV3 {
  readonly schema: typeof COMMAND_RESULT_SCHEMA;
  readonly version: typeof COMMAND_RESULT_VERSION;
  readonly ok: boolean;
  readonly command: CommandReference;
  readonly kind: CommandResultKind;
  readonly data?: JsonValue;
  readonly error?: CommandErrorV3;
  readonly meta: CommandResultMetaV3;
}

export const commandResultV3Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "benchpilot://schemas/result/v3",
  type: "object",
  additionalProperties: false,
  required: ["schema", "version", "ok", "command", "kind", "meta"],
  properties: {
    schema: { const: COMMAND_RESULT_SCHEMA },
    version: { const: COMMAND_RESULT_VERSION },
    ok: { type: "boolean" },
    command: {
      type: "object",
      additionalProperties: false,
      required: ["id", "path"],
      properties: {
        id: { type: "string", minLength: 1 },
        path: { type: "array", items: { type: "string" } },
      },
    },
    kind: {
      enum: ["data", "help", "operation", "interaction"],
    },
    data: true,
    error: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "diagnosticId"],
      properties: {
        kind: { type: "string", minLength: 1 },
        diagnosticId: { type: "string", minLength: 1 },
        message: { type: "string" },
        messageRef: { $ref: "#/$defs/messageRef" },
        retryable: { type: "boolean" },
        stage: { type: "string" },
        recovery: {
          type: "array",
          items: { $ref: "#/$defs/messageRef" },
        },
        details: { type: "object" },
      },
    },
    meta: {
      type: "object",
      additionalProperties: false,
      required: ["startedAt", "endedAt", "durationMs"],
      properties: {
        startedAt: { type: "string", format: "date-time" },
        endedAt: { type: "string", format: "date-time" },
        durationMs: { type: "number", minimum: 0 },
        runId: { type: "string", minLength: 1 },
        dryRun: { type: "boolean" },
      },
    },
  },
  allOf: [
    {
      if: { properties: { ok: { const: true } }, required: ["ok"] },
      then: {
        properties: { data: true },
        required: ["data"],
        not: { properties: { error: true }, required: ["error"] },
      },
      else: {
        properties: { error: true },
        required: ["error"],
        not: { properties: { data: true }, required: ["data"] },
      },
    },
  ],
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
