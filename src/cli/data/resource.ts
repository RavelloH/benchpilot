import type { Json } from "../../core.js";
import { t } from "../../i18n/index.js";
import type { CliScreenNode } from "../presentation/page.js";
import { terminalTheme } from "../presentation/theme.js";
import type { CliDataPage } from "./page.js";

type Entry = {
  id: string;
  adapter?: string;
  members?: readonly { device: string; role?: string }[];
};
const object = (value: Json) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const entries = (values: readonly Json[]): Entry[] =>
  values.map((value) => {
    const input = object(value);
    return {
      id: typeof input.id === "string" ? input.id : "unknown",
      ...(typeof input.adapter === "string" ? { adapter: input.adapter } : {}),
      ...(Array.isArray(input.members)
        ? {
            members: input.members.flatMap((item) => {
              const member = object(item as Json);
              return typeof member.device === "string"
                ? [
                    {
                      device: member.device,
                      ...(typeof member.role === "string"
                        ? { role: member.role }
                        : {}),
                    },
                  ]
                : [];
            }),
          }
        : {}),
    };
  });
const width = (value: string) =>
  [...value].reduce((n, c) => n + (c.codePointAt(0)! > 0xff ? 2 : 1), 0);
const pad = (value: string, size: number) =>
  `${value}${" ".repeat(Math.max(1, size - width(value)))}`;

const listPage = (
  schema: "benchpilot.device-list" | "benchpilot.system-list",
  titleKey: "resourceResult.devices.title" | "resourceResult.systems.title",
  emptyKey: "resourceResult.devices.empty" | "resourceResult.systems.empty",
  values: readonly Json[],
): CliDataPage<{
  schema: typeof schema;
  version: 1;
  items: readonly Entry[];
}> => {
  const data = { schema, version: 1 as const, items: entries(values) };
  return {
    data,
    screen: (context): readonly CliScreenNode[] => {
      const theme = terminalTheme(context.color);
      const idWidth = Math.max(
        14,
        ...data.items.map((item) => width(item.id) + 2),
      );
      return [
        {
          text: theme.heading(t(context.locale, titleKey)),
          children: data.items.length
            ? data.items.map((item) => ({
                text: `${theme.command(pad(item.id, idWidth))}${item.adapter ? theme.argument(item.adapter) : item.members?.map((member) => member.device).join(", ") || ""}`,
              }))
            : [{ text: theme.muted(t(context.locale, emptyKey)) }],
        },
      ];
    },
    jsonl: data.items.map((item) => ({ key: `items.${item.id}`, value: item })),
  };
};

export const deviceListDataPage = (input: { devices: readonly Json[] }) =>
  listPage(
    "benchpilot.device-list",
    "resourceResult.devices.title",
    "resourceResult.devices.empty",
    input.devices,
  );
export const systemListDataPage = (input: { systems: readonly Json[] }) =>
  listPage(
    "benchpilot.system-list",
    "resourceResult.systems.title",
    "resourceResult.systems.empty",
    input.systems,
  );

export const systemDetailDataPage = (input: {
  name: string;
  displayName?: string;
  description?: string;
  labels?: readonly string[];
  members: readonly { device: string; role?: string }[];
  capabilities: readonly { id: string; summary: string }[];
}): CliDataPage<{
  schema: "benchpilot.system-detail";
  version: 1;
  system: typeof input;
}> => {
  const data = {
    schema: "benchpilot.system-detail" as const,
    version: 1 as const,
    system: input,
  };
  return {
    data,
    screen: (context) => {
      const theme = terminalTheme(context.color);
      const label = (key: string, value: string) => ({
        text: `${theme.muted(pad(t(context.locale, key as never), 14))}${theme.argument(value)}`,
      });
      return [
        {
          text: theme.heading(
            t(context.locale, "system.detail.title" as never),
          ),
          children: [
            label("system.detail.id", input.name),
            ...(input.displayName
              ? [label("system.detail.name", input.displayName)]
              : []),
            ...(input.description
              ? [label("system.detail.description", input.description)]
              : []),
            ...(input.labels?.length
              ? [label("system.detail.labels", input.labels.join(", "))]
              : []),
          ],
        },
        {
          text: theme.heading(
            t(context.locale, "system.detail.members" as never),
          ),
          children: input.members.map((member) => ({
            text: `${theme.command(pad(member.device, 18))}${member.role ? theme.argument(member.role) : theme.muted("-")}`,
          })),
        },
        {
          text: theme.heading(
            t(context.locale, "system.detail.capabilities" as never),
          ),
          children: input.capabilities.length
            ? input.capabilities.map((capability) => ({
                text: `${theme.command(pad(capability.id, 18))}${capability.summary}`,
              }))
            : [
                {
                  text: theme.muted(
                    t(
                      context.locale,
                      "system.detail.capabilitiesEmpty" as never,
                    ),
                  ),
                },
              ],
        },
      ];
    },
    jsonl: [
      ...input.members.map((member) => ({
        key: `members.${member.device}`,
        value: member,
      })),
      ...input.capabilities.map((capability) => ({
        key: `capabilities.${capability.id}`,
        value: capability,
      })),
    ],
  };
};

