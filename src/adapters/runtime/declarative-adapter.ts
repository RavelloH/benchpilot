import {
  BenchPilotError,
  duration,
  objectSchema,
  type Adapter,
  type AdapterContext,
  type AdapterServices,
  type Capability,
  type DeviceRuntime,
  type Json,
  type OperationContext,
  type RuntimeSchema,
} from "../../core.js";
import { DeclarativeCapabilityRunner } from "./capability-runner.js";
import { AdapterRuntimeError } from "./errors.js";
import { lookup, object, type RuleObject } from "./rules/template.js";
import type { RuntimeAdapter } from "./types.js";
import {
  AdapterDataValidator,
  redactSecrets,
} from "./validation/data-validator.js";

const validatorSchema = (
  validator: AdapterDataValidator,
  kind: "config" | "device" | "input" | "output",
  capabilityId?: string,
  definition?: string,
): RuntimeSchema<Json> => ({
  parse: (value) =>
    validator.validate(kind, value, capabilityId, definition) as Json,
  describe: () => ({ type: "object" }),
});

const physicalId = (rules: RuleObject, instance: string, device: Json) => {
  const identity = object(object(rules.devices).identity);
  for (const field of Array.isArray(identity.fields) ? identity.fields : []) {
    const value = lookup({ device }, String(field));
    if (value !== undefined && value !== "") return String(value);
  }
  if (identity.allow_port_fallback === true && typeof device.port === "string")
    return device.port;
  return instance;
};

const capabilityFor = (
  id: string,
  value: RuleObject,
  adapter: RuntimeAdapter,
  adapterConfig: Json,
  device: Json,
): Capability => {
  const validator = new AdapterDataValidator(adapter.bundle);
  const catalog = object(object(adapter.bundle.capabilityCatalog).capabilities);
  const safety = object(value.safety);
  const inputDefinition = String(value.input_schema);
  const outputDefinition = String(value.output_schema);
  return {
    id,
    summary: String(object(catalog[id]).description ?? id),
    defaultTimeoutMs: duration(value.timeout, 10_000),
    lockMode: value.lock === "device" ? "exclusive" : "none",
    createsRun: value.creates_run === true,
    safety: {
      mode:
        safety.mode === "danger-flag" || safety.mode === "human-approval"
          ? safety.mode
          : "normal",
      ...(typeof safety.flag === "string" ? { flag: safety.flag } : {}),
      ...(typeof safety.description === "string"
        ? { effects: [safety.description] }
        : {}),
      ...(safety.mode === "human-approval" ? { approvalTtlMs: 3_600_000 } : {}),
    },
    inputSchema: validatorSchema(validator, "input", id, inputDefinition),
    outputSchema: validatorSchema(validator, "output", id, outputDefinition),
    async execute(context: OperationContext, input: Json) {
      try {
        return await new DeclarativeCapabilityRunner(
          adapter,
          adapterConfig,
          device,
        ).execute(id, value, context, input);
      } catch (error) {
        if (error instanceof AdapterRuntimeError)
          throw new BenchPilotError(
            error.code,
            5,
            error.message,
            error.retryable,
            undefined,
            error.recovery,
            error.details,
          );
        throw error;
      }
    },
  };
};

class DeclarativeDevice implements DeviceRuntime {
  readonly identity;

  constructor(
    private readonly adapter: RuntimeAdapter,
    private readonly instance: string,
    private readonly device: Json,
    private readonly adapterConfig: Json,
  ) {
    this.identity = {
      instance,
      physicalId: physicalId(adapter.rules, instance, device),
      adapter: adapter.bundle.id,
    };
  }

  capabilities(): Capability[] {
    const current = adapterPlatform();
    return Object.entries(object(this.adapter.rules.capabilities)).flatMap(
      ([id, raw]) => {
        const value = object(raw);
        if (value.enabled !== true || object(value.platforms)[current] !== true)
          return [];
        return [
          capabilityFor(
            id,
            value,
            this.adapter,
            this.adapterConfig,
            this.device,
          ),
        ];
      },
    );
  }
}

const adapterPlatform = () =>
  process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : "linux";

/** Turns a validated compiled bundle into the legacy Core Adapter contract. */
export const createDeclarativeAdapter = (runtime: RuntimeAdapter): Adapter => {
  const validator = new AdapterDataValidator(runtime.bundle);
  return {
    id: runtime.bundle.id,
    apiVersion: 1,
    version: String(runtime.bundle.manifest.adapter_version),
    summary: String(runtime.bundle.manifest.display_name),
    description: String(runtime.bundle.manifest.description),
    configSchema: validatorSchema(validator, "config"),
    redactConfig(config) {
      return redactSecrets(runtime.bundle.schemas.config, config) as Json;
    },
    deviceConfigSchema: {
      parse(value) {
        if (!value || typeof value !== "object" || Array.isArray(value))
          return validator.validate("device", value) as Json;
        const device: Json = { ...(value as Json) };
        delete device.adapter;
        return validator.validate("device", device) as Json;
      },
      describe: () => ({ type: "object" }),
    },
    redactDeviceConfig(config) {
      return redactSecrets(runtime.bundle.schemas.device, config) as Json;
    },
    async discover(_context: AdapterContext) {
      return [];
    },
    async doctor(_context: AdapterContext) {
      return [
        {
          id: `${runtime.bundle.id}-bundle`,
          status: "pass",
          message: `Adapter bundle ready for ${runtime.platform}.`,
        },
      ];
    },
    async createDevice(
      instance: string,
      deviceConfig: Json,
      services: AdapterServices,
    ) {
      return new DeclarativeDevice(
        runtime,
        instance,
        deviceConfig,
        services.adapterConfig,
      );
    },
  };
};
