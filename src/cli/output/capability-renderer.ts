import { messageRef, type CommandResultV3 } from "../../contracts/index.js";
import type { AdapterCapabilityView } from "../../adapters/contract/views.js";
import type { Flags } from "../parser.js";
import { outputMode, type OutputWriter } from "./engine.js";
import type { DeferredOperationReporter } from "./deferred-operation-reporter.js";
import {
  renderDataView,
  renderDataViewDefinition,
} from "../views/data-screen-renderer.js";
import type { DataViewDefinition } from "../views/data-types.js";
import type { DataViewRenderContext } from "../views/data-types.js";
import type { ExternalMessageResolverInput } from "./engine.js";
import { dataViewDefinitions } from "../views/data-views.js";
import type { Locale } from "../../i18n/index.js";

const adapterViewDefinition = (
  capability: string,
  view: AdapterCapabilityView,
): DataViewDefinition =>
  view.kind === "completion"
    ? {
        id: `adapter.${capability}`,
        blocks: [
          {
            component: "StaticMessage",
            message: messageRef(
              view.message.key,
              undefined,
              view.message.fallback,
            ),
            tone: "success",
          },
        ],
      }
    : view.kind === "detail"
      ? {
          id: `adapter.${capability}`,
          blocks: [
            {
              component: "Detail",
              source: "output",
              title: messageRef(view.title.key, undefined, view.title.fallback),
              empty: view.empty
                ? messageRef(view.empty.key, undefined, view.empty.fallback)
                : messageRef("capabilityResult.output.empty"),
              labelWidth: 16,
              rows: view.fields.map((field) => ({
                field: field.selector,
                label: messageRef(
                  field.label.key,
                  undefined,
                  field.label.fallback,
                ),
                formatter: field.formatter,
                omitEmpty: true,
              })),
            },
          ],
        }
      : view.kind === "tree"
        ? {
            id: `adapter.${capability}`,
            blocks: [
              {
                component: "ObjectTree",
                source: "output",
                title: messageRef(
                  view.title.key,
                  undefined,
                  view.title.fallback,
                ),
                empty: view.empty
                  ? messageRef(view.empty.key, undefined, view.empty.fallback)
                  : messageRef("capabilityResult.output.empty"),
                labelWidth: 10,
                rows: [
                  {
                    field: "value",
                    label: messageRef("capabilityResult.value"),
                    formatter: "json-value",
                  },
                ],
              },
            ],
          }
        : {
            id: `adapter.${capability}`,
            blocks: [
              {
                component: "KeyValueTable",
                source: "output",
                title: messageRef(
                  view.title.key,
                  undefined,
                  view.title.fallback,
                ),
                empty: view.empty
                  ? messageRef(view.empty.key, undefined, view.empty.fallback)
                  : messageRef("capabilityResult.output.empty"),
                keyLabels: Object.fromEntries(
                  Object.entries(view.keys).map(([key, label]) => [
                    key,
                    messageRef(label.key, undefined, label.fallback),
                  ]),
                ),
              },
            ],
          };

const deviceViewWithAdapterOutput = (
  capability: string,
  view: AdapterCapabilityView,
  succeeded: boolean,
): DataViewDefinition => {
  const generic = dataViewDefinitions.find(
    (definition) => definition.id === "capability.device",
  );
  if (!generic) throw new Error("Missing generic device capability View.");
  const outputIndex = generic.blocks.findIndex(
    (block) => block.component === "ObjectTree" && block.source === "output",
  );
  if (outputIndex < 0)
    throw new Error("Missing generic capability output View.");
  if (view.kind === "completion" && !succeeded) return generic;
  return {
    id: `adapter.${capability}`,
    blocks: [
      ...generic.blocks.slice(0, outputIndex),
      ...adapterViewDefinition(capability, view).blocks,
      ...generic.blocks.slice(outputIndex + 1),
    ],
  };
};

/** The sole renderer for a completed Device Capability Result. */
export const renderCapabilityResult = (input: {
  readonly result: CommandResultV3;
  readonly flags: Flags;
  readonly output: OutputWriter;
  readonly reporter?: DeferredOperationReporter;
  readonly locale: Locale;
  readonly color: boolean;
  readonly columns: number;
  readonly view?: AdapterCapabilityView;
  readonly adapterId?: string;
  readonly translate?: (
    locale: string,
    key: string,
    variables?: Record<string, string>,
  ) => string | undefined;
}) => {
  const mode = outputMode(input.flags);
  if (mode === "json") {
    input.output.write(`${JSON.stringify(input.result)}\n`);
    return;
  }
  if (mode === "jsonl") {
    input.reporter?.complete({
      type: input.result.ok ? "command.completed" : "command.failed",
      result: input.result,
    });
    return;
  }
  const data = input.result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  const subject = data.subject as { scope?: string } | undefined;
  const messageResolver = input.translate
    ? ({ adapter, key, values }: ExternalMessageResolverInput) =>
        adapter
          ? input.translate?.(
              input.locale,
              key,
              Object.fromEntries(
                Object.entries(values).map(([name, value]) => [
                  name,
                  String(value),
                ]),
              ),
            )
          : undefined
    : undefined;
  const context: Omit<DataViewRenderContext, "data"> = {
    locale: input.locale,
    color: input.color,
    columns: input.columns,
    ...(input.adapterId ? { adapter: input.adapterId } : {}),
    ...(messageResolver ? { messageResolver } : {}),
  };
  input.output.write(
    subject?.scope === "device" && input.view
      ? renderDataViewDefinition(
          deviceViewWithAdapterOutput(
            input.result.command.id,
            input.view,
            input.result.ok,
          ),
          data,
          context,
        )
      : renderDataView(
          subject?.scope === "system"
            ? "capability.system"
            : "capability.device",
          data,
          context,
        ),
  );
};