export const systemOperationDataPage = (input: {
  system: string;
  capability: string;
  policy: "parallel" | "serial-fail-fast";
  results: readonly {
    device: string;
    ok: boolean;
    result?: Json;
    error?: { kind: string; message: string };
  }[];
}): CliDataPage<{
  schema: "benchpilot.system-operation";
  version: 1;
  operation: typeof input;
}> => {
  const data = {
    schema: "benchpilot.system-operation" as const,
    version: 1 as const,
    operation: input,
  };
  return {
    data,
    screen: (context) => {
      const theme = terminalTheme(context.color);
      return [
        {
          text: theme.heading(
            t(context.locale, "system.operation.title" as never),
          ),
          children: [
            {
              text: `${theme.muted(pad(t(context.locale, "system.operation.system" as never), 14))}${theme.command(input.system)}`,
            },
            {
              text: `${theme.muted(pad(t(context.locale, "system.operation.capability" as never), 14))}${theme.command(input.capability)}`,
            },
          ],
        },
        {
          text: theme.heading(
            t(context.locale, "system.operation.results" as never),
          ),
          children: input.results.map((result) => ({
            text: `${theme.command(pad(result.device, 18))}${result.ok ? theme.success(t(context.locale, "system.operation.success" as never)) : theme.error(`${result.error?.kind ?? "ERROR"}: ${result.error?.message ?? ""}`)}`,
          })),
        },
      ];
    },
    jsonl: input.results.map((result) => ({
      key: `members.${result.device}`,
      value: result,
    })),
  };
};
export const deviceScanDataPage = (input: {
  devices: readonly Json[];
  adapters: readonly Json[];
}) => {
  const data = {
    schema: "benchpilot.device-scan" as const,
    version: 1 as const,
    devices: input.devices,
  };
  return {
    data,
    screen: (context: Parameters<CliDataPage<typeof data>["screen"]>[0]) => {
      const theme = terminalTheme(context.color);
      const rows = input.devices.map((value) => {
        const item = object(value);
        return {
          identity: String(item.identity || "unknown"),
          adapter: String(item.adapter || "unknown"),
          port: String(object(item.fields as Json).port || "-"),
        };
      });
      const identityWidth = Math.max(
        width(t(context.locale, "resourceResult.scan.identity")) + 2,
        ...rows.map((row) => width(row.identity) + 2),
      );
      const adapterWidth = Math.max(
        width(t(context.locale, "resourceResult.scan.adapter")) + 2,
        ...rows.map((row) => width(row.adapter) + 2),
      );
      return [
        {
          text: theme.heading(t(context.locale, "resourceResult.scan.title")),
          children: rows.length
            ? [
                {
                  text: `${theme.muted(pad(t(context.locale, "resourceResult.scan.identity"), identityWidth))}${theme.muted(pad(t(context.locale, "resourceResult.scan.adapter"), adapterWidth))}${theme.muted(t(context.locale, "resourceResult.scan.port"))}`,
                },
                ...rows.map((row) => ({
                  text: `${theme.command(pad(row.identity, identityWidth))}${theme.argument(pad(row.adapter, adapterWidth))}${row.port}`,
                })),
              ]
            : [
                {
                  text: theme.muted(
                    t(context.locale, "resourceResult.scan.empty"),
                  ),
                },
              ],
        },
      ];
    },
    jsonl: input.devices.map((value, index) => ({
      key: `devices.${String(object(value).identity || index)}`,
      value: object(value),
    })),
  } satisfies CliDataPage<typeof data>;
};

export const deviceAddedDataPage = (input: {
  instance: string;
  adapter: string;
  identity?: string;
  port?: string;
  path: string;
}): CliDataPage<{
  schema: "benchpilot.device-added";
  version: 1;
  device: typeof input;
}> => {
  const data = {
    schema: "benchpilot.device-added" as const,
    version: 1 as const,
    device: input,
  };
  return {
    data,
    screen: (context) => {
      const theme = terminalTheme(context.color);
      const row = (
        label:
          | "resourceResult.added.instance"
          | "resourceResult.added.adapter"
          | "resourceResult.added.identity"
          | "resourceResult.added.port"
          | "resourceResult.added.path",
        value: string,
        render: (value: string) => string,
      ) => ({
        text: `${theme.muted(pad(t(context.locale, label), 12))}${render(value)}`,
      });
      return [
        {
          text: theme.heading(t(context.locale, "resourceResult.added.title")),
          children: [
            row("resourceResult.added.instance", input.instance, theme.command),
            row("resourceResult.added.adapter", input.adapter, theme.argument),
            ...(input.identity
              ? [
                  row(
                    "resourceResult.added.identity",
                    input.identity,
                    theme.argument,
                  ),
                ]
              : []),
            ...(input.port
              ? [row("resourceResult.added.port", input.port, theme.argument)]
              : []),
            row("resourceResult.added.path", input.path, theme.muted),
          ],
        },
      ];
    },
    jsonl: [{ key: `devices.${input.instance}`, value: input }],
  };
};

export const deviceRemovedDataPage = (input: {
  instance: string;
  path: string;
}): CliDataPage<{
  schema: "benchpilot.device-removed";
  version: 1;
  device: typeof input;
}> => {
  const data = {
    schema: "benchpilot.device-removed" as const,
    version: 1 as const,
    device: input,
  };
  return {
    data,
    screen: (context) => {
      const theme = terminalTheme(context.color);
      return [
        {
          text: theme.heading(
            t(context.locale, "resourceResult.removed.title"),
          ),
          children: [
            {
              text: `${theme.muted(pad(t(context.locale, "resourceResult.removed.instance"), 12))}${theme.command(input.instance)}`,
            },
            {
              text: `${theme.muted(pad(t(context.locale, "resourceResult.removed.path"), 12))}${theme.muted(input.path)}`,
            },
          ],
        },
      ];
    },
    jsonl: [{ key: `devices.${input.instance}`, value: input }],
  };
};
