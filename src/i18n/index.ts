import { en } from "./en.js";
import { zhCN } from "./zh-CN.js";
import type { Locale, MessageCatalog, MessageValues } from "./types.js";

export type { Locale, MessageCatalog, MessageValues } from "./types.js";

const catalogs: Record<Locale, MessageCatalog> = { en, "zh-CN": zhCN };

export const isLocale = (value: unknown): value is Locale =>
  value === "en" || value === "zh-CN";

export function t(locale: Locale, key: string, values: MessageValues = {}) {
  const message = catalogs[locale][key] ?? catalogs.en[key] ?? key;
  return message.replace(/\{([a-zA-Z][\w]*)\}/g, (_, name: string) =>
    values[name] === undefined ? `{${name}}` : String(values[name]),
  );
}

export function assertCatalogCompleteness() {
  const expected = Object.keys(en).sort();
  for (const [locale, catalog] of Object.entries(catalogs))
    for (const key of expected)
      if (!catalog[key])
        throw new Error(`Missing i18n key ${key} in ${locale}.`);
}
