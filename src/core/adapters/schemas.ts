import { BenchPilotError } from "../errors/benchpilot-error.js";

export type SchemaJson = Record<string, unknown>;
export interface RuntimeSchema<T> {
  parse(value: unknown): T;
  describe(): SchemaJson;
}
const invalid = (message: string): never => {
  throw new BenchPilotError("INVALID_CAPABILITY_INPUT", 2, message);
};
export const stringSchema = (): RuntimeSchema<string> => ({
  parse: (value) =>
    typeof value === "string" ? value : invalid("Expected a string."),
  describe: () => ({ type: "string" }),
});
export const booleanSchema = (): RuntimeSchema<boolean> => ({
  parse: (value) =>
    typeof value === "boolean" ? value : invalid("Expected a boolean."),
  describe: () => ({ type: "boolean" }),
});
export const numberSchema = (): RuntimeSchema<number> => ({
  parse: (value) =>
    typeof value === "number" && Number.isFinite(value)
      ? value
      : invalid("Expected a finite number."),
  describe: () => ({ type: "number" }),
});
export const enumSchema = <T extends string>(
  values: readonly T[],
): RuntimeSchema<T> => ({
  parse: (value) =>
    typeof value === "string" && values.includes(value as T)
      ? (value as T)
      : invalid(`Expected one of: ${values.join(", ")}.`),
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
      ? value.map((item) => schema.parse(item))
      : invalid("Expected an array."),
  describe: () => ({ type: "array", items: schema.describe() }),
});
export const objectSchema = <T extends SchemaJson = SchemaJson>(
  description = "object",
): RuntimeSchema<T> => ({
  parse: (value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as T)
      : invalid(`Expected ${description}.`),
  describe: () => ({ type: "object", description }),
});
export const durationSchema = (): RuntimeSchema<number> => ({
  parse(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return invalid("Expected a duration.");
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
    if (!match) return invalid("Expected a duration.");
    return (
      Number(match[1]) *
      ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as Record<string, number>)[
        match[2]
      ]!
    );
  },
  describe: () => ({ type: "string", format: "duration" }),
});
