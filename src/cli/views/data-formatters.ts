import type { JsonValue } from "../../contracts/index.js";
import { isMessageKey, t } from "../../i18n/index.js";
import type { ExternalMessageResolver } from "../output/engine.js";
import type { DataFormatterId, FormattedCell } from "./data-types.js";
import type { Locale } from "../../i18n/index.js";

type JsonRow = Readonly<Record<string, JsonValue>>;

const valueAt = (row: JsonRow, path: string): JsonValue | undefined =>
  path.split(".").reduce<JsonValue | undefined>((value, segment) => {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value[segment]
      : undefined;
  }, row);

const text = (value: JsonValue | undefined) =>
  value === undefined || value === null
    ? ""
    : typeof value === "string"
      ? value
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

const object = (value: JsonValue | undefined): JsonRow =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const approvalCapability = (value: string, locale: Locale) => {
  const definitions: Readonly<Record<string, () => string>> = {
    info: () => t(locale, "approval.capability.info"),
    status: () => t(locale, "approval.capability.status"),
    build: () => t(locale, "approval.capability.build"),
    flash: () => t(locale, "approval.capability.flash"),
    deploy: () => t(locale, "approval.capability.deploy"),
    reset: () => t(locale, "approval.capability.reset"),
    capture: () => t(locale, "approval.capability.capture"),
    fullclean: () => t(locale, "approval.capability.fullclean"),
    erase: () => t(locale, "approval.capability.erase"),
  };
  return definitions[value]?.();
};

const approvalCommand = (
  value: JsonValue | undefined,
  row: JsonRow,
  locale: Locale,
): FormattedCell => {
  if (typeof value !== "string") return { text: "" };
  const stored = object(object(row.presentation).command);
  const capability =
    typeof stored.capability === "string"
      ? stored.capability
      : value.split(".").at(-1) || value;
  const description =
    approvalCapability(capability, locale) ??
    (typeof stored.summary === "string" ? stored.summary : capability);
  if (typeof stored.capability === "string") return { text: description };
  if (value.startsWith("device."))
    return { text: t(locale, "approval.command.device", { capability }) };
  if (value.startsWith("system."))
    return { text: t(locale, "approval.command.system", { capability }) };
  return { text: t(locale, "approval.command.other", { command: value }) };
};

const approvalProject = (
  value: JsonValue | undefined,
  row: JsonRow,
  presentation: JsonValue | undefined,
): FormattedCell => {
  if (typeof value !== "string") return { text: "" };
  const stored = object(object(row.presentation).project);
  if (typeof stored.name === "string") return { text: stored.name };
  const screen = object(presentation);
  return {
    text:
      screen.projectId === value && typeof screen.projectName === "string"
        ? screen.projectName
        : value,
  };
};

const runStatus = (
  value: JsonValue | undefined,
  locale: Locale,
): FormattedCell => {
  const status = typeof value === "string" ? value : undefined;
  const definitions = {
    succeeded: { key: "run.status.succeeded", tone: "success" },
    failed: { key: "run.status.failed", tone: "error" },
    aborted: { key: "run.status.aborted", tone: "error" },
    running: { key: "run.status.running", tone: "warning" },
  } as const;
  const definition = status
    ? definitions[status as keyof typeof definitions]
    : undefined;
  return definition
    ? { text: t(locale, definition.key), tone: definition.tone }
    : {
        text: status || t(locale, "run.status.unknown"),
        tone: "debug",
      };
};

const approvalStatus = (
  value: JsonValue | undefined,
  locale: Locale,
): FormattedCell => {
  const labels = {
    pending: t(locale, "approval.status.pending"),
    approved: t(locale, "approval.status.approved"),
    rejected: t(locale, "approval.status.rejected"),
    claimed: t(locale, "approval.status.claimed"),
    consumed: t(locale, "approval.status.consumed"),
  } as const;
  const status = typeof value === "string" ? value : "";
  const tones = {
    pending: "warning",
    approved: "success",
    rejected: "error",
    claimed: "warning",
    consumed: "debug",
  } as const;
  return {
    text: labels[status as keyof typeof labels] ?? status,
    tone: tones[status as keyof typeof tones] ?? "debug",
  };
};

const lockLiveness = (
  value: JsonValue | undefined,
  locale: Locale,
): FormattedCell => {
  const labels = {
    active: t(locale, "lock.list.liveness.active"),
    stale: t(locale, "lock.list.liveness.stale"),
    unknown: t(locale, "lock.list.liveness.unknown"),
  } as const;
  const tones = {
    active: "success",
    stale: "warning",
    unknown: "debug",
  } as const;
  const state = value === "active" || value === "stale" ? value : "unknown";
  return { text: labels[state], tone: tones[state] };
};

const lockState = (
  value: JsonValue | undefined,
  locale: Locale,
): FormattedCell => {
  const labels = {
    active: t(locale, "lock.detail.state.active"),
    quarantined: t(locale, "lock.detail.state.quarantined"),
    "quarantine-failed": t(locale, "lock.detail.state.quarantineFailed"),
  } as const;
  const tones = {
    active: "success",
    quarantined: "warning",
    "quarantine-failed": "error",
  } as const;
  const state =
    value === "active" || value === "quarantined" ? value : "quarantine-failed";
  return { text: labels[state], tone: tones[state] };
};

