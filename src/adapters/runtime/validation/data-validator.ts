import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import type {
  CompiledAdapterBundleV1,
  JsonObject,
} from "../../compiler/types.js";
import {
  AdapterRuntimeError,
  type AdapterRuntimeErrorCode,
} from "../errors.js";

type Validator = {
  (data: unknown): boolean;
  errors?: Array<{
    instancePath: string;
    schemaPath: string;
    message?: string;
  }>;
};
type Ajv = {
  compile(schema: unknown): Validator;
};
const Ajv2020 = Ajv2020Import as unknown as new (options: unknown) => Ajv;
const addFormats = addFormatsImport as unknown as (instance: Ajv) => void;
const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const escapePointer = (value: string) =>
  value.replace(/~/g, "~0").replace(/\//g, "~1");

export type ValidationKind = "config" | "device" | "input" | "output";

export class AdapterDataValidator {
  private readonly ajv: Ajv;

  constructor(private readonly bundle: Readonly<CompiledAdapterBundleV1>) {
    this.ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      useDefaults: true,
      coerceTypes: true,
      removeAdditional: false,
    });
    addFormats(this.ajv);
  }

  validate(
    kind: ValidationKind,
    value: JsonObject,
    capabilityId?: string,
    definition?: string,
  ): JsonObject {
    const validator = this.compile(kind, definition);
    if (validator(value)) return value;
    const error = validator.errors?.[0];
    const code: Record<ValidationKind, AdapterRuntimeErrorCode> = {
      config: "ADAPTER_CONFIG_INVALID",
      device: "DEVICE_CONFIG_INVALID",
      input: "CAPABILITY_INPUT_INVALID",
      output: "CAPABILITY_OUTPUT_INVALID",
    };
    throw new AdapterRuntimeError(
      code[kind],
      error?.message ?? `${kind} schema validation failed`,
      false,
      [],
      {
        adapterId: this.bundle.id,
        capabilityId,
        instancePath: error?.instancePath,
        schemaPath: error?.schemaPath,
      },
    );
  }

  private compile(kind: ValidationKind, definition?: string): Validator {
    const schemaName =
      kind === "input" ? "inputs" : kind === "output" ? "outputs" : kind;
    const schema = this.bundle.schemas[schemaName];
    if (!schema)
      throw new AdapterRuntimeError(
        "ADAPTER_BUNDLE_INVALID",
        `Bundle has no ${schemaName} schema.`,
      );
    if (!definition) return this.ajv.compile(schema);
    const schemaId =
      typeof schema.$id === "string"
        ? schema.$id
        : `benchpilot://adapter/${this.bundle.id}/${schemaName}`;
    const rootSchema = { ...schema, $id: schemaId };
    this.ajv.compile(rootSchema);
    return this.ajv.compile({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $ref: `${schemaId}#/$defs/${escapePointer(definition)}`,
    });
  }
}

export const redactSecrets = (schema: unknown, value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => redactSecrets({}, item));
  if (!value || typeof value !== "object") return value;
  const fields = object(object(schema).properties);
  return Object.fromEntries(
    Object.entries(value as JsonObject).map(([key, item]) => {
      const field = object(fields[key]);
      const cli = object(field["x-benchpilot-cli"]);
      return [
        key,
        cli.secret === true ? "[REDACTED]" : redactSecrets(field, item),
      ];
    }),
  );
};
