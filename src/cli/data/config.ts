import type { Json, Origin } from "../../core.js";
import type { CliDataPage } from "./page.js";

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
    jsonl: [{ key: "validation", value: { valid: true } }],
  };
};

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
