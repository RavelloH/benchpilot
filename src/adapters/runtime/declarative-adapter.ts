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
import {
  discoverDevices,
  discoverDevicesDetailed,
} from "./devices/discovery.js";
import { executeDeviceCommandSource } from "./devices/command-source.js";
import { normalizePortIdentity } from "./devices/identity.js";
import {
  EnvironmentResolver,
  environmentFor,
} from "./environments/resolver.js";
import { AdapterRuntimeError } from "./errors.js";
import { lookup, object, type RuleObject } from "./rules/template.js";
import type { RuntimeAdapter } from "./types.js";
import { ToolResolver } from "./tools/resolver.js";
import { inspectSchemaProperties } from "./validation/schema-inspector.js";
import {
  AdapterDataValidator,
  redactWithSchema,
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
    if (value !== undefined && value !== "")
      return String(field) === "device.port" && typeof value === "string"
        ? normalizePortIdentity(value)
        : String(value);
  }
  if (identity.allow_port_fallback === true && typeof device.port === "string")
    return normalizePortIdentity(device.port);
  return identity.allow_instance_fallback === true ? instance : undefined;
};

const capabilityFor = (
  id: string,
  value: RuleObject,
  adapter: RuntimeAdapter,
  adapterConfig: Json,
  device: Json,
  stableIdentity: boolean,
): Capability => {
  const validator = new AdapterDataValidator(adapter.bundle);
  const catalog = object(object(adapter.bundle.capabilityCatalog).capabilities);
  const safety = object(value.safety);
  const inputDefinition = String(value.input_schema);
  const outputDefinition = String(value.output_schema);
  const inputRoot = adapter.bundle.schemas.inputs;
  const inputSchema =
    object(object(inputRoot).$defs)[inputDefinition] ?? inputRoot;
  const optionSchema = (schema: Json): RuntimeSchema<unknown> => ({
    parse: (item) => item,
    describe: () => schema,
  });
  const options = inspectSchemaProperties(inputRoot, inputSchema).flatMap(
    ({ name, schema, required }) => {
      const cli = object(schema["x-benchpilot-cli"]);
      if (cli.hidden === true && cli.flag === false) return [];
      const positional =
        typeof cli.positional === "number" ? cli.positional : undefined;
      return [
        {
          // `name` is the schema property. CLI spellings are aliases so the
          // parsed object always validates against the input definition.
          name,
          summary: String(schema.description ?? name),
          required,
          schema: optionSchema(schema),
          aliases: [
            ...(typeof cli.flag === "string" ? [cli.flag] : []),
            ...(Array.isArray(cli.aliases) ? cli.aliases.map(String) : []),
          ],
          positional,
          secret: cli.secret === true,
          repeatable: cli.repeatable === true || schema.type === "array",
          hidden: cli.hidden === true,
        },
      ];
    },
  );
  return {
    id,
    summary: String(value.summary ?? object(catalog[id]).description ?? id),
    description:
      typeof value.description === "string" ? value.description : undefined,
    options,
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
    redactInput(input) {
      const root = adapter.bundle.schemas.inputs;
      return redactWithSchema({
        rootSchema: root,
        schema: inputSchema,
        value: input,
      }) as Json;
    },
    outputSchema: validatorSchema(validator, "output", id, outputDefinition),
    async execute(context: OperationContext, input: Json) {
      try {
        if (value.lock === "device" && !stableIdentity)
          throw new AdapterRuntimeError(
            "DEVICE_IDENTITY_UNAVAILABLE",
            "A device lock requires a stable physical identity.",
            false,
            [
              "Configure an identity field, enable port fallback, or use an explicitly simulated adapter.",
            ],
          );
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
  private readonly stableIdentity: boolean;

  constructor(
    private readonly adapter: RuntimeAdapter,
    private readonly instance: string,
    private readonly device: Json,
    private readonly adapterConfig: Json,
  ) {
    const stable = physicalId(adapter.rules, instance, device);
    this.stableIdentity = stable !== undefined;
    this.identity = {
      instance,
      physicalId: stable ?? `unstable:${instance}`,
      adapter: adapter.bundle.id,
      stable: this.stableIdentity,
    };
  }

  capabilities(): Capability[] {
    const current = adapterPlatform();
    const standard = object(this.adapter.rules.capabilities);
    const extensions = object(this.adapter.rules.extensions);
    for (const id of Object.keys(extensions))
      if (Object.hasOwn(standard, id))
        throw new AdapterRuntimeError(
          "ADAPTER_BUNDLE_INVALID",
          `Extension capability conflicts with standard capability: ${id}`,
        );
    return Object.entries({ ...standard, ...extensions }).flatMap(
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
            this.stableIdentity,
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

const doctorContext = (
  runtime: RuntimeAdapter,
  adapterConfig: Json,
  paths: AdapterContext["paths"],
): RuleObject => ({
  adapter: {
    id: runtime.bundle.id,
    version: runtime.bundle.manifest.adapter_version,
    manifest: runtime.bundle.manifest,
  },
  platform: runtime.platform,
  config: adapterConfig,
  device: {},
  input: {},
  project: { root: process.cwd() },
  home: paths.home,
  temp: process.env.TMPDIR ?? "",
  env: process.env,
  tool: {},
  discovery: {},
  environment: {},
  result: {},
});

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
    async discover(context: AdapterContext) {
      return (await this.discoverDetailed!(context)).devices;
    },
    async discoverDetailed(context: AdapterContext) {
      const detailed = await discoverDevicesDetailed(
        runtime.bundle.id,
        object(runtime.rules.devices),
        {
          command: (source) =>
            executeDeviceCommandSource(
              runtime,
              context.adapterConfig as RuleObject,
              source,
            ),
        },
      );
      let devices = detailed.devices;
      const request = context.discovery;
      const probe = object(object(runtime.rules.devices).probe);
      if (request?.probe !== true || probe.enabled !== true)
        return {
          devices: devices as unknown as Json[],
          diagnostics: detailed.sources as unknown as Json[],
        };
      if (
        (probe.may_reset_device === true || probe.destructive === true) &&
        request.confirmDeviceProbe !== true
      )
        throw new BenchPilotError(
          "ADAPTER_DISCOVERY_PROBE_REQUIRED",
          7,
          "This device probe can change hardware state and requires --confirm-device-probe.",
          false,
          undefined,
          [
            "Repeat with --probe --confirm-device-probe after verifying the device state.",
          ],
        );
      if (probe.may_reset_device === true || probe.destructive === true)
        throw new BenchPilotError(
          "ADAPTER_DISCOVERY_PROBE_REQUIRED",
          7,
          "Dangerous device probes are disabled until they can run in the controlled Probe Runtime.",
          false,
          undefined,
          ["Use a passive scan or wait for the controlled Probe Runtime."],
        );
      throw new BenchPilotError(
        "DEVICE_PROBE_CAPABILITY_REQUIRED",
        7,
        "Device probes must run as declared capabilities through the Operation Runner.",
        false,
        undefined,
        ["Use passive scan or configure a dedicated probe capability."],
      );
    },
    async doctor(context: AdapterContext) {
      const checks: Json[] = [
        {
          id: `${runtime.bundle.id}-bundle`,
          status: "pass",
          message: `Adapter bundle ready for ${runtime.platform}.`,
        },
      ];
      const rules = runtime.rules;
      const resolver = new ToolResolver(runtime.platform, process.env);
      const environments = new EnvironmentResolver();
      const runtimeContext: RuleObject = doctorContext(
        runtime,
        context.adapterConfig,
        context.paths,
      );
      for (const [id, raw] of Object.entries(object(rules.tools))) {
        const tool = object(raw);
        const required = tool.required === true;
        try {
          const launch = await resolver.resolve(
            String(id),
            object(rules.tools),
            object(rules.discoveries),
            runtimeContext,
            object(rules.parsers),
            { probe: false, adapterId: runtime.bundle.id },
          );
          const toolContext = object(runtimeContext.tool);
          const discoveryContext = object(runtimeContext.discovery);
          for (const current of launch.chain) {
            toolContext[current.toolId] = {
              executable: current.executable,
              argsPrefix: current.argsPrefix,
              environmentId: current.environmentId,
              discoveryId: current.discoveryId,
              discoveredPath: current.discoveredPath,
            };
            discoveryContext[current.discoveryId] = {
              path: current.discoveredPath,
              candidateId: current.candidateId,
            };
          }
          runtimeContext.tool = toolContext;
          runtimeContext.discovery = discoveryContext;
          const environment = await environments.resolveDetailed(
            launch.environmentId,
            object(rules.environments),
            runtimeContext,
            new AbortController().signal,
          );
          const probes = await resolver.probeChain(
            launch,
            object(rules.discoveries),
            runtimeContext,
            object(rules.parsers),
            environment.environment,
            runtime.bundle.id,
            undefined,
            undefined,
            environmentFor(
              environments,
              object(rules.environments),
              runtimeContext,
              new AbortController().signal,
            ),
          );
          checks.push({
            id: `${runtime.bundle.id}-tool-${id}`,
            status: "pass",
            message: required
              ? "Required tool resolved."
              : "Optional tool resolved.",
            // A parser can extract arbitrary tool output. Keep doctor output
            // safe by reporting the check, not its raw or extracted values.
            details: {
              tool: id,
              probed: [...probes.values()].some(
                (probe) => Object.keys(probe).length > 0,
              ),
            },
          });
        } catch (error) {
          checks.push({
            id: `${runtime.bundle.id}-tool-${id}`,
            status: required ? "fail" : "warn",
            message: required
              ? "Required tool check failed."
              : "Optional tool is unavailable.",
          });
        }
      }
      for (const [id, raw] of Object.entries(object(rules.environments))) {
        try {
          await environments.resolveDetailed(
            String(id),
            object(rules.environments),
            runtimeContext,
            new AbortController().signal,
          );
          checks.push({
            id: `${runtime.bundle.id}-environment-${id}`,
            status: "pass",
            message: "Environment resolved.",
          });
        } catch {
          checks.push({
            id: `${runtime.bundle.id}-environment-${id}`,
            status: "fail",
            message: "Environment could not be resolved.",
          });
        }
      }
      const discovery = object(object(rules.devices).discovery);
      if (discovery.enabled !== true)
        checks.push({
          id: `${runtime.bundle.id}-device-sources`,
          status: "warn",
          message: "Device discovery is disabled.",
        });
      else {
        try {
          const discoveryResult = await discoverDevicesDetailed(
            runtime.bundle.id,
            object(rules.devices),
            {
              command: (source) =>
                executeDeviceCommandSource(
                  runtime,
                  context.adapterConfig as RuleObject,
                  source,
                ),
            },
          );
          checks.push({
            id: `${runtime.bundle.id}-device-sources`,
            status: discoveryResult.sources.some(
              (source) => source.status === "fail",
            )
              ? discoveryResult.devices.length > 0
                ? "warn"
                : "fail"
              : "pass",
            message: discoveryResult.sources.some(
              (source) => source.status === "fail",
            )
              ? "One or more device discovery sources failed."
              : "Passive device discovery is available.",
            details: {
              candidates: discoveryResult.devices.length,
              sources: discoveryResult.sources,
            },
          });
        } catch {
          checks.push({
            id: `${runtime.bundle.id}-device-sources`,
            status: "fail",
            message: "Passive device discovery could not be initialized.",
          });
        }
      }
      return checks;
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