const doctorStatus = (
  value: JsonValue | undefined,
  locale: Locale,
): FormattedCell => {
  const labels = {
    pass: t(locale, "doctor.status.pass"),
    warn: t(locale, "doctor.status.warn"),
    fail: t(locale, "doctor.status.fail"),
    unknown: t(locale, "doctor.status.unknown"),
  } as const;
  const tones = {
    pass: "success",
    warn: "warning",
    fail: "error",
    unknown: "debug",
  } as const;
  const status =
    value === "pass" || value === "warn" || value === "fail"
      ? value
      : "unknown";
  return { text: labels[status], tone: tones[status] };
};

const diagnosticMessage = (
  row: JsonRow,
  locale: Locale,
  resolver?: ExternalMessageResolver,
): FormattedCell => {
  const fallback = typeof row.message === "string" ? row.message : "";
  if (typeof row.messageKey !== "string") return { text: fallback };
  const values =
    row.messageValues &&
    typeof row.messageValues === "object" &&
    !Array.isArray(row.messageValues)
      ? Object.fromEntries(
          Object.entries(row.messageValues).flatMap(([key, value]) =>
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
              ? [[key, value]]
              : [],
          ),
        )
      : {};
  const adapter = typeof row.adapter === "string" ? row.adapter : undefined;
  const external = adapter
    ? resolver?.({ adapter, key: row.messageKey, values, fallback })
    : undefined;
  if (external) return { text: external };
  return {
    text: isMessageKey(row.messageKey)
      ? t(locale, row.messageKey, values)
      : fallback,
  };
};

const resourceSummary = (row: JsonRow, field: string): FormattedCell => {
  if (field === "adapter" && typeof row.adapter === "string")
    return { text: row.adapter, tone: "argument" };
  const members = Array.isArray(row.members) ? row.members : [];
  return {
    text: members
      .flatMap((member) =>
        member &&
        typeof member === "object" &&
        !Array.isArray(member) &&
        typeof member.device === "string"
          ? [member.device]
          : [],
      )
      .join(", "),
  };
};

const origin = (value: JsonValue | undefined): FormattedCell => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { text: "-" };
  const scope = typeof value.scope === "string" ? value.scope : "-";
  return {
    text: typeof value.path === "string" ? `${scope}: ${value.path}` : scope,
  };
};

const scope = (value: JsonValue | undefined, locale: Locale): FormattedCell => {
  const labels = {
    local: t(locale, "configResult.scopeValue.local"),
    project: t(locale, "configResult.scopeValue.project"),
    global: t(locale, "configResult.scopeValue.global"),
  } as const;
  const label =
    typeof value === "string"
      ? labels[value as keyof typeof labels]
      : undefined;
  return { text: label ?? text(value) };
};

export const formatDataCell = (input: {
  readonly formatter: DataFormatterId;
  readonly row: JsonRow;
  readonly field: string;
  readonly locale: Locale;
  readonly messageResolver?: ExternalMessageResolver;
  readonly presentation?: JsonValue;
}): FormattedCell => {
  const value = valueAt(input.row, input.field);
  const formatters: Readonly<Record<DataFormatterId, () => FormattedCell>> = {
    string: () => ({ text: text(value) }),
    "fallback-dash": () => ({ text: text(value) || "—" }),
    "fallback-unknown": () => ({ text: text(value) || "unknown" }),
    "enabled-adapters": () => ({
      text:
        Array.isArray(value) && value.length
          ? value.map(String).join(", ")
          : t(input.locale, "init.none"),
    }),
    "duration-ms": () => ({
      text: typeof value === "number" ? `${value} ms` : text(value),
    }),
    "approval-status": () => approvalStatus(value, input.locale),
    "lock-liveness": () => lockLiveness(value, input.locale),
    "lock-state": () => lockState(value, input.locale),
    "lock-resource": () => ({
      text:
        value && typeof value === "object" && !Array.isArray(value)
          ? `${text(value.adapter)} / ${text(value.kind)}`
          : "",
    }),
    "comma-list": () => ({
      text: Array.isArray(value) ? value.map(String).join(", ") : text(value),
    }),
    "json-value": () => ({
      text: value === undefined ? "undefined" : JSON.stringify(value),
    }),
    "json-value-optional": () => ({
      text: value === undefined ? "" : JSON.stringify(value),
    }),
    origin: () => origin(value),
    "resource-summary": () => resourceSummary(input.row, input.field),
    "run-status": () => runStatus(value, input.locale),
    scope: () => scope(value, input.locale),
    role: () => ({
      text: text(value) || "-",
      tone: text(value) ? "argument" : "muted",
    }),
    "system-result": () => {
      const ok = input.row.ok === true;
      const error = input.row.error;
      const detail =
        error && typeof error === "object" && !Array.isArray(error)
          ? `${typeof error.kind === "string" ? error.kind : "ERROR"}: ${typeof error.message === "string" ? error.message : ""}`
          : "ERROR: ";
      return {
        text: ok ? t(input.locale, "system.operation.success") : detail,
        tone: ok ? "success" : "error",
      };
    },
    "doctor-status": () => doctorStatus(value, input.locale),
    "diagnostic-message": () =>
      diagnosticMessage(input.row, input.locale, input.messageResolver),
    "approval-command": () => approvalCommand(value, input.row, input.locale),
    "approval-project": () =>
      approvalProject(value, input.row, input.presentation),
    "valid-status": () => ({
      text: t(input.locale, "configResult.validate.valid"),
      tone: "success",
    }),
    "upgrade-status": () => ({
      text: t(
        input.locale,
        value === true
          ? "upgradeResult.status.available"
          : "upgradeResult.status.current",
      ),
    }),
    "upgrade-version": () => ({
      text: `${text(input.row.previousVersion)} → ${text(input.row.installedVersion)}`,
    }),
  };
  return formatters[input.formatter]();
};
