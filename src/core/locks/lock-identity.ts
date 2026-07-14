import { createHash } from "node:crypto";

export interface PhysicalResourceIdentity {
  adapter: string;
  kind: string;
  physicalId: string;
}

const stable = (input: unknown): string =>
  JSON.stringify(input, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );

export function lockIdentity(identity: PhysicalResourceIdentity): string {
  const safe = (value: string) =>
    value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32) || "resource";
  const digest = createHash("sha256").update(stable(identity)).digest("hex");
  return `${safe(identity.adapter)}-${safe(identity.kind)}-${digest.slice(0, 32)}`;
}
