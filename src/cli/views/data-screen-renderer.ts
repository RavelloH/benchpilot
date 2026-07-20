import {
  messageRef,
  type JsonValue,
  type MessageRef,
} from "../../contracts/index.js";
import { resolveMessage } from "../../i18n/index.js";
import { terminalTheme } from "../presentation/theme.js";
import { displayWidth } from "../terminal/text.js";
import { formatDataCell } from "./data-formatters.js";
import type {
  CellTone,
  DataViewBlockDefinition,
  DataViewDefinition,
  DataViewRenderContext,
  DetailBlockDefinition,
  FormattedCell,
  GroupedTableBlockDefinition,
  KeyValueTableBlockDefinition,
  ListBlockDefinition,
  LogBlockDefinition,
  MessageBlockDefinition,
  ObjectTreeBlockDefinition,
  StaticMessageBlockDefinition,
  TableBlockDefinition,
  TableColumnDefinition,
} from "./data-types.js";
import { dataViewDefinitions } from "./data-views.js";

type JsonRow = Readonly<Record<string, JsonValue>>;

const views = new Map(dataViewDefinitions.map((view) => [view.id, view]));

export const hasDataView = (viewId: string) => views.has(viewId);

const object = (value: JsonValue | undefined): JsonRow =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const resolveViewMessage = (
  context: DataViewRenderContext,
  message: MessageRef,
) => {
  const values = Object.fromEntries(
    Object.entries(message.values ?? {}).flatMap(([key, value]) =>
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
        ? [[key, value]]
        : [],
    ),
  );
  return (
    (context.adapter &&
      context.messageResolver?.({
        adapter: context.adapter,
        key: message.key,
        values,
        fallback: message.fallback ?? message.key,
      })) ??
    resolveMessage(context.locale, message)
  );
};

const valueAt = (data: JsonValue, path: string): JsonValue | undefined =>
  path
    ? path.split(".").reduce<JsonValue | undefined>((value, segment) => {
        const record = object(value);
        return record[segment];
      }, data)
    : data;

const rowsAt = (data: JsonValue, path: string): readonly JsonRow[] => {
  const value = valueAt(data, path);
  return Array.isArray(value) ? value.map((item) => object(item)) : [];
};

const flattenObject = (
  value: JsonValue,
  prefix = "",
): readonly { readonly key: string; readonly value: JsonValue }[] => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return prefix ? [{ key: prefix, value }] : [];
  const entries = Object.entries(value);
  if (!entries.length) return prefix ? [{ key: prefix, value }] : [];
  return entries.flatMap(([key, child]) =>
    flattenObject(child, prefix ? `${prefix}.${key}` : key),
  );
};

const columnWidth = (
  column: TableColumnDefinition,
  header: string,
  cells: readonly FormattedCell[],
) => {
  if (!column.width) return 0;
  if (column.width.kind === "fixed") return column.width.size;
  const gap = column.width.gap;
  return Math.max(
    column.width.min,
    displayWidth(header) + gap,
    ...cells.map((cell) => displayWidth(cell.text) + gap),
  );
};

const padding = (
  column: TableColumnDefinition,
  width: number,
  value: string,
) => {
  if (!column.width) return "";
  const minimum = column.width.kind === "fixed" ? column.width.minimum : 1;
  return " ".repeat(Math.max(minimum, width - displayWidth(value)));
};

const paint = (
  tone: CellTone,
  value: string,
  theme: ReturnType<typeof terminalTheme>,
) => {
  const painters = {
    plain: (text: string) => text,
    heading: theme.heading,
    muted: theme.muted,
    command: theme.command,
    argument: theme.argument,
    success: theme.success,
    warning: theme.warning,
    error: theme.error,
    debug: theme.debug,
  } as const;
  return painters[tone](value);
};

const renderTable = (
  input: DataViewBlockDefinition,
  context: DataViewRenderContext,
) => {
  const block = input as TableBlockDefinition;
  const theme = terminalTheme(context.color);
  const rows = rowsAt(context.data, block.source);
  if (block.omitWhenEmpty && !rows.length) return "";
  const formatted = rows.map((row) =>
    block.columns.map((column) => {
      const cell = formatDataCell({
        formatter: column.formatter,
        row,
        field: column.field,
        locale: context.locale,
        ...(context.presentation ? { presentation: context.presentation } : {}),
        ...(context.messageResolver
          ? { messageResolver: context.messageResolver }
          : {}),
      });
      return { ...cell, tone: cell.tone ?? column.tone ?? "plain" };
    }),
  );
  const headers = block.columns.map((column) =>
    column.header ? resolveViewMessage(context, column.header) : "",
  );
  const widths = block.columns.map((column, index) =>
    columnWidth(
      column,
      headers[index]!,
      formatted.map((row) => row[index]!),
    ),
  );
  const renderCells = (cells: readonly FormattedCell[]) =>
    cells
      .map((cell, index) => {
        const column = block.columns[index]!;
        const gap = padding(column, widths[index]!, cell.text);
        return column.paddingTone === "outside"
          ? `${paint(cell.tone ?? "plain", cell.text, theme)}${gap}`
          : paint(cell.tone ?? "plain", `${cell.text}${gap}`, theme);
      })
      .join("");
  const lines =
    rows.length || block.headerWhenEmpty
      ? [
          ...(block.header
            ? [
                block.columns
                  .map((column, index) => {
                    const label = headers[index]!;
                    return theme.muted(
                      `${label}${padding(column, widths[index]!, label)}`,
                    );
                  })
                  .join(""),
              ]
            : []),
          ...formatted.map(renderCells),
        ]
      : block.empty
        ? [theme.muted(resolveViewMessage(context, block.empty))]
        : [];
  const title = theme.heading(resolveViewMessage(context, block.title));
  const output = lines.length
    ? `${title}\n${lines.map((line) => `  ${line}`).join("\n")}`
    : title;
  return block.lineBreakAfter ? `${output}\n` : output;
};

