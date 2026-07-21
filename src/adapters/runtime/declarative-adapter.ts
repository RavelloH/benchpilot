import path from "node:path";
import {
  BenchPilotError,
  duration,
  objectSchema,
  type Adapter,
  type AdapterConfigurationDiscovery,
  type AdapterContext,
  type AdapterServices,
  type Capability,
  type DeviceRuntime,
  type Json,
  type ManagedSessionCapabilityKind,
  type ManagedSessionPlan,
  type OperationContext,
  type RuntimeSchema,
  type Safety,
  setKey,
} from "../../core.js";
import { DeclarativeCapabilityRunner } from "./capability-runner.js";
import { discoverDevicesDetailed } from "./devices/discovery.js";
import { executeDeviceCommandSource } from "./devices/command-source.js";
import { normalizePortIdentity } from "./devices/identity.js";
import {
  EnvironmentResolver,
  environmentFor,
} from "./environments/resolver.js";
import { AdapterRuntimeError } from "./errors.js";
import {
  lookup,
  object,
  renderRequiredTemplate,
  type RuleObject,
} from "./rules/template.js";
import type { RuntimeAdapter } from "./types.js";
import { ToolResolver } from "./tools/resolver.js";
import { inspectSchemaProperties } from "./validation/schema-inspector.js";
import {
  AdapterDataValidator,
  redactWithSchema,
  redactSecrets,
} from "./validation/data-validator.js";
import type { AdapterCapabilityViews } from "../contract/views.js";
import { installationFor } from "./installation.js";

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

const writeToolResolution = (
  context: RuleObject,
  launch: Awaited<ReturnType<ToolResolver["resolveLaunch"]>>,
) => {
  const tools = object(context.tool);
  const discoveries = object(context.discovery);
  for (const current of launch.chain) {
    tools[current.toolId] = {
      executable: current.executable,
      argsPrefix: current.argsPrefix,
      environmentId: current.environmentId,
      discoveryId: current.discoveryId,
      discoveredPath: current.discoveredPath,
      discoveredRoot: current.discoveredRoot,
    };
    discoveries[current.discoveryId] = {
      path: current.discoveredPath,
      root: current.discoveredRoot,
      candidateId: current.candidateId,
    };
  }
  context.tool = tools;
  context.discovery = discoveries;
};

const persistentValue = (input: {
  discovery: RuleObject;
  path: string;
  root?: string;
}) => {
  const persistence = object(input.discovery.persistence);
  const key = persistence.key;
  if (typeof key !== "string" || !key) return undefined;
  let value = persistence.source === "root" ? input.root : input.path;
  if (typeof value !== "string" || !value) return undefined;
  const suffix = Array.isArray(persistence.strip_suffix)
    ? persistence.strip_suffix.map(String)
    : [];
  if (suffix.length) {
    const actual = value.split(/[\\/]+/).filter(Boolean);
    if (
      suffix.length > actual.length ||
      suffix.some(
        (segment, index) =>
          actual[actual.length - suffix.length + index] !== segment,
      )
    )
      return undefined;
    value = path.resolve(value, ...suffix.map(() => ".."));
  }
  return { key, value };
};

