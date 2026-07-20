import {
  catalogs,
  type Locale,
  type MessageArgumentsFor,
  type MessageKey,
  type MessageValuesFor,
} from "./catalogs.generated.js";
import IntlMessageFormat from "intl-messageformat";
import type { MessageRef, MessageValue } from "../contracts/message-ref.js";
import type { MessageValues } from "./types.js";

export type {
  Locale,
  MessageArgumentsFor,
  MessageKey,
  MessageKeyWithValues,
  MessageValuesFor,
} from "./catalogs.generated.js";
export type { MessageValues } from "./types.js";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && value in catalogs;

export const isMessageKey = (value: unknown): value is MessageKey =>
  typeof value === "string" && value in catalogs.en;

const formatters = new Map<string, IntlMessageFormat>();

export function t<Key extends MessageKey>(
  locale: Locale,
  key: Key,
  ...args: MessageArgumentsFor<Key>
) {
  const cacheKey = `${locale}\0${key}`;
  let formatter = formatters.get(cacheKey);
  if (!formatter) {
    formatter = new IntlMessageFormat(
      catalogs[locale][key],
      locale,
      undefined,
      {
        ignoreTag: true,
      },
    );
    formatters.set(cacheKey, formatter);
  }
  return String(formatter.format((args[0] ?? {}) as MessageValues));
}

/** Creates a typed core-catalog reference without resolving a locale. */
export function msg<Key extends MessageKey>(
  key: Key,
  ...args: MessageArgumentsFor<Key>
): MessageRef<Key> {
  const values = args[0] as Readonly<Record<string, MessageValue>> | undefined;
  return { key, ...(values ? { values } : {}) };
}

/** Resolves core MessageRefs at the final CLI presentation boundary. */
export function resolveMessage(locale: Locale, message: MessageRef): string {
  if (!isMessageKey(message.key)) return message.fallback ?? message.key;
  return t(locale, message.key, message.values as MessageValuesFor<MessageKey>);
}
