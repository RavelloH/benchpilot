export type Locale = "en" | "zh-CN";
export type MessageValues = Record<
  string,
  string | number | boolean | undefined
>;
export type MessageCatalog = Record<string, string>;
