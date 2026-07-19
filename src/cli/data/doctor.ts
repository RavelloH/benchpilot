import type { Json } from "../../core.js";
import { t } from "../../i18n/index.js";
import type { CliScreenNode } from "../presentation/page.js";
import { terminalTheme } from "../presentation/theme.js";
import type { CliDataPage, DataScreenContext } from "./page.js";

export interface DoctorCheckData {
  readonly id: string;
  readonly adapter?: string;
  readonly status: "pass" | "warn" | "fail" | "unknown";
  readonly message: string;
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
  };
};

const displayWidth = (value: string) =>
  [...value].reduce(
    (width, character) => width + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );

const pad = (value: string, width: number) =>
  `${value}${" ".repeat(Math.max(1, width - displayWidth(value)))}`;

const statusLabel = (
  status: DoctorCheckData["status"],
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
  status: DoctorCheckData["status"],
  context: DataScreenContext,
) => {
  const theme = terminalTheme(context.color);
  const label = statusLabel(status, context);
  if (status === "pass") return theme.success(label);
  if (status === "warn") return theme.warning(label);
  if (status === "fail") return theme.error(label);
  return theme.debug(label);
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
    screen: (context): readonly CliScreenNode[] => {
      const theme = terminalTheme(context.color);
      const idWidth = Math.max(
        14,
        ...data.checks.map((check) => displayWidth(check.id) + 2),
      );
      const table = (checks: readonly DoctorCheckData[]) => [
        {
          text: `${theme.muted(pad(t(context.locale, "doctor.id"), idWidth))}${theme.muted(pad(t(context.locale, "doctor.result"), 8))}${theme.muted(t(context.locale, "doctor.message"))}`,
        },
        ...checks.map((check) => ({
          text: `${theme.command(pad(check.id, idWidth))}${statusText(check.status, context)}${" ".repeat(Math.max(1, 8 - displayWidth(statusLabel(check.status, context))))}${check.message}`,
        })),
      ];
      const local = data.checks.filter((check) => !check.adapter);
      const adapters = [
        ...new Set(
          data.checks.flatMap((check) =>
            check.adapter ? [check.adapter] : [],
          ),
        ),
      ];
      return [
        {
          text: theme.heading(t(context.locale, "doctor.local")),
          children: table(local),
        },
        ...adapters.map((adapter) => ({
          text: theme.heading(t(context.locale, "doctor.adapter", { adapter })),
          children: table(
            data.checks.filter((check) => check.adapter === adapter),
          ),
        })),
      ];
    },
    jsonl: data.checks.map((check) => ({
      key: `checks.${check.adapter || "local"}.${check.id}`,
      value: check,
    })),
  };
};
