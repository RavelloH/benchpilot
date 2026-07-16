import { redactWithSchema } from "./data-validator.js";

/** Redacts known user-supplied secrets from operational logs and diagnostics. */
export class SecretRedactor {
  private readonly values: string[];

  constructor(values: Iterable<string>) {
    this.values = [
      ...new Set([...values].filter((value) => value.length >= 4)),
    ].sort((left, right) => right.length - left.length);
  }

  redactText(value: string) {
    return this.values.reduce(
      (output, secret) => output.split(secret).join("[REDACTED]"),
      value,
    );
  }

  redactValue<T>(value: T): T {
    if (typeof value === "string") return this.redactText(value) as T;
    if (Array.isArray(value))
      return value.map((item) => this.redactValue(item)) as T;
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, this.redactValue(item)]),
    ) as T;
  }
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Extracts values only at schema locations marked as CLI secrets. */
export const secretValuesWithSchema = (
  rootSchema: unknown,
  schema: unknown,
  value: unknown,
) => {
  const redacted = redactWithSchema({ rootSchema, schema, value });
  const values: string[] = [];
  const visit = (actual: unknown, masked: unknown) => {
    if (masked === "[REDACTED]") {
      if (typeof actual === "string") values.push(actual);
      return;
    }
    if (Array.isArray(actual) && Array.isArray(masked))
      actual.forEach((item, index) => visit(item, masked[index]));
    else if (
      actual &&
      typeof actual === "object" &&
      masked &&
      typeof masked === "object"
    )
      for (const [key, item] of Object.entries(object(actual)))
        visit(item, object(masked)[key]);
  };
  visit(value, redacted);
  return values;
};