const renderDetail = (
  input: DataViewBlockDefinition,
  context: DataViewRenderContext,
) => {
  const block = input as DetailBlockDefinition;
  const theme = terminalTheme(context.color);
  const source = object(valueAt(context.data, block.source));
  const lines = block.rows.flatMap((row) => {
    const cell = formatDataCell({
      formatter: row.formatter,
      row: source,
      field: row.field,
      locale: context.locale,
      ...(context.presentation ? { presentation: context.presentation } : {}),
      ...(context.messageResolver
        ? { messageResolver: context.messageResolver }
        : {}),
    });
    if (row.omitEmpty && !cell.text) return [];
    const label = resolveViewMessage(context, row.label);
    const gap = " ".repeat(Math.max(1, block.labelWidth - displayWidth(label)));
    return [
      `${theme.muted(`${label}${gap}`)}${paint(cell.tone ?? row.tone ?? "plain", cell.text, theme)}`,
    ];
  });
  if (block.omitWhenEmpty && !lines.length) return "";
  const title = theme.heading(resolveViewMessage(context, block.title));
  if (!lines.length && block.empty)
    return `${title}\n  ${theme.muted(resolveViewMessage(context, block.empty))}`;
  return `${title}\n${lines.map((line) => `  ${line}`).join("\n")}`;
};

const renderMessage = (
  input: DataViewBlockDefinition,
  context: DataViewRenderContext,
) => {
  const block = input as MessageBlockDefinition;
  const key = String(valueAt(context.data, block.field));
  const message = block.messages[key];
  if (!message) throw new Error(`Message view has no value for ${key}`);
  return paint(
    block.tone,
    resolveViewMessage(context, message),
    terminalTheme(context.color),
  );
};

const renderStaticMessage = (
  input: DataViewBlockDefinition,
  context: DataViewRenderContext,
) => {
  const block = input as StaticMessageBlockDefinition;
  return paint(
    block.tone,
    resolveViewMessage(context, block.message),
    terminalTheme(context.color),
  );
};

const renderList = (
  input: DataViewBlockDefinition,
  context: DataViewRenderContext,
) => {
  const block = input as ListBlockDefinition;
  const theme = terminalTheme(context.color);
  const source = valueAt(context.data, block.source);
  const values = Array.isArray(source) ? source : [];
  const lines = values.length
    ? [
        ...values.slice(0, block.limit).map((value) => {
          const cell = formatDataCell({
            formatter: block.formatter,
            row: { value },
            field: "value",
            locale: context.locale,
            ...(context.presentation
              ? { presentation: context.presentation }
              : {}),
            ...(context.messageResolver
              ? { messageResolver: context.messageResolver }
              : {}),
          });
          return paint(cell.tone ?? block.tone ?? "plain", cell.text, theme);
        }),
        ...(block.overflow &&
        block.limit !== undefined &&
        values.length > block.limit
          ? [
              paint(
                block.overflow.tone,
                resolveViewMessage(context, {
                  ...block.overflow.message,
                  values: { count: values.length },
                }),
                theme,
              ),
            ]
          : []),
      ]
    : [theme.muted(resolveViewMessage(context, block.empty))];
  return `${theme.heading(resolveViewMessage(context, block.title))}\n${lines
    .map((line) => `  ${line}`)
    .join("\n")}`;
};

const renderLog = (
  input: DataViewBlockDefinition,
  context: DataViewRenderContext,
) => {
  const block = input as LogBlockDefinition;
  return String(valueAt(context.data, block.source) ?? "");
};

