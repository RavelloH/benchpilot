export type ConfigurationScope = "local" | "project" | "global";

export interface ConfigurationCatalogChoice {
  readonly value: string;
}

export interface ConfigurationCatalogEntry {
  readonly key: string;
  readonly editor: "text" | "select" | "multi-select";
  readonly scopes: readonly ConfigurationScope[];
  readonly choices?: readonly ConfigurationCatalogChoice[];
}

/** Built-in configuration semantics, independent of CLI wording and prompts. */
export const configurationCatalog: readonly ConfigurationCatalogEntry[] = [
  { key: "project.id", editor: "text", scopes: ["project"] },
  { key: "project.name", editor: "text", scopes: ["project"] },
  {
    key: "defaults.timeout",
    editor: "text",
    scopes: ["local", "project", "global"],
  },
  { key: "adapters.enabled", editor: "multi-select", scopes: ["project"] },
  {
    key: "approval.level",
    editor: "select",
    scopes: ["local", "global"],
    choices: [{ value: "strict" }, { value: "default" }, { value: "bypass" }],
  },
  {
    key: "cli.locale",
    editor: "select",
    scopes: ["global"],
    choices: [{ value: "en" }, { value: "zh-CN" }],
  },
];

export const configurationCatalogEntry = (key: string) =>
  configurationCatalog.find((entry) => entry.key === key);
