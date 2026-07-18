import {
  catalogs,
  type Locale,
  type MessageKey,
} from "./catalogs.generated.js";
import type { MessageValues } from "./types.js";

export type { Locale, MessageKey } from "./catalogs.generated.js";
export type { MessageValues } from "./types.js";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && value in catalogs;

export function t(locale: Locale, key: MessageKey, values: MessageValues = {}) {
  const message = catalogs[locale][key];
  return message.replace(/\{([a-zA-Z][\w]*)\}/g, (_, name: string) =>
    values[name] === undefined ? `{${name}}` : String(values[name]),
  );
}
