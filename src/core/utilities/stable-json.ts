import { createHash } from "node:crypto";

export const stable = (input: unknown): string =>
  JSON.stringify(input, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );

export const sha = (input: unknown) =>
  createHash("sha256")
    .update(typeof input === "string" ? input : stable(input))
    .digest("hex");
