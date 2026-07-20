import type { CommandReference } from "../../contracts/index.js";
import type { Locale } from "../../i18n/index.js";
import type { CliDataPage } from "../data/page.js";
import type { Flags } from "../parser.js";
import { processOutputSink, type OutputSink } from "./sink.js";
import { dataPageOutputDefinition } from "./data-page-definition.js";
import {
  OutputEngine,
  outputMode,
  type ExternalMessageResolver,
} from "./engine.js";

/** Renders one semantic Data Page through the canonical Output Engine. */
export function renderDataPage<Data extends object>(input: {
  readonly command: CommandReference;
  readonly page: CliDataPage<Data>;
  readonly flags: Flags;
  readonly locale: Locale;
  readonly color: boolean;
  readonly columns?: number;
  readonly sink?: OutputSink;
  readonly messageResolver?: ExternalMessageResolver;
}) {
  const sink = input.sink ?? processOutputSink;
  new OutputEngine({
    mode: outputMode(input.flags),
    locale: input.locale,
    color: input.color,
    columns: input.columns ?? 80,
    output: sink.stdout,
    ...(input.messageResolver
      ? { messageResolver: input.messageResolver }
      : {}),
  }).render(
    dataPageOutputDefinition({
      command: input.command,
      page: input.page,
    }),
  );
}
