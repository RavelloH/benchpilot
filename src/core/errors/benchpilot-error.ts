export type ErrorDetails = Record<string, unknown>;

const defaultDiagnosticId = (kind: string) =>
  `core.${kind
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

const jsonSafe = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  )
    return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error)
    return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value))
      result[key] = jsonSafe(child, seen);
    seen.delete(value);
    return result;
  }
  return String(value);
};

export class BenchPilotError extends Error {
  constructor(
    public kind: string,
    public exitCode: number,
    message: string,
    public retryable = false,
    public stage?: string,
    public recovery: string[] = [],
    details: ErrorDetails = {},
    public diagnosticId = defaultDiagnosticId(kind),
  ) {
    super(message);
    this.name = "BenchPilotError";
    this.details = jsonSafe(details) as ErrorDetails;
  }

  public details: ErrorDetails;
}

export const fail = (
  kind: string,
  code: number,
  message: string,
  details: ErrorDetails = {},
): never => {
  throw new BenchPilotError(kind, code, message, false, undefined, [], details);
};
