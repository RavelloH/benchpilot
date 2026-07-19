import type { Locale } from "../i18n/index.js";
import type { Flags } from "./parser.js";
import {
  renderScreenNodes,
  type PresentationView,
} from "./presentation/page.js";
import type { CliDataPage } from "./data/page.js";

interface DataStart {
  readonly op: "start";
  readonly protocol: "benchpilot.data";
  readonly version: 1;
  readonly schema: string;
  readonly locale: Locale;
  readonly view: "normal" | "agent";
}

interface DataSnapshot {
  readonly op: "snapshot";
  readonly index: number;
  readonly key: string;
  readonly value: object;
}

interface DataComplete {
  readonly op: "complete";
  readonly count: number;
}

const schemaFor = (data: object) => {
  const schema = (data as { schema?: unknown }).schema;
  return typeof schema === "string" ? schema : "benchpilot.data";
};

/** Projects canonical data as a human screen view, JSON DTO, or data JSONL. */
export function renderDataPage<T extends object>(input: {
  readonly page: CliDataPage<T>;
  readonly flags: Flags;
  readonly locale: Locale;
  readonly view: PresentationView;
  readonly color: boolean;
}) {
  const view = input.view === "agent" ? "agent" : "normal";
  if (input.flags.json) {
    return `${JSON.stringify(input.page.data)}\n`;
  }
  if (input.flags.jsonl) {
    const items = input.page.jsonl ?? [
      { key: "result", value: input.page.data },
    ];
    const records: readonly (DataStart | DataSnapshot | DataComplete)[] = [
      {
        op: "start",
        protocol: "benchpilot.data",
        version: 1,
        schema: schemaFor(input.page.data),
        locale: input.locale,
        view,
      },
      ...items.map((item, index) => ({
        op: "snapshot" as const,
        index,
        key: item.key,
        value: item.value,
      })),
      { op: "complete", count: items.length },
    ];
    return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  }
  return renderScreenNodes(
    input.page.screen({
      locale: input.locale,
      color: view === "agent" ? false : input.color,
      view,
    }),
  );
}
