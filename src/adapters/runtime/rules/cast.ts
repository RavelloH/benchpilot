export type CastKind = "string" | "integer" | "number" | "boolean" | "json";

export const castValue = (value: unknown, kind: CastKind): unknown => {
  if (kind === "string") return String(value);
  if (kind === "integer") {
    if (typeof value === "number")
      return Number.isFinite(value) ? Math.trunc(value) : undefined;
    if (typeof value !== "string" || !/^[+-]?\d+$/.test(value))
      return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (kind === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (kind === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  }
  if (kind === "json") {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
};
