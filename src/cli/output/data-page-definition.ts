import type { CommandReference, JsonValue } from "../../contracts/index.js";
import { commandCatalogDefinition } from "../../application/commands/definitions.js";
import type { CliDataPage } from "../data/page.js";
import { hasDataView, renderDataView } from "../views/data-screen-renderer.js";
import type { StaticOutputDefinition } from "./engine.js";

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

export const dataPageOutputDefinition = <Data extends object>(input: {
  readonly command: CommandReference;
  readonly page: CliDataPage<Data>;
}): StaticOutputDefinition<JsonValue> => ({
  command: input.command,
  kind: "data",
  data: jsonValue(input.page.data),
  snapshots: (
    input.page.jsonl ?? [{ key: "result", value: input.page.data }]
  ).map((item) => ({ key: item.key, value: jsonValue(item.value) })),
  renderScreen(_data, context) {
    const viewId = commandCatalogDefinition.commands.find(
      (definition) => definition.id === input.command.id,
    )?.output?.view;
    if (!viewId || !hasDataView(viewId))
      throw new Error(
        `Command ${input.command.id} requires a declarative view`,
      );
    return renderDataView(viewId, jsonValue(input.page.data), {
      ...context,
      ...(input.page.presentation
        ? { presentation: jsonValue(input.page.presentation) }
        : {}),
    });
  },
});
