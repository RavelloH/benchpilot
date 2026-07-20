import type { Json } from "../../core.js";
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
const listPage = (
  schema: "benchpilot.device-list" | "benchpilot.system-list",
  values: readonly Json[],
): CliDataPage<{
  schema: typeof schema;
  version: 1;
  items: readonly Entry[];
}> => {
  const data = { schema, version: 1 as const, items: entries(values) };
  return {
    data,
    jsonl: data.items.map((item) => ({ key: `items.${item.id}`, value: item })),
  };
};

export const deviceListDataPage = (input: { devices: readonly Json[] }) =>
  listPage("benchpilot.device-list", input.devices);
export const systemListDataPage = (input: { systems: readonly Json[] }) =>
  listPage("benchpilot.system-list", input.systems);

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
    jsonl: [{ key: `devices.${input.instance}`, value: input }],
  };
};