const discoverConfiguration = async (
  runtime: RuntimeAdapter,
  validator: AdapterDataValidator,
  context: AdapterContext,
): Promise<AdapterConfigurationDiscovery> => {
  const rules = runtime.rules;
  const resolver = new ToolResolver(runtime.platform, process.env);
  const environments = new EnvironmentResolver(process.env, undefined, false);
  const runtimeContext = doctorContext(
    runtime,
    context.adapterConfig,
    context.paths,
  );
  const config: Json = {};
  const tools: AdapterConfigurationDiscovery["tools"] = [];
  for (const [id, raw] of Object.entries(object(rules.tools))) {
    const tool = object(raw);
    const required = tool.required === true;
    try {
      const launch = await resolver.resolveLaunch(
        id,
        object(rules.tools),
        object(rules.discoveries),
        runtimeContext,
      );
      writeToolResolution(runtimeContext, launch);
      const environment = await environments.resolveDetailed(
        launch.environmentId,
        object(rules.environments),
        runtimeContext,
        new AbortController().signal,
      );
      await resolver.probeChain(
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
      for (const current of launch.chain) {
        const value = persistentValue({
          discovery: object(object(rules.discoveries)[current.discoveryId]),
          path: current.discoveredPath,
          root: current.discoveredRoot,
        });
        if (!value) continue;
        setKey(config, value.key, value.value);
      }
      tools.push({
        id,
        required,
        status: "resolved",
        path: launch.discoveredPath,
        candidateId: launch.candidateId,
      });
    } catch (error) {
      tools.push({
        id,
        required,
        status: "unavailable",
        message: (error as Error).message,
      });
    }
  }
  const ready = tools.every(
    (tool) => !tool.required || tool.status === "resolved",
  );
  if (ready)
    validator.validate("config", { ...context.adapterConfig, ...config });
  return { adapter: runtime.bundle.id, ready, config, tools };
};

const configurationFields = (runtime: RuntimeAdapter) => {
  const fields = new Map<string, { key: string; required: boolean }>();
  for (const rawTool of Object.values(object(runtime.rules.tools))) {
    const tool = object(rawTool);
    if (tool.required !== true) continue;
    const discoveryId = tool.discovery;
    const discovery = object(
      typeof discoveryId === "string"
        ? object(runtime.rules.discoveries)[discoveryId]
        : undefined,
    );
    const persistenceKey = object(discovery.persistence).key;
    const fallbackKey = (
      Array.isArray(discovery.candidates)
        ? discovery.candidates.map(object)
        : []
    ).find(
      (candidate) =>
        (candidate.type === "config" || candidate.type === "config-path") &&
        typeof candidate.key === "string",
    )?.key;
    const key =
      typeof persistenceKey === "string"
        ? persistenceKey
        : typeof fallbackKey === "string"
          ? fallbackKey
          : undefined;
    if (key) fields.set(key, { key, required: true });
  }
  return [...fields.values()];
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
  const outputRoot = adapter.bundle.schemas.outputs;
  const outputSchema =
    object(object(outputRoot).$defs)[outputDefinition] ?? outputRoot;
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
    ttyOnly: value.tty_only === true,
    safety: {
      mode:
        safety.mode === "caution" ||
        safety.mode === "destructive" ||
        safety.mode === "irreversible"
          ? safety.mode
          : "normal",
      ...(typeof safety.flag === "string" ? { flag: safety.flag } : {}),
      ...(typeof safety.description === "string"
        ? { effects: [safety.description] }
        : {}),
      ...(safety.mode === "irreversible" ? { approvalTtlMs: 3_600_000 } : {}),
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
    redactOutput(output) {
      return redactWithSchema({
        rootSchema: outputRoot,
        schema: outputSchema,
        value: output,
      }) as Json;
    },
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
            { adapterId: adapter.bundle.id, ...error.details },
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

  resolveManagedSession(
    capabilityId: string,
    context: { projectRoot: string },
  ): ManagedSessionPlan | undefined {
    const capability = object(
      object(this.adapter.rules.capabilities)[capabilityId],
    );
    const match = /^session:(start|logs|stop|console|send|request)$/.exec(
      String(capability.handler ?? ""),
    );
    if (capability.enabled !== true || !match) return undefined;
    const sessionId = String(capability.session ?? "");
    const session = object(object(this.adapter.rules.sessions)[sessionId]);
    if (!sessionId || !Object.keys(session).length)
      throw new AdapterRuntimeError(
        "ADAPTER_BUNDLE_INVALID",
        `Session declaration is unavailable for capability ${capabilityId}.`,
      );
    const renderContext: RuleObject = {
      adapter: { id: this.adapter.bundle.id },
      platform: this.adapter.platform,
      config: this.adapterConfig,
      device: this.device,
      project: { root: context.projectRoot },
      home: process.env.HOME ?? process.env.USERPROFILE ?? "",
      env: process.env,
    };
    const number = (value: unknown, field: string) => {
      const parsed = Number(
        renderRequiredTemplate(value, renderContext, field),
      );
      if (!Number.isSafeInteger(parsed) || parsed <= 0)
        throw new AdapterRuntimeError(
          "ADAPTER_CONFIG_INVALID",
          `Session ${sessionId} has an invalid ${field} value.`,
        );
      return parsed;
    };
    const openLinePolicy = object(session.open_line_policy);
    const validator = new AdapterDataValidator(this.adapter.bundle);
    const schema = (kind: "input" | "output", definition: string) =>
      validatorSchema(validator, kind, capabilityId, definition);
    const protocols = Object.entries(object(session.protocols)).map(
      ([id, raw]) => {
        const profile = object(raw);
        return {
          id,
          framing: String(profile.framing) as
            "json-lines" | "length-prefixed" | "cbor",
          maxRequestBytes: number(
            profile.max_request_bytes,
            "max_request_bytes",
          ),
          ...(typeof profile.telemetry_schema === "string"
            ? { telemetrySchema: schema("output", profile.telemetry_schema) }
            : {}),
          methods: Object.entries(object(profile.methods)).map(
            ([methodId, methodRaw]) => {
              const method = object(methodRaw);
              return {
                id: methodId,
                requestSchema: schema("input", String(method.request_schema)),
                responseSchema: schema(
                  "output",
                  String(method.response_schema),
                ),
                timeoutMs: duration(String(method.timeout)),
                safety: String(method.safety) as Safety["mode"],
              };
            },
          ),
        };
      },
    );
    return {
      capabilityId,
      kind: match[1] as ManagedSessionCapabilityKind,
      sessionId,
      port: String(renderRequiredTemplate(session.port, renderContext, "port")),
      baud: number(session.baud, "baud"),
      encoding: String(session.encoding) as "utf8" | "binary",
      lineFraming: String(session.line_framing) as "line" | "raw",
      openLinePolicy: {
        dtr: String(openLinePolicy.dtr) as "preserve" | "off" | "on",
        rts: String(openLinePolicy.rts) as "preserve" | "off" | "on",
      },
      logRecordLimit: number(session.log_record_limit, "log_record_limit"),
      spoolLimitBytes: number(session.spool_limit_bytes, "spool_limit_bytes"),
      rawCaptureLimitBytes: number(
        session.raw_capture_limit_bytes,
        "raw_capture_limit_bytes",
      ),
      writeLimitBytes: number(session.write_limit_bytes, "write_limit_bytes"),
      protocols,
    };
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

/** Turns a validated compiled bundle into the Core Adapter contract. */
export const createDeclarativeAdapter = (
  runtime: RuntimeAdapter,
): Adapter & { readonly capabilityViews: AdapterCapabilityViews } => {
  const validator = new AdapterDataValidator(runtime.bundle);
  return {
    id: runtime.bundle.id,
    apiVersion: 1,
    version: String(runtime.bundle.manifest.adapter_version),
    summary: String(runtime.bundle.manifest.display_name),
    description: String(runtime.bundle.manifest.description),
    capabilityViews: runtime.bundle.views,
    translate(locale, key, variables = {}) {
      const lookup = (value: unknown) =>
        key
          .split(".")
          .reduce<unknown>(
            (current, segment) =>
              current && typeof current === "object" && !Array.isArray(current)
                ? (current as Record<string, unknown>)[segment]
                : undefined,
            value,
          );
      const message =
        lookup(runtime.bundle.i18n[locale]) ?? lookup(runtime.bundle.i18n.en);
      if (typeof message !== "string") return undefined;
      return message.replace(
        /\{([A-Za-z0-9_]+)\}/g,
        (_, name) => variables[name] ?? `{${name}}`,
      );
    },
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
      return {
        devices: detailed.devices as unknown as Json[],
        diagnostics: detailed.sources as unknown as Json[],
      };
    },
    async discoverConfiguration(context: AdapterContext) {
      return discoverConfiguration(runtime, validator, context);
    },
    configurationFields() {
      return configurationFields(runtime);
    },
    installation() {
      return installationFor(runtime.bundle.installation as Json);
    },
    configurationNotFound(discovery) {
      const tool = object(
        runtime.bundle.installation,
      ).configuration_not_found_tool;
      return (
        typeof tool === "string" &&
        discovery.tools.some(
          (candidate) =>
            candidate.id === tool && candidate.status === "unavailable",
        )
      );
    },
    async doctor(context: AdapterContext) {
      const checks: Json[] = [
        {
          id: `${runtime.bundle.id}-bundle`,
          status: "pass",
          message: `Adapter bundle ready for ${runtime.platform}.`,
          messageKey: "doctor.bundleReady",
        },
      ];
      const rules = runtime.rules;
      const resolver = new ToolResolver(
        runtime.platform,
        process.env,
        "configured",
      );
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
          const launch = await resolver.resolveLaunch(
            String(id),
            object(rules.tools),
            object(rules.discoveries),
            runtimeContext,
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
              discoveredRoot: current.discoveredRoot,
            };
            discoveryContext[current.discoveryId] = {
              path: current.discoveredPath,
              root: current.discoveredRoot,
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
            messageKey: required
              ? "doctor.requiredToolResolved"
              : "doctor.optionalToolResolved",
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
            messageKey: required
              ? "doctor.requiredToolFailed"
              : "doctor.optionalToolUnavailable",
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
            messageKey: "doctor.environmentResolved",
          });
        } catch {
          checks.push({
            id: `${runtime.bundle.id}-environment-${id}`,
            status: "fail",
            message: "Environment could not be resolved.",
            messageKey: "doctor.environmentFailed",
          });
        }
      }
      const discovery = object(object(rules.devices).discovery);
      if (discovery.enabled !== true)
        checks.push({
          id: `${runtime.bundle.id}-device-sources`,
          status: "warn",
          message: "Device discovery is disabled.",
          messageKey: "doctor.discoveryDisabled",
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
            messageKey: discoveryResult.sources.some(
              (source) => source.status === "fail",
            )
              ? "doctor.discoverySourceFailed"
              : "doctor.discoveryAvailable",
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
            messageKey: "doctor.discoveryUnavailable",
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
