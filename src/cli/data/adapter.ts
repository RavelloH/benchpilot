import type { Json } from "../../core.js";
import type { CliDataPage } from "./page.js";

interface AdapterInfo {
  readonly id: string;
  readonly version: string;
  readonly summary: string;
}

interface AdapterCheck {
  readonly adapter?: string;
  readonly id: string;
  readonly status: "pass" | "warn" | "fail" | "unknown";
  readonly message: string;
  readonly messageKey?: string;
  readonly messageValues?: Readonly<Record<string, string | number | boolean>>;
}

const record = (value: Json): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const info = (value: Json): AdapterInfo => {
  const input = record(value);
  return {
    id: typeof input.id === "string" ? input.id : "unknown",
    version: typeof input.version === "string" ? input.version : "-",
    summary: typeof input.summary === "string" ? input.summary : "",
  };
};

const check = (value: Json, adapter?: string): AdapterCheck => {
  const input = record(value);
  const status = input.status;
  return {
    ...(adapter ? { adapter } : {}),
    id: typeof input.id === "string" ? input.id : "unknown",
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

export const adapterListDataPage = (input: {
  adapters: readonly Json[];
}): CliDataPage<{
  schema: "benchpilot.adapter-list";
  version: 1;
  adapters: readonly AdapterInfo[];
}> => {
  const data = {
    schema: "benchpilot.adapter-list" as const,
    version: 1 as const,
    adapters: input.adapters.map(info),
  };
  return {
    data,
    jsonl: data.adapters.map((item) => ({
      key: `adapters.${item.id}`,
      value: item,
    })),
  };
};

export const adapterInfoDataPage = (
  input: Json,
): CliDataPage<{
  schema: "benchpilot.adapter";
  version: 1;
  adapter: AdapterInfo;
}> => {
  const data = {
    schema: "benchpilot.adapter" as const,
    version: 1 as const,
    adapter: info(input),
  };
  return {
    data,
    jsonl: [{ key: `adapter.${data.adapter.id}`, value: data.adapter }],
  };
};

export const adapterDoctorDataPage = (
  adapter: string,
  input: {
    checks: readonly Json[];
  },
): CliDataPage<{
  schema: "benchpilot.adapter-doctor";
  version: 1;
  checks: readonly AdapterCheck[];
}> => {
  const data = {
    schema: "benchpilot.adapter-doctor" as const,
    version: 1 as const,
    checks: input.checks.map((value) => check(value, adapter)),
  };
  return {
    data,
    jsonl: data.checks.map((item) => ({
      key: `checks.${item.id}`,
      value: item,
    })),
  };
};
