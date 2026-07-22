import { parse as parseToml } from "@iarna/toml";
import { readFile } from "node:fs/promises";
import type { AdapterDiagnostic, JsonObject, LoadedAdapter } from "./types.js";
import { diagnostic } from "./diagnostics.js";
import {
  validateSchemaTemplates,
  validateTemplates,
} from "./template-validator.js";

const id = /^[a-z][a-z0-9-]*$/;
const duration = /^[1-9]\d*(ms|s|m|h)$/;
const platforms = ["windows", "linux", "macos"];
const standardOutputContracts: Readonly<Record<string, string>> = {
  "status-report": "status",
  "info-report": "info",
};
const sessionCapabilityContracts: Readonly<
  Record<
    string,
    {
      readonly handler: string;
      readonly createsRun: boolean;
      readonly lock: "none" | "session-owned";
      readonly ttyOnly?: boolean;
    }
  >
> = {
  run: { handler: "session:start", createsRun: true, lock: "session-owned" },
  logs: { handler: "session:logs", createsRun: false, lock: "none" },
  stop: { handler: "session:stop", createsRun: false, lock: "none" },
  console: {
    handler: "session:console",
    createsRun: false,
    lock: "none",
    ttyOnly: true,
  },
  send: { handler: "session:send", createsRun: false, lock: "none" },
  request: { handler: "session:request", createsRun: false, lock: "none" },
};
const obj = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const entries = (value: unknown) => Object.entries(obj(value));
const present = (source: JsonObject, key: unknown) =>
  typeof key === "string" && Object.hasOwn(source, key);
const ref = (
  errors: AdapterDiagnostic[],
  source: JsonObject,
  key: unknown,
  file: string,
  adapter: string,
  label: string,
) => {
  if (!present(source, key))
    errors.push(
      diagnostic(
        "ADAPTER_REFERENCE_NOT_FOUND",
        file,
        `${label} reference does not exist: ${String(key)}`,
        undefined,
        adapter,
      ),
    );
};
const condition = (
  value: unknown,
  file: string,
  adapter: string,
  errors: AdapterDiagnostic[],
) => {
  if (!value) return;
  const item = obj(value);
  const op = item.operator;
  if (
    typeof item.path !== "string" ||
    item.path.includes("${") ||
    !/^[a-z][a-z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/.test(item.path)
  )
    errors.push(
      diagnostic(
        "ADAPTER_TEMPLATE_INVALID",
        file,
        "Condition path is invalid",
        undefined,
        adapter,
      ),
    );
  const values = ["equals", "not-equals", "in", "not-in"];
  if (values.includes(String(op)) !== Object.hasOwn(item, "value"))
    errors.push(
      diagnostic(
        "ADAPTER_SCHEMA_INVALID",
        file,
        `Condition ${String(op)} has an invalid value field`,
        undefined,
        adapter,
      ),
    );
  if (
    ![...values, "exists", "not-exists", "truthy", "falsy"].includes(String(op))
  )
    errors.push(
      diagnostic(
        "ADAPTER_SCHEMA_INVALID",
        file,
        "Condition operator is invalid",
        undefined,
        adapter,
      ),
    );
};

const schemaAtSelector = (
  root: JsonObject,
  selector: string,
): JsonObject | undefined =>
  selector.split(".").reduce<JsonObject | undefined>((schema, segment) => {
    if (!schema) return undefined;
    const properties = obj(schema.properties);
    const direct = properties[segment];
    if (direct && typeof direct === "object" && !Array.isArray(direct))
      return direct as JsonObject;
    return undefined;
  }, root);

const schemaContainsSecret = (schema: JsonObject): boolean => {
  if (
    schema["x-benchpilot-secret"] === true ||
    obj(schema["x-benchpilot-cli"]).secret === true
  )
    return true;
  return Object.values(obj(schema.properties)).some(
    (value) =>
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      schemaContainsSecret(value as JsonObject),
  );
};

const hasMessage = (catalog: JsonObject, key: string) =>
  key
    .split(".")
    .reduce<unknown>(
      (value, segment) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as JsonObject)[segment]
          : undefined,
      catalog,
    ) !== undefined;

