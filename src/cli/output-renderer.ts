import { coreErrorDefinition, type Json } from "../core.js";
import {
  isMessageKey,
  t,
  type Locale,
  type MessageKey,
} from "../i18n/index.js";
import type { Flags } from "./parser.js";
import { processOutputSink, type OutputSink } from "./output/sink.js";

export { processOutputSink, type OutputSink } from "./output/sink.js";

const machineResult = (value: unknown): Json => {
  if (
    value &&
    typeof value === "object" &&
    ((value as Json).schema === "benchpilot.result" ||
      (value as Json).schema === "benchpilot.help" ||
      (value as Json).schema === "benchpilot.help-index")
  )
    return value as Json;
  return {
    schema: "benchpilot.result",
    version: 2,
    ok: true,
    kind: "COMMAND_COMPLETED",
    data: value as Json,
  };
};

export function write(
  value: unknown,
  flags: Flags,
  plain?: string,
  sink: OutputSink = processOutputSink,
) {
  const machine = machineResult(value);
  const operation =
    machine &&
    typeof machine === "object" &&
    machine.schema === "benchpilot.result" &&
    machine.kind !== "COMMAND_COMPLETED" &&
    machine.dryRun !== true;
  sink.stdout.write(
    flags.json
      ? `${JSON.stringify(machine)}\n`
      : flags.jsonl
        ? operation
          ? ""
          : `${JSON.stringify({ schema: "benchpilot.event", version: 2, event: { type: "command.result", timestamp: new Date().toISOString() }, context: {}, data: { result: machine } })}\n`
        : (plain ?? `${JSON.stringify(value, null, 2)}\n`),
  );
}

const localizedErrorReason = (
  locale: Locale,
  kind: string,
  fallback: string,
) => {
  const key = coreErrorDefinition(kind)?.reason.key;
  if (isMessageKey(key)) return t(locale, key);
  // Adapter and operating-system diagnostics can be free-form. Keep English
  // details in machine output, while ensuring human Chinese output never
  // falls back to an untranslated message.
  if (locale === "zh-CN")
    return t(locale, "error.reason.untranslated", { kind });
  return fallback;
};

/** Human-only localization; machine DTO messages are deliberately untouched. */
export const humanErrorMessage = (
  locale: Locale,
  kind: string,
  fallback: string,
) => {
  const category = coreErrorDefinition(kind)?.category.key;
  const categoryKey: MessageKey = isMessageKey(category)
    ? category
    : "error.unknown";
  return t(locale, categoryKey, {
    message: localizedErrorReason(locale, kind, fallback),
  });
};
