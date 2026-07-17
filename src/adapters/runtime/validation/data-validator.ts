import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import type {
  CompiledAdapterBundleV2,
  JsonObject,
} from "../../contract/bundle.js";
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
  private readonly validators = new Map<string, Validator>();
  private readonly definitionRoots = new Set<string>();

  constructor(private readonly bundle: Readonly<CompiledAdapterBundleV2>) {
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
    value: unknown,
    capabilityId?: string,
    definition?: string,
  ): JsonObject {
    const validator = this.compile(kind, definition);
    if (validator(value)) return value as JsonObject;
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
    const cacheKey = `${kind}:${definition ?? ""}`;
    const cached = this.validators.get(cacheKey);
    if (cached) return cached;
    const schemaName =
      kind === "input" ? "inputs" : kind === "output" ? "outputs" : kind;
    const schema = this.bundle.schemas[schemaName];
    if (!schema)
      throw new AdapterRuntimeError(
        "ADAPTER_BUNDLE_INVALID",
        `Bundle has no ${schemaName} schema.`,
      );
    if (!definition) {
      const validator = this.ajv.compile(schema);
      this.validators.set(cacheKey, validator);
      return validator;
    }
    const schemaId =
      typeof schema.$id === "string"
        ? schema.$id
        : `benchpilot://adapter/${this.bundle.id}/${schemaName}`;
    if (!this.definitionRoots.has(schemaName)) {
      const rootSchema = { ...schema, $id: schemaId };
      this.ajv.compile(rootSchema);
      this.definitionRoots.add(schemaName);
    }
    const validator = this.ajv.compile({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $ref: `${schemaId}#/$defs/${escapePointer(definition)}`,
    });
    this.validators.set(cacheKey, validator);
    return validator;
  }
}

const pointer = (root: JsonObject, reference: string) =>
  reference.startsWith("#/")
    ? reference
        .slice(2)
        .split("/")
        .reduce<unknown>(
          (current, part) =>
            object(current)[part.replace(/~1/g, "/").replace(/~0/g, "~")],
          root,
        )
    : undefined;

/**
 * Redacts x-benchpilot-cli.secret values while following the JSON Schema
 * structures supported by Adapter Format v1. Unknown references are treated
 * conservatively: the value is retained only when no secret marker is known.
 */
export const redactWithSchema = ({
  rootSchema,
  schema,
  value,
}: {
  rootSchema: unknown;
  schema: unknown;
  value: unknown;
}): unknown => {
  const root = object(rootSchema);
  const visit = (
    schemas: unknown[],
    current: unknown,
    references: Set<string>,
  ): unknown => {
    let unresolvedReference = false;
    const expand = (rawSchemas: unknown[], seen: Set<string>): JsonObject[] =>
      rawSchemas.flatMap((raw) => {
        const node = object(raw);
        const output = [node];
        if (typeof node.$ref === "string") {
          if (seen.has(node.$ref)) unresolvedReference = true;
          else {
            const target = pointer(root, node.$ref);
            if (target === undefined) unresolvedReference = true;
            else
              output.push(...expand([target], new Set([...seen, node.$ref])));
          }
        }
        for (const branch of ["allOf", "anyOf", "oneOf"] as const)
          if (Array.isArray(node[branch]))
            output.push(...expand(node[branch] as unknown[], seen));
        return output;
      });
    const expanded = expand(schemas, references);
    if (
      expanded.some(
        (node) => object(object(node)["x-benchpilot-cli"]).secret === true,
      )
    )
      return "[REDACTED]";
    // Schema validation normally rejects this before execution. Should a bad
    // Bundle still reach redaction, prefer hiding a value to leaking a secret.
    if (unresolvedReference) return "[REDACTED]";
    const childReferences = new Set(references);
    for (const node of expanded)
      if (typeof object(node).$ref === "string")
        childReferences.add(String(object(node).$ref));
    if (Array.isArray(current))
      return current.map((item, index) => {
        const itemSchemas = expanded.flatMap((raw) => {
          const node = object(raw);
          const prefix = Array.isArray(node.prefixItems)
            ? node.prefixItems[index]
            : undefined;
          return [prefix ?? node.items].filter(
            (candidate) => candidate && typeof candidate === "object",
          );
        });
        return visit(itemSchemas, item, childReferences);
      });
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current as JsonObject).map(([key, item]) => {
        const childSchemas = expanded.flatMap((raw) => {
          const node = object(raw);
          const direct = object(node.properties)[key];
          const additional = node.additionalProperties;
          const combined = [
            direct,
            typeof additional === "object" ? additional : undefined,
          ];
          return combined.filter(
            (candidate) => candidate && typeof candidate === "object",
          );
        });
        return [key, visit(childSchemas, item, childReferences)];
      }),
    );
  };
  return visit([schema], value, new Set());
};

export const redactSecrets = (schema: unknown, value: unknown): unknown =>
  redactWithSchema({ rootSchema: schema, schema, value });