const messageKeys = (catalog: JsonObject, prefix = ""): string[] =>
  Object.entries(catalog).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") return [path];
    return value && typeof value === "object" && !Array.isArray(value)
      ? messageKeys(value as JsonObject, path)
      : [];
  });

export const validateSemantics = async (
  adapter: LoadedAdapter,
  catalogPath: string,
): Promise<AdapterDiagnostic[]> => {
  const errors: AdapterDiagnostic[] = [];
  const file = (name: string) => obj(adapter.files[name]);
  const manifest = file("manifest.toml"),
    capabilities = file("capabilities.toml"),
    tools = obj(file("tools.toml").tools),
    discoveries = obj(file("tool-discovery.toml").discoveries),
    environments = obj(file("environments.toml").environments),
    actions = obj(file("actions.toml").actions),
    workflows = obj(file("workflows.toml").workflows),
    sessions = obj(file("sessions.toml").sessions),
    parsers = obj(file("parsers.toml").parsers),
    sets = obj(file("artifacts.toml").sets),
    devices = file("devices.toml"),
    views = obj(file("views.toml").capabilities);
  const catalog = obj(parseToml(await readFile(catalogPath, "utf8")))
    .capabilities as JsonObject;
  if (manifest.id !== adapter.id)
    errors.push(
      diagnostic(
        "ADAPTER_REFERENCE_NOT_FOUND",
        "manifest.toml",
        "Manifest id must match directory name",
        "id",
        adapter.id,
      ),
    );
  if (
    manifest.capability_catalog_version !== 1 ||
    capabilities.catalog_version !== 1
  )
    errors.push(
      diagnostic(
        "ADAPTER_CAPABILITY_INVALID",
        "capabilities.toml",
        "Capability catalog version must be 1",
        undefined,
        adapter.id,
      ),
    );
  if (
    manifest.deprecated === true &&
    !manifest.replacement &&
    !manifest.deprecation_reason
  )
    errors.push(
      diagnostic(
        "ADAPTER_SCHEMA_INVALID",
        "manifest.toml",
        "Deprecated adapters require replacement or deprecation_reason",
        undefined,
        adapter.id,
      ),
    );
  if (Object.keys(adapter.i18n).length) {
    const english = adapter.i18n.en;
    if (!english)
      errors.push(
        diagnostic(
          "ADAPTER_I18N_EN_REQUIRED",
          "i18n",
          "Adapters with message catalogs require i18n/en.toml",
          undefined,
          adapter.id,
        ),
      );
    else {
      const expected = new Set(messageKeys(english));
      for (const [locale, catalog] of Object.entries(adapter.i18n)) {
        if (locale === "en") continue;
        const actual = new Set(messageKeys(catalog));
        for (const key of expected)
          if (!actual.has(key))
            errors.push(
              diagnostic(
                "ADAPTER_I18N_KEY_MISSING",
                `i18n/${locale}.toml`,
                `Message key is missing from ${locale}: ${key}`,
                key,
                adapter.id,
              ),
            );
        for (const key of actual)
          if (!expected.has(key))
            errors.push(
              diagnostic(
                "ADAPTER_I18N_KEY_UNKNOWN",
                `i18n/${locale}.toml`,
                `Message key is not declared by en: ${key}`,
                key,
                adapter.id,
              ),
            );
      }
    }
  }
  const declared = obj(capabilities.capabilities);
  const extensions = obj(capabilities.extensions);
  for (const key of Object.keys(extensions))
    if (Object.hasOwn(declared, key))
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          `Extension capability conflicts with standard capability: ${key}`,
          undefined,
          adapter.id,
        ),
      );
  for (const key of Object.keys(declared))
    if (!Object.hasOwn(catalog, key))
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          `Unknown standard capability: ${key}`,
          undefined,
          adapter.id,
        ),
      );
  for (const key of Object.keys(catalog)) {
    if (!Object.hasOwn(declared, key))
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_MISSING",
          "capabilities.toml",
          `Standard capability is missing: ${key}`,
          undefined,
          adapter.id,
        ),
      );
  }
  for (const [key, raw] of [...entries(declared), ...entries(extensions)]) {
    const item = obj(raw);
    if (!id.test(key))
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "capabilities.toml",
          `Invalid capability id: ${key}`,
          undefined,
          adapter.id,
        ),
      );
    const enabled = item.enabled;
    const support = obj(item.platforms);
    if (
      typeof enabled !== "boolean" ||
      platforms.some((platform) => typeof support[platform] !== "boolean")
    )
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          `Capability ${key} must declare enabled and all platforms`,
          undefined,
          adapter.id,
        ),
      );
    if (!enabled && typeof item.reason !== "string")
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          `Disabled capability ${key} requires reason`,
          undefined,
          adapter.id,
        ),
      );
    if (!enabled && platforms.some((platform) => support[platform] !== false))
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          `Disabled capability ${key} must disable every platform`,
          undefined,
          adapter.id,
        ),
      );
    if (enabled && !platforms.some((platform) => support[platform] === true))
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          `Enabled capability ${key} needs a supported platform`,
          undefined,
          adapter.id,
        ),
      );
    if (enabled && typeof item.handler !== "string")
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          `Enabled capability ${key} requires handler`,
          undefined,
          adapter.id,
        ),
      );
    if (typeof item.handler === "string") {
      const match = /^(action|workflow):([a-z][a-z0-9-]*)$/.exec(item.handler);
      const sessionMatch =
        /^session:(start|logs|stop|console|send|request)$/.exec(item.handler);
      if (!match) {
        if (!sessionMatch)
          errors.push(
            diagnostic(
              "ADAPTER_CAPABILITY_INVALID",
              "capabilities.toml",
              `Capability ${key} has an invalid handler`,
              undefined,
              adapter.id,
            ),
          );
        else if (typeof item.session !== "string")
          errors.push(
            diagnostic(
              "ADAPTER_CAPABILITY_INVALID",
              "capabilities.toml",
              `Session capability ${key} requires a session reference`,
              undefined,
              adapter.id,
            ),
          );
        else
          ref(
            errors,
            sessions,
            item.session,
            "capabilities.toml",
            adapter.id,
            "Session",
          );
      } else {
        const [, kind, target] = match;
        ref(
          errors,
          kind === "action" ? actions : workflows,
          target,
          "capabilities.toml",
          adapter.id,
          "Handler",
        );
      }
    }
    if (
      enabled &&
      platforms.some((platform) => support[platform] === false) &&
      platforms.some((platform) => support[platform] === true)
    )
      for (const platform of platforms)
        if (
          support[platform] === false &&
          typeof obj(item.platform_reasons)[platform] !== "string"
        )
          errors.push(
            diagnostic(
              "ADAPTER_CAPABILITY_INVALID",
              "capabilities.toml",
              `Capability ${key} needs a reason for unsupported ${platform}`,
              undefined,
              adapter.id,
            ),
          );
    if (
      item.lock &&
      !["none", "device", "session-owned"].includes(String(item.lock))
    )
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          `Capability ${key} has an invalid lock mode`,
          undefined,
          adapter.id,
        ),
      );
    if (
      (item.lock === "device" || item.lock === "session-owned") &&
      !Array.isArray(obj(file("devices.toml").identity).fields)
    )
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          `Device-locked capability ${key} requires device identity fields`,
          undefined,
          adapter.id,
        ),
      );
    const sessionContract = sessionCapabilityContracts[key];
    if (enabled && sessionContract) {
      if (item.handler !== sessionContract.handler)
        errors.push(
          diagnostic(
            "ADAPTER_CAPABILITY_INVALID",
            "capabilities.toml",
            `Capability ${key} must use ${sessionContract.handler}`,
            undefined,
            adapter.id,
          ),
        );
      if (item.creates_run !== sessionContract.createsRun)
        errors.push(
          diagnostic(
            "ADAPTER_CAPABILITY_INVALID",
            "capabilities.toml",
            `Capability ${key} has an invalid creates_run value`,
            undefined,
            adapter.id,
          ),
        );
      if (item.lock !== sessionContract.lock)
        errors.push(
          diagnostic(
            "ADAPTER_CAPABILITY_INVALID",
            "capabilities.toml",
            `Capability ${key} must use lock = ${sessionContract.lock}`,
            undefined,
            adapter.id,
          ),
        );
      if (sessionContract.ttyOnly === true && item.tty_only !== true)
        errors.push(
          diagnostic(
            "ADAPTER_CAPABILITY_INVALID",
            "capabilities.toml",
            "Console capability must declare tty_only = true",
            undefined,
            adapter.id,
          ),
        );
      if (key === "request") {
        const session = obj(sessions[String(item.session)]);
        if (!Object.keys(obj(session.protocols)).length)
          errors.push(
            diagnostic(
              "ADAPTER_CAPABILITY_INVALID",
              "capabilities.toml",
              "Request capability requires a session protocol profile",
              undefined,
              adapter.id,
            ),
          );
      }
    }
    for (const schema of ["input_schema", "output_schema"] as const) {
      if (enabled && typeof item[schema] !== "string")
        errors.push(
          diagnostic(
            "ADAPTER_CAPABILITY_INVALID",
            "capabilities.toml",
            `Enabled capability ${key} requires ${schema}`,
            undefined,
            adapter.id,
          ),
        );
      else if (
        typeof item[schema] === "string" &&
        !Object.hasOwn(
          obj(
            adapter.schemas[schema === "input_schema" ? "inputs" : "outputs"]
              .$defs,
          ),
          item[schema],
        )
      )
        errors.push(
          diagnostic(
            "ADAPTER_REFERENCE_NOT_FOUND",
            "capabilities.toml",
            `${schema} does not exist: ${String(item[schema])}`,
            undefined,
            adapter.id,
          ),
        );
    }
    const expectedOutputSchema =
      standardOutputContracts[String(obj(catalog[key]).output_contract ?? "")];
    if (
      enabled &&
      expectedOutputSchema &&
      item.output_schema !== expectedOutputSchema
    )
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          `Capability ${key} must use the ${String(obj(catalog[key]).output_contract)} output schema: ${expectedOutputSchema}`,
          undefined,
          adapter.id,
        ),
      );
    const safety = obj(item.safety);
    if (
      safety.mode &&
      !["normal", "caution", "destructive", "irreversible"].includes(
        String(safety.mode),
      )
    )
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          "Safety mode is invalid",
          undefined,
          adapter.id,
        ),
      );
    if (
      ["caution", "destructive", "irreversible"].includes(
        String(safety.mode),
      ) &&
      typeof safety.description !== "string"
    )
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          "Dangerous capability requires a description",
          undefined,
          adapter.id,
        ),
      );
    if (safety.mode === "normal" && safety.description !== undefined)
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          "Normal safety may not declare a danger description",
          undefined,
          adapter.id,
        ),
      );
  }
  const inputDefinitions = obj(adapter.schemas.inputs.$defs);
  const outputDefinitions = obj(adapter.schemas.outputs.$defs);
  for (const [sessionId, raw] of entries(sessions)) {
    const session = obj(raw);
    for (const [profileId, profileRaw] of entries(session.protocols)) {
      const profile = obj(profileRaw);
      if (typeof profile.telemetry_schema === "string")
        ref(
          errors,
          outputDefinitions,
          profile.telemetry_schema,
          "sessions.toml",
          adapter.id,
          `Telemetry schema for ${sessionId}/${profileId}`,
        );
      for (const [methodId, methodRaw] of entries(profile.methods)) {
        const method = obj(methodRaw);
        ref(
          errors,
          inputDefinitions,
          method.request_schema,
          "sessions.toml",
          adapter.id,
          `Request schema for ${sessionId}/${profileId}/${methodId}`,
        );
        ref(
          errors,
          outputDefinitions,
          method.response_schema,
          "sessions.toml",
          adapter.id,
          `Response schema for ${sessionId}/${profileId}/${methodId}`,
        );
      }
    }
  }
  if (manifest.status === "disabled")
    for (const [key, item] of [...entries(declared), ...entries(extensions)])
      if (obj(item).enabled !== false)
        errors.push(
          diagnostic(
            "ADAPTER_CAPABILITY_INVALID",
            "capabilities.toml",
            `Disabled adapter cannot enable ${key}`,
            undefined,
            adapter.id,
          ),
        );
  const presentationMessageKeys = new Set<string>();
  for (const [capabilityId, rawView] of entries(views)) {
    const capability = obj(declared[capabilityId] ?? extensions[capabilityId]);
    if (!Object.keys(capability).length || capability.enabled !== true) {
      errors.push(
        diagnostic(
          "ADAPTER_VIEW_INVALID",
          "views.toml",
          `View references a missing or disabled capability: ${capabilityId}`,
          `capabilities.${capabilityId}`,
          adapter.id,
        ),
      );
      continue;
    }
    const outputSchema = obj(
      outputDefinitions[String(capability.output_schema)],
    );
    const view = obj(rawView);
    const title = obj(view.title);
    if (typeof title.key === "string") presentationMessageKeys.add(title.key);
    const empty = obj(view.empty);
    if (typeof empty.key === "string") presentationMessageKeys.add(empty.key);
    if (view.kind === "completion") {
      const message = obj(view.message);
      if (typeof message.key === "string")
        presentationMessageKeys.add(message.key);
      continue;
    }
    if (view.kind === "tree" || view.kind === "table") {
      if (schemaContainsSecret(outputSchema))
        errors.push(
          diagnostic(
            "ADAPTER_VIEW_SECRET_SELECTOR",
            "views.toml",
            `Tree or table view for ${capabilityId} may expose a secret output field`,
            `capabilities.${capabilityId}`,
            adapter.id,
          ),
        );
      if (view.kind === "table")
        for (const rawMessage of Object.values(obj(view.keys))) {
          const message = obj(rawMessage);
          if (typeof message.key === "string")
            presentationMessageKeys.add(message.key);
        }
      continue;
    }
    const fields = Array.isArray(view.columns)
      ? view.columns
      : Array.isArray(view.fields)
        ? view.fields
        : [];
    const selectorRoot =
      view.kind === "records"
        ? obj(schemaAtSelector(outputSchema, String(view.source ?? ""))?.items)
        : outputSchema;
    if (view.kind === "records" && !Object.keys(selectorRoot).length)
      errors.push(
        diagnostic(
          "ADAPTER_VIEW_SELECTOR_INVALID",
          "views.toml",
          `Record source does not resolve to an array schema in ${String(capability.output_schema)}: ${String(view.source)}`,
          `capabilities.${capabilityId}.source`,
          adapter.id,
        ),
      );
    for (const [index, rawField] of fields.entries()) {
      const field = obj(rawField);
      const label = obj(field.label);
      if (typeof label.key === "string") presentationMessageKeys.add(label.key);
      const selector = String(field.selector ?? "");
      const selected = schemaAtSelector(selectorRoot, selector);
      if (!selected)
        errors.push(
          diagnostic(
            "ADAPTER_VIEW_SELECTOR_INVALID",
            "views.toml",
            `View selector does not exist in ${String(capability.output_schema)}: ${selector}`,
            `capabilities.${capabilityId}.${view.kind === "records" ? "columns" : "fields"}.${index}.selector`,
            adapter.id,
          ),
        );
      else if (schemaContainsSecret(selected))
        errors.push(
          diagnostic(
            "ADAPTER_VIEW_SECRET_SELECTOR",
            "views.toml",
            `View selector may not expose a secret: ${selector}`,
            `capabilities.${capabilityId}.${view.kind === "records" ? "columns" : "fields"}.${index}.selector`,
            adapter.id,
          ),
        );
    }
  }
  for (const [key, raw] of entries(discoveries)) {
    const discovery = obj(raw),
      candidateIds = new Set<string>();
    if (discovery.strategy !== "first-valid")
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "tool-discovery.toml",
          `Discovery ${key} must use first-valid`,
          undefined,
          adapter.id,
        ),
      );
    for (const candidate of Array.isArray(discovery.candidates)
      ? discovery.candidates
      : []) {
      const item = obj(candidate);
      if (typeof item.id !== "string" || candidateIds.has(item.id))
        errors.push(
          diagnostic(
            "ADAPTER_SCHEMA_INVALID",
            "tool-discovery.toml",
            `Discovery ${key} has duplicate or invalid candidate id`,
            undefined,
            adapter.id,
          ),
        );
      candidateIds.add(String(item.id));
      if (
        ![
          "config",
          "config-path",
          "environment",
          "environment-path",
          "path",
          "fixed",
          "glob",
          "json-path",
        ].includes(String(item.type))
      )
        errors.push(
          diagnostic(
            "ADAPTER_SCHEMA_INVALID",
            "tool-discovery.toml",
            `Discovery ${key} has invalid candidate type`,
            undefined,
            adapter.id,
          ),
        );
    }
    const probe = obj(discovery.probe);
    if (Object.keys(probe).length)
      ref(
        errors,
        parsers,
        probe.parser,
        "tool-discovery.toml",
        adapter.id,
        `Discovery ${key} probe parser`,
      );
  }
  const deviceDiscovery = obj(devices.discovery);
  const sourceIds = new Set<string>();
  for (const raw of Array.isArray(deviceDiscovery.sources)
    ? deviceDiscovery.sources
    : []) {
    const source = obj(raw);
    if (
      typeof source.id !== "string" ||
      !id.test(source.id) ||
      sourceIds.has(source.id)
    )
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "devices.toml",
          `Device discovery has duplicate or invalid source id: ${String(source.id)}`,
          undefined,
          adapter.id,
        ),
      );
    sourceIds.add(String(source.id));
    if (source.type === "command") {
      ref(
        errors,
        actions,
        source.action,
        "devices.toml",
        adapter.id,
        `Command device source ${String(source.id)} action`,
      );
      const action = obj(actions[String(source.action)]);
      if (Object.keys(action).length && action.type !== "process")
        errors.push(
          diagnostic(
            "ADAPTER_SCHEMA_INVALID",
            "devices.toml",
            `Command device source ${String(source.id)} must use a process Action`,
            undefined,
            adapter.id,
          ),
        );
      ref(
        errors,
        parsers,
        action.parser,
        "devices.toml",
        adapter.id,
        `Command device source ${String(source.id)} parser`,
      );
    }
  }
  const sources = Object.fromEntries(
    [...sourceIds].map((source) => [source, true]),
  );
  const matcherIds = new Set<string>();
  for (const raw of Array.isArray(deviceDiscovery.matchers)
    ? deviceDiscovery.matchers
    : []) {
    const matcher = obj(raw);
    if (
      typeof matcher.id !== "string" ||
      !id.test(matcher.id) ||
      matcherIds.has(matcher.id)
    )
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "devices.toml",
          `Device discovery has duplicate or invalid matcher id: ${String(matcher.id)}`,
          undefined,
          adapter.id,
        ),
      );
    matcherIds.add(String(matcher.id));
    ref(
      errors,
      sources,
      matcher.source,
      "devices.toml",
      adapter.id,
      `Matcher ${String(matcher.id)} source`,
    );
  }
  const deviceProbe = obj(devices.probe);
  if (deviceProbe.enabled === true) {
    ref(
      errors,
      actions,
      deviceProbe.action,
      "devices.toml",
      adapter.id,
      "Device probe action",
    );
    ref(
      errors,
      parsers,
      deviceProbe.parser,
      "devices.toml",
      adapter.id,
      "Device probe parser",
    );
  }
  for (const [key, raw] of entries(environments)) {
    const environment = obj(raw);
    if (!["inherit", "first-valid"].includes(String(environment.strategy)))
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "environments.toml",
          `Environment ${key} has invalid strategy`,
          undefined,
          adapter.id,
        ),
      );
    for (const provider of Array.isArray(environment.providers)
      ? environment.providers
      : []) {
      const item = obj(provider);
      if (!["active", "static", "capture-script"].includes(String(item.type)))
        errors.push(
          diagnostic(
            "ADAPTER_SCHEMA_INVALID",
            "environments.toml",
            `Environment ${key} has invalid provider type`,
            undefined,
            adapter.id,
          ),
        );
      if (
        item.type === "capture-script" &&
        (typeof item.script !== "string" || !item.script.trim())
      )
        errors.push(
          diagnostic(
            "ADAPTER_SCHEMA_INVALID",
            "environments.toml",
            `Capture script for ${key} must be a non-empty path template`,
            undefined,
            adapter.id,
          ),
        );
    }
  }
  for (const [key, raw] of entries(tools)) {
    const tool = obj(raw),
      launch = obj(tool.launch);
    ref(
      errors,
      discoveries,
      tool.discovery,
      "tools.toml",
      adapter.id,
      "Discovery",
    );
    ref(
      errors,
      environments,
      launch.environment,
      "tools.toml",
      adapter.id,
      "Environment",
    );
    if (launch.mode === "direct" && typeof launch.command !== "string")
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "tools.toml",
          `Direct tool ${key} needs command`,
          undefined,
          adapter.id,
        ),
      );
    if (launch.mode === "via-tool")
      ref(errors, tools, launch.tool, "tools.toml", adapter.id, "Tool");
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) {
      errors.push(
        diagnostic(
          "ADAPTER_TOOL_CYCLE",
          "tools.toml",
          `Tool dependency cycle includes ${key}`,
          undefined,
          adapter.id,
        ),
      );
      return;
    }
    if (visited.has(key)) return;
    visiting.add(key);
    const target = obj(obj(tools[key]).launch).tool;
    if (typeof target === "string") visit(target);
    visiting.delete(key);
    visited.add(key);
  };
  Object.keys(tools).forEach(visit);
  for (const [key, raw] of entries(actions)) {
    const action = obj(raw);
    if (
      !["process", "serial-read", "serial-write", "copy"].includes(
        String(action.type),
      )
    )
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "actions.toml",
          `Action ${key} has an invalid type`,
          undefined,
          adapter.id,
        ),
      );
    if (action.type !== "process" && action.tool !== undefined)
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "actions.toml",
          `Non-process action ${key} may not reference a tool`,
          undefined,
          adapter.id,
        ),
      );
    if (
      action.type === "process" &&
      ["shell", "command", "command_line", "script"].some((field) =>
        Object.hasOwn(action, field),
      )
    )
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "actions.toml",
          `Process action ${key} contains a prohibited command field`,
          undefined,
          adapter.id,
        ),
      );
    if (action.type === "process")
      ref(errors, tools, action.tool, "actions.toml", adapter.id, "Tool");
    if (action.parser)
      ref(errors, parsers, action.parser, "actions.toml", adapter.id, "Parser");
    if (action.artifact_set)
      ref(
        errors,
        sets,
        action.artifact_set,
        "actions.toml",
        adapter.id,
        "Artifact set",
      );
    if (action.timeout && !duration.test(String(action.timeout)))
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "actions.toml",
          `Invalid action timeout: ${key}`,
          undefined,
          adapter.id,
        ),
      );
    for (const arg of Array.isArray(action.arguments) ? action.arguments : [])
      condition(obj(arg).when, "actions.toml", adapter.id, errors);
  }
  for (const [key, raw] of entries(workflows)) {
    const workflow = obj(raw);
    if (!duration.test(String(workflow.timeout ?? "")))
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "workflows.toml",
          `Workflow ${key} requires a positive timeout`,
          undefined,
          adapter.id,
        ),
      );
    const seen = new Set<string>();
    for (const rawStep of Array.isArray(workflow.steps) ? workflow.steps : []) {
      const step = obj(rawStep);
      if (typeof step.id !== "string" || seen.has(step.id))
        errors.push(
          diagnostic(
            "ADAPTER_SCHEMA_INVALID",
            "workflows.toml",
            `Workflow ${key} has duplicate or invalid step id`,
            undefined,
            adapter.id,
          ),
        );
      seen.add(String(step.id));
      const label = obj(step.label);
      if (typeof label.key === "string") presentationMessageKeys.add(label.key);
      const [kind, target] = String(step.uses ?? "").split(":");
      if (kind !== "action")
        errors.push(
          diagnostic(
            "ADAPTER_SCHEMA_INVALID",
            "workflows.toml",
            "Workflows may only use actions",
            undefined,
            adapter.id,
          ),
        );
      else ref(errors, actions, target, "workflows.toml", adapter.id, "Action");
      condition(step.when, "workflows.toml", adapter.id, errors);
    }
    if (typeof workflow.output === "string" && !seen.has(workflow.output))
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "workflows.toml",
          `Workflow ${key} output must reference a declared step`,
          undefined,
          adapter.id,
        ),
      );
  }
  for (const [key, raw] of entries(parsers)) {
    const parser = obj(raw);
    if (
      !Array.isArray(parser.success_exit_codes) ||
      !parser.success_exit_codes.length
    )
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "parsers.toml",
          `Parser ${key} requires success_exit_codes`,
          undefined,
          adapter.id,
        ),
      );
    const ids = new Set<string>();
    for (const rule of [
      ...(Array.isArray(parser.extract) ? parser.extract : []),
      ...(Array.isArray(parser.progress) ? parser.progress : []),
      ...(Array.isArray(parser.errors) ? parser.errors : []),
    ]) {
      const item = obj(rule);
      const label = obj(item.label);
      if (typeof label.key === "string") presentationMessageKeys.add(label.key);
      const message = obj(item.message);
      if (typeof message.key === "string")
        presentationMessageKeys.add(message.key);
      if (typeof item.id !== "string" || ids.has(item.id))
        errors.push(
          diagnostic(
            "ADAPTER_SCHEMA_INVALID",
            "parsers.toml",
            `Parser ${key} has duplicate or invalid rule id`,
            undefined,
            adapter.id,
          ),
        );
      ids.add(String(item.id));
      if (typeof item.pattern !== "string" || !item.pattern) {
        if (item.type !== "json-pointer")
          errors.push(
            diagnostic(
              "ADAPTER_REGEX_INVALID",
              "parsers.toml",
              `Parser ${key} has a missing regex`,
              undefined,
              adapter.id,
            ),
          );
        continue;
      }
      try {
        new RegExp(item.pattern);
        if (
          item.type === "regex" &&
          typeof item.group === "string" &&
          !/^\d+$/.test(item.group) &&
          !Array.from(
            String(item.pattern).matchAll(/\(\?<([A-Za-z][A-Za-z0-9_]*)>/g),
            (match) => match[1],
          ).includes(item.group)
        )
          errors.push(
            diagnostic(
              "ADAPTER_REGEX_INVALID",
              "parsers.toml",
              `Parser ${key} extract group does not exist: ${item.group}`,
              undefined,
              adapter.id,
            ),
          );
      } catch {
        errors.push(
          diagnostic(
            "ADAPTER_REGEX_INVALID",
            "parsers.toml",
            `Parser ${key} has an invalid regex`,
            undefined,
            adapter.id,
          ),
        );
      }
    }
  }
  for (const [key, raw] of entries(sets)) {
    const set = obj(raw),
      artifactEntries = Array.isArray(set.entries) ? set.entries : [];
    for (const entry of artifactEntries) {
      const item = obj(entry);
      if (Boolean(item.path) === Boolean(item.glob))
        errors.push(
          diagnostic(
            "ADAPTER_SCHEMA_INVALID",
            "artifacts.toml",
            `Artifact set ${key} entries need exactly one of path or glob`,
            undefined,
            adapter.id,
          ),
        );
    }
  }
  for (const [name, value] of Object.entries(adapter.files))
    errors.push(...validateTemplates(value, name, adapter.id));
  for (const [name, value] of Object.entries(adapter.files))
    errors.push(
      ...validateSchemaTemplates(value, name, adapter.id, adapter.schemas),
    );
  for (const messageKey of presentationMessageKeys)
    for (const [locale, catalog] of Object.entries(adapter.i18n))
      if (!hasMessage(catalog, messageKey))
        errors.push(
          diagnostic(
            "ADAPTER_VIEW_MESSAGE_MISSING",
            "presentation",
            `Presentation message ${messageKey} is missing from ${locale}`,
            undefined,
            adapter.id,
          ),
        );
  if (presentationMessageKeys.size && !adapter.i18n.en)
    errors.push(
      diagnostic(
        "ADAPTER_VIEW_MESSAGE_MISSING",
        "presentation",
        "Adapter presentation declarations require an en message catalog",
        undefined,
        adapter.id,
      ),
    );
  return errors;
};
