import type { JsonObject } from "./json.js";
import type { MessageRef } from "./message-ref.js";

export const CAPABILITY_OUTCOME_SCHEMA =
  "benchpilot.capability-outcome" as const;
export const CAPABILITY_OUTCOME_VERSION = 1 as const;

export type CapabilityScope = "device" | "system";
export type CapabilityExecutionStatus = "succeeded" | "failed" | "aborted";

/** Public, redacted artifact metadata. Artifact bytes remain in the Run. */
export interface CapabilityArtifact {
  readonly name: string;
  readonly kind: string;
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly createdAt: string;
  readonly metadata?: JsonObject;
}

/** A localizable diagnostic without a pre-rendered terminal string. */
export interface CapabilityDiagnostic {
  readonly level: "info" | "warning" | "error";
  readonly message: MessageRef;
  readonly adapter?: string;
  readonly details?: JsonObject;
}

export interface DeviceCapabilitySubject {
  readonly scope: "device";
  readonly adapter: string;
  readonly capability: string;
  readonly device: {
    readonly instance: string;
    readonly physicalId?: string;
  };
}

/** A system can contain devices from several adapters. */
export interface SystemCapabilitySubject {
  readonly scope: "system";
  readonly adapters: readonly string[];
  readonly capability: string;
  readonly system: {
    readonly instance: string;
  };
}

export type CapabilitySubject =
  DeviceCapabilitySubject | SystemCapabilitySubject;

export interface CapabilityExecution {
  readonly status: CapabilityExecutionStatus;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly runId?: string;
  readonly dryRun: boolean;
}

export interface CapabilityMemberOutcome {
  readonly device: {
    readonly instance: string;
    readonly physicalId?: string;
  };
  readonly outcome: Omit<CapabilityOutcome, "subject" | "members">;
}

/**
 * Locale-neutral public operation data consumed by Screen, JSON, and JSONL.
 * `output` is the Adapter output schema value after public redaction.
 */
export interface CapabilityOutcome {
  readonly schema: typeof CAPABILITY_OUTCOME_SCHEMA;
  readonly version: typeof CAPABILITY_OUTCOME_VERSION;
  readonly subject: CapabilitySubject;
  readonly execution: CapabilityExecution;
  readonly output?: JsonObject;
  readonly artifacts: readonly CapabilityArtifact[];
  readonly diagnostics: readonly CapabilityDiagnostic[];
  readonly members?: readonly CapabilityMemberOutcome[];
}

const messageRefSchema = {
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
} as const;

const artifactSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "kind", "path", "size", "sha256", "createdAt"],
  properties: {
    name: { type: "string", minLength: 1 },
    kind: { type: "string", minLength: 1 },
    path: { type: "string", minLength: 1 },
    size: { type: "integer", minimum: 0 },
    sha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
    createdAt: { type: "string", format: "date-time" },
    metadata: { type: "object" },
  },
} as const;

const executionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "startedAt", "endedAt", "durationMs", "dryRun"],
  properties: {
    status: { enum: ["succeeded", "failed", "aborted"] },
    startedAt: { type: "string", format: "date-time" },
    endedAt: { type: "string", format: "date-time" },
    durationMs: { type: "number", minimum: 0 },
    runId: { type: "string", minLength: 1 },
    dryRun: { type: "boolean" },
  },
} as const;

/** JSON Schema for every public Capability result, including system members. */
export const capabilityOutcomeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "benchpilot://schemas/capability-outcome/v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "version",
    "subject",
    "execution",
    "artifacts",
    "diagnostics",
  ],
  properties: {
    schema: { const: CAPABILITY_OUTCOME_SCHEMA },
    version: { const: CAPABILITY_OUTCOME_VERSION },
    subject: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["scope", "adapter", "capability", "device"],
          properties: {
            scope: { const: "device" },
            adapter: { type: "string", minLength: 1 },
            capability: { type: "string", minLength: 1 },
            device: {
              type: "object",
              additionalProperties: false,
              required: ["instance"],
              properties: {
                instance: { type: "string", minLength: 1 },
                physicalId: { type: "string", minLength: 1 },
              },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["scope", "adapters", "capability", "system"],
          properties: {
            scope: { const: "system" },
            adapters: {
              type: "array",
              minItems: 1,
              items: { type: "string", minLength: 1 },
              uniqueItems: true,
            },
            capability: { type: "string", minLength: 1 },
            system: {
              type: "object",
              additionalProperties: false,
              required: ["instance"],
              properties: { instance: { type: "string", minLength: 1 } },
            },
          },
        },
      ],
    },
    execution: executionSchema,
    output: { type: "object" },
    artifacts: { type: "array", items: artifactSchema },
    diagnostics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["level", "message"],
        properties: {
          level: { enum: ["info", "warning", "error"] },
          message: messageRefSchema,
          adapter: { type: "string", minLength: 1 },
          details: { type: "object" },
        },
      },
    },
    members: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["device", "outcome"],
        properties: {
          device: {
            type: "object",
            additionalProperties: false,
            required: ["instance"],
            properties: {
              instance: { type: "string", minLength: 1 },
              physicalId: { type: "string", minLength: 1 },
            },
          },
          outcome: {
            type: "object",
            additionalProperties: false,
            required: [
              "schema",
              "version",
              "execution",
              "artifacts",
              "diagnostics",
            ],
            properties: {
              schema: { const: CAPABILITY_OUTCOME_SCHEMA },
              version: { const: CAPABILITY_OUTCOME_VERSION },
              execution: executionSchema,
              output: { type: "object" },
              artifacts: { type: "array", items: artifactSchema },
              diagnostics: { type: "array" },
            },
          },
        },
      },
    },
  },
} as const;
