import type { JsonObject, JsonValue } from "../../contracts/index.js";
import type { MessageRef } from "../../contracts/message-ref.js";
import type {
  HelpFieldDefinition,
  HelpCommandEntry,
  HelpDocument,
} from "../../application/commands/help.js";
import { resolveMessage, type Locale } from "../../i18n/index.js";

export type LocalizedMessageData = JsonObject & {
  key: string;
  text: string;
};

export type HelpFieldData = JsonObject & {
  name: string;
  kind: "argument" | "option";
  summary: LocalizedMessageData;
  negatable?: boolean;
  choices?: string[];
};

export type HelpGroupData = JsonObject & {
  id: string;
  label: LocalizedMessageData;
  order: number;
  views: string[];
};

export type HelpExampleData = JsonObject & {
  argv: string[];
  description?: LocalizedMessageData;
};

export type HelpChildData = JsonObject & {
  id: string;
  path: JsonValue[];
  usage: string;
  summary: LocalizedMessageData;
  navigationSummary?: LocalizedMessageData;
  availability: "available" | "unavailable";
  group?: LocalizedMessageData;
  groupId?: string;
  order?: number;
};

export type HelpData = JsonObject & {
  schema: "benchpilot.help";
  version: 3;
  command: JsonObject & {
    id: string;
    path: JsonValue[];
    executable: boolean;
  };
  view: string;
  interactionView?: string;
  usage: JsonValue[];
  summary: LocalizedMessageData;
  description?: LocalizedMessageData;
  arguments: HelpFieldData[];
  options: HelpFieldData[];
  globalOptions: HelpFieldData[];
  groups: HelpGroupData[];
  children: HelpChildData[];
  examples: HelpExampleData[];
  footer: LocalizedMessageData[];
  errors: JsonValue[];
};

const jsonValue = (value: unknown): JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) =>
        child === undefined ? [] : [[key, jsonValue(child)]],
      ),
    );
  return String(value);
};

const messageData = (
  message: MessageRef,
  locale: Locale,
): LocalizedMessageData => ({
  key: message.key,
  text: resolveMessage(locale, message),
  ...(message.values ? { values: jsonValue(message.values) } : {}),
  ...(message.fallback ? { fallback: message.fallback } : {}),
});

const fieldData = (
  field: HelpFieldDefinition,
  locale: Locale,
): HelpFieldData => ({
  name: field.name,
  kind: field.kind,
  summary: messageData(field.summary, locale),
  ...(field.required ? { required: true } : {}),
  ...(field.position === undefined ? {} : { position: field.position }),
  ...(field.variadic ? { variadic: true } : {}),
  ...(field.value ? { value: field.value } : {}),
  ...(field.aliases ? { aliases: [...field.aliases] } : {}),
  ...(field.negatable ? { negatable: true } : {}),
  ...(field.repeatable ? { repeatable: true } : {}),
  ...(field.secret ? { secret: true } : {}),
  ...(field.schema ? { schema: jsonValue(field.schema) } : {}),
  ...(field.placeholder ? { placeholder: field.placeholder } : {}),
  ...(field.choices ? { choices: [...field.choices] } : {}),
});

const childData = (child: HelpCommandEntry, locale: Locale): HelpChildData => ({
  id: child.id,
  path: [...child.path],
  usage: child.usage,
  summary: messageData(child.summary, locale),
  ...(child.navigationSummary
    ? { navigationSummary: messageData(child.navigationSummary, locale) }
    : {}),
  availability: child.availability,
  ...(child.group ? { group: messageData(child.group, locale) } : {}),
  ...(child.groupId ? { groupId: child.groupId } : {}),
  ...(child.order === undefined ? {} : { order: child.order }),
});

/** Adds localized text while preserving every stable MessageRef key. */
export const projectHelpDocument = (
  document: HelpDocument,
  locale: Locale,
): HelpData => ({
  schema: document.schema,
  version: document.version,
  command: {
    id: document.command.id,
    path: [...document.command.path],
    executable: document.command.executable,
    ...(document.command.handler ? { handler: document.command.handler } : {}),
  },
  view: document.view,
  ...(document.interactionView
    ? { interactionView: document.interactionView }
    : {}),
  usage: [...document.usage],
  summary: messageData(document.summary, locale),
  ...(document.description
    ? { description: messageData(document.description, locale) }
    : {}),
  arguments: document.arguments.map((field) => fieldData(field, locale)),
  options: document.options.map((field) => fieldData(field, locale)),
  globalOptions: document.globalOptions.map((field) =>
    fieldData(field, locale),
  ),
  groups: document.groups.map((group) => ({
    id: group.id,
    label: messageData(group.label, locale),
    order: group.order,
    views: [...group.views],
  })),
  children: document.children.map((child) => childData(child, locale)),
  examples: document.examples.map((example) => ({
    argv: [...example.argv],
    ...(example.description
      ? { description: messageData(example.description, locale) }
      : {}),
  })),
  footer: document.footer.map((message) => messageData(message, locale)),
  ...(document.output ? { output: jsonValue(document.output) } : {}),
  ...(document.safety ? { safety: jsonValue(document.safety) } : {}),
  errors: [...document.errors],
});
