import type { Json, Origin } from "../../core.js";
import { t } from "../../i18n/index.js";
import type { CliScreenNode } from "../presentation/page.js";
import { terminalTheme, type TerminalTheme } from "../presentation/theme.js";
import type { CliDataPage, DataScreenContext } from "./page.js";

export interface ConfigResolvedData {
  readonly schema: "benchpilot.config-resolved";
  readonly version: 1;
  readonly config: Json;
  readonly origins: Readonly<Record<string, Origin>>;
}

export interface ConfigExplainLayerData {
  readonly scope: string;
  readonly path?: string;
  readonly value: unknown;
}

export interface ConfigExplainData {
  readonly schema: "benchpilot.config-explain";
  readonly version: 1;
  readonly key: string;
  readonly value: unknown;
  readonly origin?: Origin;
  readonly layers: readonly ConfigExplainLayerData[];
}

export interface ConfigValidateData {
  readonly schema: "benchpilot.config-validate";
  readonly version: 1;
  readonly valid: true;
}

export interface ConfigGetData {
  readonly schema: "benchpilot.config-get";
  readonly version: 1;
  readonly key: string;
  readonly value: unknown;
  readonly origin?: Origin;
}

export interface ConfigMutationData {
  readonly schema: "benchpilot.config-set" | "benchpilot.config-unset";
  readonly version: 1;
  readonly action: "set" | "unset";
  readonly key: string;
  readonly value?: unknown;
  readonly scope: "local" | "project" | "global";
  readonly path: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const displayWidth = (value: string) =>
  [...value].reduce(
    (width, character) => width + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );

const pad = (value: string, width: number) =>
  `${value}${" ".repeat(Math.max(1, width - displayWidth(value)))}`;

const valueText = (value: unknown) =>
  value === undefined ? "undefined" : JSON.stringify(value);

const originText = (origin: Origin | undefined) => {
  if (!origin) return "-";
  return origin.path ? `${origin.scope}: ${origin.path}` : origin.scope;
};

const section = (
  title: string,
  children: readonly CliScreenNode[],
  theme: TerminalTheme,
  lineBreak = false,
): CliScreenNode => ({ text: theme.heading(title), children, lineBreak });

const flatten = (
  value: unknown,
  prefix = "",
): readonly { key: string; value: unknown }[] => {
  if (!isRecord(value)) return prefix ? [{ key: prefix, value }] : [];
  const entries = Object.entries(value);
  if (!entries.length) return prefix ? [{ key: prefix, value }] : [];
  return entries.flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
};

const resolvedScreen = (
  data: ConfigResolvedData,
  context: DataScreenContext,
): readonly CliScreenNode[] => {
  const theme = terminalTheme(context.color);
  const entries = flatten(data.config);
  const labelWidth = 12;
  return [
    section(
      t(context.locale, "configResult.resolved.title"),
      entries.length
        ? entries.map((entry, index) => ({
            text: theme.command(entry.key),
            lineBreak: index < entries.length - 1,
            children: [
              {
                text: `${theme.muted(pad(t(context.locale, "configResult.value"), labelWidth))}${theme.argument(valueText(entry.value))}`,
              },
              {
                text: `${theme.muted(pad(t(context.locale, "configResult.origin"), labelWidth))}${theme.muted(originText(data.origins[entry.key]))}`,
              },
            ],
          }))
        : [
            {
              text: theme.muted(
                t(context.locale, "configResult.resolved.empty"),
              ),
            },
          ],
      theme,
    ),
  ];
};

export const configResolvedDataPage = (input: {
  config: Json;
  origins: Readonly<Record<string, Origin>>;
}): CliDataPage<ConfigResolvedData> => {
  const data: ConfigResolvedData = {
    schema: "benchpilot.config-resolved",
    version: 1,
    config: input.config,
    origins: input.origins,
  };
  return {
    data,
    screen: (context) => resolvedScreen(data, context),
    jsonl: flatten(data.config).map((entry) => ({
      key: `config.${entry.key}`,
      value: {
        key: entry.key,
        value: entry.value,
        ...(data.origins[entry.key] ? { origin: data.origins[entry.key] } : {}),
      },
    })),
  };
};

const explainScreen = (
  data: ConfigExplainData,
  context: DataScreenContext,
): readonly CliScreenNode[] => {
  const theme = terminalTheme(context.color);
  const labelWidth = 12;
  const row = (label: string, value: string, color = theme.argument) => ({
    text: `${theme.muted(pad(label, labelWidth))}${color(value)}`,
  });
  return [
    section(
      t(context.locale, "configResult.explain.title"),
      [
        row(t(context.locale, "configResult.key"), data.key, theme.command),
        row(t(context.locale, "configResult.value"), valueText(data.value)),
        row(
          t(context.locale, "configResult.origin"),
          originText(data.origin),
          theme.muted,
        ),
      ],
      theme,
    ),
    section(
      t(context.locale, "configResult.explain.layers"),
      [
        {
          text: `${theme.muted(pad(t(context.locale, "configResult.scope"), 16))}${theme.muted(pad(t(context.locale, "configResult.value"), 28))}${theme.muted(t(context.locale, "configResult.path"))}`,
        },
        ...data.layers.map((layer) => ({
          text: `${theme.command(pad(layer.scope, 16))}${theme.argument(pad(valueText(layer.value), 28))}${theme.muted(layer.path ?? "-")}`,
        })),
      ],
      theme,
      true,
    ),
  ];
};

export const configExplainDataPage = (input: {
  key: string;
  value: unknown;
  origin?: Origin;
  layers: readonly ConfigExplainLayerData[];
}): CliDataPage<ConfigExplainData> => {
  const data: ConfigExplainData = {
    schema: "benchpilot.config-explain",
    version: 1,
    ...input,
  };
  return {
    data,
    screen: (context) => explainScreen(data, context),
    jsonl: [
      {
        key: "resolved",
        value: {
          key: data.key,
          value: data.value,
          ...(data.origin ? { origin: data.origin } : {}),
        },
      },
      ...data.layers.map((layer) => ({
        key: `layers.${layer.scope}`,
        value: layer,
      })),
    ],
  };
};

export const configValidateDataPage = (): CliDataPage<ConfigValidateData> => {
  const data: ConfigValidateData = {
    schema: "benchpilot.config-validate",
    version: 1,
    valid: true,
  };
  return {
    data,
    screen: (context) => {
      const theme = terminalTheme(context.color);
      return [
        section(
          t(context.locale, "configResult.validate.title"),
          [
            {
              text: `${theme.muted(pad(t(context.locale, "configResult.status"), 12))}${theme.success(t(context.locale, "configResult.validate.valid"))}`,
            },
          ],
          theme,
        ),
      ];
    },
    jsonl: [{ key: "validation", value: { valid: true } }],
  };
};

const scopeText = (
  scope: ConfigMutationData["scope"],
  context: DataScreenContext,
) =>
  t(
    context.locale,
    scope === "local"
      ? "configResult.scopeValue.local"
      : scope === "project"
        ? "configResult.scopeValue.project"
        : "configResult.scopeValue.global",
  );

export const configGetDataPage = (input: {
  key: string;
  value: unknown;
  origin?: Origin;
}): CliDataPage<ConfigGetData> => {
  const data: ConfigGetData = {
    schema: "benchpilot.config-get",
    version: 1,
    ...input,
  };
  return {
    data,
    screen: (context) => {
      const theme = terminalTheme(context.color);
      return [
        section(
          t(context.locale, "configResult.get.title"),
          [
            {
              text: `${theme.muted(pad(t(context.locale, "configResult.key"), 12))}${theme.command(data.key)}`,
            },
            {
              text: `${theme.muted(pad(t(context.locale, "configResult.value"), 12))}${theme.argument(valueText(data.value))}`,
            },
            {
              text: `${theme.muted(pad(t(context.locale, "configResult.origin"), 12))}${theme.muted(originText(data.origin))}`,
            },
          ],
          theme,
        ),
      ];
    },
    jsonl: [
      {
        key: `config.${data.key}`,
        value: {
          key: data.key,
          value: data.value,
          ...(data.origin ? { origin: data.origin } : {}),
        },
      },
    ],
  };
};

export const configMutationDataPage = (input: {
  action: "set" | "unset";
  key: string;
  value?: unknown;
  scope: "local" | "project" | "global";
  path: string;
}): CliDataPage<ConfigMutationData> => {
  const data: ConfigMutationData = {
    schema:
      input.action === "set"
        ? "benchpilot.config-set"
        : "benchpilot.config-unset",
    version: 1,
    ...input,
  };
  return {
    data,
    screen: (context) => {
      const theme = terminalTheme(context.color);
      return [
        section(
          t(
            context.locale,
            data.action === "set"
              ? "configResult.mutation.setTitle"
              : "configResult.mutation.unsetTitle",
          ),
          [
            {
              text: `${theme.muted(pad(t(context.locale, "configResult.key"), 12))}${theme.command(data.key)}`,
            },
            ...(data.action === "set"
              ? [
                  {
                    text: `${theme.muted(pad(t(context.locale, "configResult.value"), 12))}${theme.argument(valueText(data.value))}`,
                  },
                ]
              : []),
            {
              text: `${theme.muted(pad(t(context.locale, "configResult.scope"), 12))}${theme.argument(scopeText(data.scope, context))}`,
            },
            {
              text: `${theme.muted(pad(t(context.locale, "configResult.path"), 12))}${theme.muted(data.path)}`,
            },
          ],
          theme,
        ),
      ];
    },
    jsonl: [
      {
        key: `config.${data.key}`,
        value: {
          action: data.action,
          key: data.key,
          ...(data.action === "set" ? { value: data.value } : {}),
          scope: data.scope,
          path: data.path,
        },
      },
    ],
  };
};
