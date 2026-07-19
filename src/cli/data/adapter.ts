import type { Json } from "../../core.js";
import { t } from "../../i18n/index.js";
import type { CliScreenNode } from "../presentation/page.js";
import { terminalTheme } from "../presentation/theme.js";
import type { CliDataPage, DataScreenContext } from "./page.js";

interface AdapterInfo {
  readonly id: string;
  readonly version: string;
  readonly summary: string;
}

interface AdapterCheck {
  readonly id: string;
  readonly status: "pass" | "warn" | "fail" | "unknown";
  readonly message: string;
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

const check = (value: Json): AdapterCheck => {
  const input = record(value);
  const status = input.status;
  return {
    id: typeof input.id === "string" ? input.id : "unknown",
    status:
      status === "pass" || status === "warn" || status === "fail"
        ? status
        : "unknown",
    message: typeof input.message === "string" ? input.message : "",
  };
};

const width = (value: string) =>
  [...value].reduce(
    (total, character) => total + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );
const pad = (value: string, size: number) =>
  `${value}${" ".repeat(Math.max(1, size - width(value)))}`;

const statusLabel = (
  status: AdapterCheck["status"],
  context: DataScreenContext,
) =>
  t(
    context.locale,
    status === "pass"
      ? "doctor.status.pass"
      : status === "warn"
        ? "doctor.status.warn"
        : status === "fail"
          ? "doctor.status.fail"
          : "doctor.status.unknown",
  );

const statusText = (
  status: AdapterCheck["status"],
  context: DataScreenContext,
) => {
  const theme = terminalTheme(context.color);
  const label = statusLabel(status, context);
  if (status === "pass") return theme.success(label);
  if (status === "warn") return theme.warning(label);
  if (status === "fail") return theme.error(label);
  return theme.debug(label);
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
    screen: (context): readonly CliScreenNode[] => {
      const theme = terminalTheme(context.color);
      const idWidth = Math.max(
        12,
        ...data.adapters.map((item) => width(item.id) + 2),
      );
      return [
        {
          text: theme.heading(t(context.locale, "adapterResult.list.title")),
          children: data.adapters.length
            ? data.adapters.map((item) => ({
                text: `${theme.command(pad(item.id, idWidth))}${theme.argument(pad(item.version, 10))}${item.summary}`,
              }))
            : [
                {
                  text: theme.muted(
                    t(context.locale, "adapterResult.list.empty"),
                  ),
                },
              ],
        },
      ];
    },
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
    screen: (context) => {
      const theme = terminalTheme(context.color);
      return [
        {
          text: theme.heading(t(context.locale, "adapterResult.info.title")),
          children: [
            {
              text: `${theme.muted(pad(t(context.locale, "adapterResult.id"), 12))}${theme.command(data.adapter.id)}`,
            },
            {
              text: `${theme.muted(pad(t(context.locale, "adapterResult.version"), 12))}${theme.argument(data.adapter.version)}`,
            },
            {
              text: `${theme.muted(pad(t(context.locale, "adapterResult.summary"), 12))}${data.adapter.summary}`,
            },
          ],
        },
      ];
    },
    jsonl: [{ key: `adapter.${data.adapter.id}`, value: data.adapter }],
  };
};

export const adapterDoctorDataPage = (input: {
  checks: readonly Json[];
}): CliDataPage<{
  schema: "benchpilot.adapter-doctor";
  version: 1;
  checks: readonly AdapterCheck[];
}> => {
  const data = {
    schema: "benchpilot.adapter-doctor" as const,
    version: 1 as const,
    checks: input.checks.map(check),
  };
  return {
    data,
    screen: (context) => {
      const theme = terminalTheme(context.color);
      const idWidth = Math.max(
        14,
        ...data.checks.map((item) => width(item.id) + 2),
      );
      return [
        {
          text: theme.heading(t(context.locale, "adapterResult.doctor.title")),
          children: [
            {
              text: `${theme.muted(pad(t(context.locale, "doctor.id"), idWidth))}${theme.muted(pad(t(context.locale, "doctor.result"), 8))}${theme.muted(t(context.locale, "doctor.message"))}`,
            },
            ...data.checks.map((item) => ({
              text: `${theme.command(pad(item.id, idWidth))}${statusText(item.status, context)}${" ".repeat(Math.max(1, 8 - width(statusLabel(item.status, context))))}${item.message}`,
            })),
          ],
        },
      ];
    },
    jsonl: data.checks.map((item) => ({
      key: `checks.${item.id}`,
      value: item,
    })),
  };
};
