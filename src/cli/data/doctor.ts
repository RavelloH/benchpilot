import type { Json } from "../../core.js";
import type { CliDataPage } from "./page.js";

export interface DoctorCheckData {
  readonly id: string;
  readonly adapter?: string;
  readonly status: "pass" | "warn" | "fail" | "unknown";
  readonly message: string;
  readonly messageKey?: string;
  readonly messageValues?: Readonly<Record<string, string | number | boolean>>;
}

export interface DoctorData {
  readonly schema: "benchpilot.doctor";
  readonly version: 1;
  readonly checks: readonly DoctorCheckData[];
}

const record = (value: Json): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const normalize = (value: Json): DoctorCheckData => {
  const input = record(value);
  const status = input.status;
  return {
    id: typeof input.id === "string" ? input.id : "unknown",
    ...(typeof input.adapter === "string" ? { adapter: input.adapter } : {}),
    status:
      status === "pass" || status === "warn" || status === "fail"
        ? status
        : "unknown",
    message: typeof input.message === "string" ? input.message : "",
    ...(typeof input.messageKey === "string"
      ? { messageKey: input.messageKey }
      : {}),
    ...(input.messageValues &&
    typeof input.messageValues === "object" &&
    !Array.isArray(input.messageValues)
      ? {
          messageValues: input.messageValues as Record<
            string,
            string | number | boolean
          >,
        }
      : {}),
  };
};

export const doctorDataPage = (input: {
  readonly checks: readonly Json[];
}): CliDataPage<DoctorData> => {
  const data: DoctorData = {
    schema: "benchpilot.doctor",
    version: 1,
    checks: input.checks.map(normalize),
  };
  return {
    data,
    jsonl: data.checks.map((check) => ({
      key: `checks.${check.adapter || "local"}.${check.id}`,
      value: check,
    })),
  };
};
