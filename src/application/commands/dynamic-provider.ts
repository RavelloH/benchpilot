import { messageRef } from "../../contracts/message-ref.js";
import {
  BenchPilotError,
  type CapabilityDescriptor,
  type Json,
} from "../../core.js";
import type { QueryUseCases } from "../queries/use-case.js";
import type { RuntimeUseCases } from "../runtime/use-case.js";
import type { SystemUseCases } from "../systems/use-case.js";
import type {
  CommandFieldDefinition,
  DynamicCommandProvider,
  DynamicCommandProviderContext,
  DynamicCommandValue,
} from "./definition.js";

export interface ApplicationDynamicCommandProviderDependencies {
  readonly queries: QueryUseCases;
  readonly systems: SystemUseCases;
  readonly runtime: RuntimeUseCases;
  readonly upgradeVersions?: () => Promise<readonly string[]>;
}

const record = (value: Json): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const fieldValue = (schema: Json | undefined) => {
  const type = record(schema ?? {}).type;
  return type === "boolean"
    ? "boolean"
    : type === "object" || type === "array"
      ? "json"
      : "string";
};

const capabilityValue = (
  capability: CapabilityDescriptor,
  namespace: string,
): DynamicCommandValue => {
  const fields = capability.options.map((option): CommandFieldDefinition => ({
    name: option.name,
    kind: option.positional === undefined ? "option" : "argument",
    summary: messageRef(
      `${namespace}.capability.${capability.id}.option.${option.name}.summary`,
      undefined,
      option.summary,
    ),
    ...(option.required ? { required: true } : {}),
    ...(option.positional === undefined ? {} : { position: option.positional }),
    ...(option.aliases ? { aliases: option.aliases } : {}),
    ...(option.repeatable ? { repeatable: true } : {}),
    ...(option.secret ? { secret: true } : {}),
    ...(option.schema ? { schema: option.schema } : {}),
    value: fieldValue(option.schema),
  }));
  return {
    value: capability.id,
    summary: messageRef(
      `${namespace}.capability.${capability.id}.summary`,
      undefined,
      capability.summary,
    ),
    arguments: fields.filter((field) => field.kind === "argument"),
    options: fields.filter((field) => field.kind === "option"),
    safety: capability.safety,
    operation: {
      kind: "static",
      timeoutMs: capability.defaultTimeoutMs,
      lockMode: capability.lockMode,
      safety: capability.safety,
      createsRun: capability.createsRun,
      ...(capability.ttyOnly ? { ttyOnly: true } : {}),
    },
    output: {
      id: `${namespace}.${capability.id}`,
      schema: `benchpilot.${namespace}.${capability.id}`,
      version: 1,
      view: `${namespace}.${capability.id}`,
    },
    availability: capability.availability,
  };
};

const idValues = (
  values: readonly Json[],
  namespace: string,
): DynamicCommandValue[] =>
  values.flatMap((item) => {
    const value = record(item);
    if (typeof value.id !== "string") return [];
    const fallback =
      typeof value.name === "string"
        ? value.name
        : typeof value.summary === "string"
          ? value.summary
          : value.id;
    return [
      {
        value: value.id,
        summary: messageRef(
          `${namespace}.${value.id}.summary`,
          undefined,
          fallback,
        ),
      },
    ];
  });

/** Bridges graph providers to existing read-only Application queries. */
export class ApplicationDynamicCommandProvider implements DynamicCommandProvider {
  constructor(
    private readonly dependencies: ApplicationDynamicCommandProviderDependencies,
  ) {}

  async values(
    context: DynamicCommandProviderContext,
  ): Promise<readonly DynamicCommandValue[]> {
    const { provider, captures } = context;
    if (provider === "adapters")
      return this.dependencies.queries
        .listAdapters()
        .adapters.map((adapter) => {
          const fields =
            context.definition.id === "adapter.configure"
              ? this.dependencies.queries.adapterConfigurationFields(adapter.id)
              : [];
          const installation =
            context.definition.id === "adapter.install"
              ? this.dependencies.queries.adapterInstallation(adapter.id)
              : undefined;
          return {
            value: adapter.id,
            summary: messageRef(
              `adapter.${adapter.id}.summary`,
              undefined,
              adapter.summary,
            ),
            ...(fields.length
              ? {
                  options: fields.map((field): CommandFieldDefinition => ({
                    name: field.key,
                    kind: "option",
                    summary: messageRef(
                      "field.adapterConfigPath",
                      { key: field.key },
                      `Path for ${field.key}.`,
                    ),
                    required: field.required,
                    value: "string",
                    placeholder: "path",
                  })),
                }
              : {}),
            ...(installation
              ? {
                  options: [
                    {
                      name: "root",
                      kind: "option" as const,
                      summary: messageRef("field.adapterInstallRoot"),
                      value: "string" as const,
                      placeholder: "path",
                    },
                    ...installation.fields.map(
                      (field): CommandFieldDefinition => ({
                        name: field.key,
                        kind: "option",
                        summary: messageRef(
                          "field.adapterInstallValue",
                          { key: field.key },
                          field.summary,
                        ),
                        required: field.required,
                        value: "string",
                        placeholder: field.separator
                          ? "value[,value...]"
                          : "value",
                        ...(field.choices
                          ? {
                              enum: field.choices.map((choice) => choice.value),
                            }
                          : {}),
                        ...(field.separator
                          ? { separator: field.separator }
                          : {}),
                      }),
                    ),
                  ],
                }
              : {}),
          };
        });
    if (provider === "configured-devices")
      return idValues(
        this.dependencies.queries.listConfiguredDevices().devices,
        "device",
      );
    if (provider === "configured-systems")
      return idValues(
        this.dependencies.queries.listSystems().systems,
        "system",
      );
    if (provider === "device-capabilities") {
      const device = captures.device;
      if (typeof device !== "string") return [];
      const description =
        await this.dependencies.queries.deviceCapabilities(device);
      return description.capabilities.map((item) =>
        capabilityValue(item, `adapter.${description.adapter.id}`),
      );
    }
    if (provider === "system-capabilities") {
      const system = captures.system;
      if (typeof system !== "string") return [];
      const description = await this.dependencies.systems.describe(system);
      return description.capabilities.map((item) =>
        capabilityValue(item, "system"),
      );
    }
    if (provider === "upgrade-versions")
      return (
        (await this.dependencies.upgradeVersions?.())?.map((value) => ({
          value,
          summary: messageRef("command.upgrade.version"),
        })) ?? []
      );
    try {
      if (provider === "runs")
        return idValues(
          (await this.dependencies.runtime.listRuns())
            .runs as unknown as Json[],
          "run",
        );
      if (provider === "locks") {
        const listed = await this.dependencies.runtime.listLocks();
        return [...listed.locks, ...listed.corrupt].map((lock) => ({
          value: lock.lockId,
          summary: messageRef(
            `lock.${lock.lockId}.summary`,
            undefined,
            lock.lockId,
          ),
        }));
      }
      if (provider === "approvals")
        return idValues(
          (await this.dependencies.runtime.listApprovals())
            .approvals as unknown as Json[],
          "approval",
        );
    } catch (error) {
      if (
        error instanceof BenchPilotError &&
        error.kind === "PROJECT_NOT_FOUND"
      )
        return [];
      throw error;
    }
    return [];
  }
}
