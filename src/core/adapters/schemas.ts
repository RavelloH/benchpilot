export type SchemaJson = Record<string, unknown>;

export class SchemaValidationError extends Error {
  constructor(
    message: string,
    readonly path: Array<string | number> = [],
    readonly expected?: SchemaJson,
    readonly actual?: unknown,
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

export interface RuntimeSchema<T> {
  parse(value: unknown): T;
  describe(): SchemaJson;
}

type ObjectFields = Record<string, RuntimeSchema<unknown>>;
type ObjectValue<T extends ObjectFields> = {
  [K in keyof T]: T[K] extends RuntimeSchema<infer Value> ? Value : never;
};

const invalid = (
  message: string,
  expected?: SchemaJson,
  actual?: unknown,
): never => {
  throw new SchemaValidationError(message, [], expected, actual);
};

const nested = <T>(field: string, parse: () => T): T => {
  try {
    return parse();
  } catch (error) {
    if (error instanceof SchemaValidationError)
      throw new SchemaValidationError(
        error.message,
        [field, ...error.path],
        error.expected,
        error.actual,
      );
    throw error;
  }
};

export const stringSchema = (): RuntimeSchema<string> => ({
  parse: (value) =>
    typeof value === "string"
      ? value
      : invalid("Expected a string.", { type: "string" }, value),
  describe: () => ({ type: "string" }),
});

export const booleanSchema = (): RuntimeSchema<boolean> => ({
  parse: (value) =>
    typeof value === "boolean"
      ? value
      : invalid("Expected a boolean.", { type: "boolean" }, value),
  describe: () => ({ type: "boolean" }),
});

export const numberSchema = (): RuntimeSchema<number> => ({
  parse: (value) =>
    typeof value === "number" && Number.isFinite(value)
      ? value
      : invalid("Expected a finite number.", { type: "number" }, value),
  describe: () => ({ type: "number" }),
});

export const enumSchema = <T extends string>(
  values: readonly T[],
): RuntimeSchema<T> => ({
  parse: (value) =>
    typeof value === "string" && values.includes(value as T)
      ? (value as T)
      : invalid(
          `Expected one of: ${values.join(", ")}.`,
          { type: "string", enum: [...values] },
          value,
        ),
  describe: () => ({ type: "string", enum: [...values] }),
});

export const optional = <T>(
  schema: RuntimeSchema<T>,
): RuntimeSchema<T | undefined> => ({
  parse: (value) => (value === undefined ? undefined : schema.parse(value)),
  describe: () => ({ ...schema.describe(), optional: true }),
});

export const arraySchema = <T>(
  schema: RuntimeSchema<T>,
): RuntimeSchema<T[]> => ({
  parse: (value) =>
    Array.isArray(value)
      ? value.map((item, index) =>
          nested(String(index), () => schema.parse(item)),
        )
      : invalid("Expected an array.", { type: "array" }, value),
  describe: () => ({ type: "array", items: schema.describe() }),
});

export function objectSchema(): RuntimeSchema<SchemaJson>;
export function objectSchema<T extends ObjectFields>(
  fields: T,
): RuntimeSchema<ObjectValue<T>>;
export function objectSchema(description: string): RuntimeSchema<SchemaJson>;
export function objectSchema(
  fieldsOrDescription?: ObjectFields | string,
): RuntimeSchema<SchemaJson> {
  const fields =
    fieldsOrDescription === undefined || typeof fieldsOrDescription === "string"
      ? undefined
      : fieldsOrDescription;
  const description =
    typeof fieldsOrDescription === "string" ? fieldsOrDescription : "object";
  return {
    parse(value) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return invalid(`Expected ${description}.`, { type: "object" }, value);
      if (!fields) return value as SchemaJson;
      const source = value as SchemaJson;
      const unknown = Object.keys(source).find((key) => !fields[key]);
      if (unknown)
        return invalid(
          `Unknown field: ${unknown}.`,
          { type: "object", additionalProperties: false },
          value,
        );
      const result: SchemaJson = {};
      for (const [name, schema] of Object.entries(fields))
        result[name] = nested(name, () => schema.parse(source[name]));
      return result;
    },
    describe: () =>
      fields
        ? {
            type: "object",
            properties: Object.fromEntries(
              Object.entries(fields).map(([name, schema]) => [
                name,
                schema.describe(),
              ]),
            ),
            required: Object.entries(fields)
              .filter(([, schema]) => schema.describe().optional !== true)
              .map(([name]) => name),
            additionalProperties: false,
          }
        : { type: "object", description },
  };
}

export const durationSchema = (): RuntimeSchema<number> => ({
  parse(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string")
      return invalid("Expected a duration.", { format: "duration" }, value);
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
    if (!match)
      return invalid("Expected a duration.", { format: "duration" }, value);
    return (
      Number(match[1]) *
      ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as Record<string, number>)[
        match[2]
      ]!
    );
  },
  describe: () => ({ type: "string", format: "duration" }),
});