const renderObjectTree = (
  input: DataViewBlockDefinition,
  context: DataViewRenderContext,
) => {
  const block = input as ObjectTreeBlockDefinition;
  const theme = terminalTheme(context.color);
  const source = valueAt(context.data, block.source) ?? {};
  const metadata = object(
    block.metadataSource
      ? valueAt(context.data, block.metadataSource)
      : undefined,
  );
  const entries = flattenObject(source);
  const title = theme.heading(resolveViewMessage(context, block.title));
  if (!entries.length)
    return `${title}\n  ${theme.muted(resolveViewMessage(context, block.empty))}`;
  const rendered = entries.map((entry) => {
    const rowData = { value: entry.value, origin: metadata[entry.key] };
    const rows = block.rows.map((row) => {
      const cell = formatDataCell({
        formatter: row.formatter,
        row: rowData,
        field: row.field,
        locale: context.locale,
        ...(context.presentation ? { presentation: context.presentation } : {}),
        ...(context.messageResolver
          ? { messageResolver: context.messageResolver }
          : {}),
      });
      const label = resolveViewMessage(context, row.label);
      const gap = " ".repeat(
        Math.max(1, block.labelWidth - displayWidth(label)),
      );
      return `    ${theme.muted(`${label}${gap}`)}${paint(cell.tone ?? row.tone ?? "plain", cell.text, theme)}`;
    });
    return `  ${theme.command(entry.key)}\n${rows.join("\n")}`;
  });
  return `${title}\n${rendered.join("\n\n")}`;
};

const renderKeyValueTable = (
  input: DataViewBlockDefinition,
  context: DataViewRenderContext,
) => {
  const block = input as KeyValueTableBlockDefinition;
  const rows = flattenObject(valueAt(context.data, block.source) ?? {}).map(
    (entry) => {
      const segment = entry.key.split(".").at(-1) ?? entry.key;
      const label = block.keyLabels[segment];
      return {
        key: entry.key,
        name: label ? resolveViewMessage(context, label) : segment,
        value: entry.value,
      };
    },
  );
  return renderTable(
    {
      component: "Table",
      source: "rows",
      title: block.title,
      empty: block.empty,
      header: true,
      columns: [
        {
          field: "key",
          header: messageRef("capabilityResult.key"),
          formatter: "string",
          tone: "command",
          width: { kind: "content", min: 24, gap: 2 },
        },
        {
          field: "name",
          header: messageRef("capabilityResult.name"),
          formatter: "string",
          width: { kind: "content", min: 16, gap: 2 },
        },
        {
          field: "value",
          header: messageRef("capabilityResult.value"),
          formatter: "string",
        },
      ],
    },
    { ...context, data: { rows } },
  );
};

const renderGroupedTable = (
  input: DataViewBlockDefinition,
  context: DataViewRenderContext,
) => {
  const block = input as GroupedTableBlockDefinition;
  const rows = rowsAt(context.data, block.source);
  const groupValues = [
    "",
    ...new Set(
      rows.flatMap((row) =>
        typeof row[block.groupBy] === "string"
          ? [String(row[block.groupBy])]
          : [],
      ),
    ),
  ];
  return groupValues
    .map((groupValue) => {
      const groupedRows = rows.filter((row) =>
        groupValue
          ? row[block.groupBy] === groupValue
          : typeof row[block.groupBy] !== "string",
      );
      if (groupValue && !groupedRows.length) return "";
      const title = groupValue
        ? {
            ...block.groupTitle,
            values: { [block.groupValueName]: groupValue },
          }
        : block.defaultTitle;
      return renderTable(
        {
          component: "Table",
          source: "rows",
          title,
          header: block.header,
          headerWhenEmpty: block.headerWhenEmpty,
          columns: block.columns,
        },
        { ...context, data: { rows: groupedRows } },
      );
    })
    .filter(Boolean)
    .join("\n\n");
};

const dataComponents: Readonly<
  Record<
    DataViewBlockDefinition["component"],
    (block: DataViewBlockDefinition, context: DataViewRenderContext) => string
  >
> = {
  Table: renderTable,
  Detail: renderDetail,
  Message: renderMessage,
  StaticMessage: renderStaticMessage,
  List: renderList,
  Log: renderLog,
  ObjectTree: renderObjectTree,
  KeyValueTable: renderKeyValueTable,
  GroupedTable: renderGroupedTable,
};

/** Renders declarative data views without command-specific routing. */
export const renderDataView = (
  viewId: string,
  data: JsonValue,
  context: Omit<DataViewRenderContext, "data">,
) => {
  const view = views.get(viewId);
  if (!view) throw new Error(`Unknown data view: ${viewId}`);
  return renderDataViewDefinition(view, data, context);
};

/** Renders either a built-in View or compiled Adapter View metadata. */
export const renderDataViewDefinition = (
  view: DataViewDefinition,
  data: JsonValue,
  context: Omit<DataViewRenderContext, "data">,
) => {
  const renderContext = { ...context, data };
  return `${view.blocks
    .map((block) => dataComponents[block.component](block, renderContext))
    .filter(Boolean)
    .join("\n\n")}\n`;
};
