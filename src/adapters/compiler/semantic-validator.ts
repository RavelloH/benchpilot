import { parse as parseToml } from "@iarna/toml";
import { readFile } from "node:fs/promises";
import type { AdapterDiagnostic, JsonObject, LoadedAdapter } from "./types.js";
import { diagnostic } from "./diagnostics.js";
import { validateTemplates } from "./template-validator.js";

const id = /^[a-z][a-z0-9-]*$/;
const duration = /^\d+(ms|s|m|h)$/;
const platforms = ["windows", "linux", "macos"];
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
    parsers = obj(file("parsers.toml").parsers),
    sets = obj(file("artifacts.toml").sets);
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
  const declared = obj(capabilities.capabilities);
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
  for (const [key, raw] of [
    ...entries(declared),
    ...entries(capabilities.extensions),
  ]) {
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
      const [kind, target] = item.handler.split(":");
      ref(
        errors,
        kind === "action" ? actions : workflows,
        target,
        "capabilities.toml",
        adapter.id,
        "Handler",
      );
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
    if (item.lock && !["none", "device"].includes(String(item.lock)))
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
      item.lock === "device" &&
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
    for (const schema of ["input_schema", "output_schema"] as const)
      if (
        item[schema] &&
        !Object.hasOwn(
          obj(
            adapter.schemas[schema === "input_schema" ? "inputs" : "outputs"]
              .$defs,
          ),
          item[schema] as string,
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
    const safety = obj(item.safety);
    if (
      safety.mode &&
      !["normal", "danger-flag", "human-approval"].includes(String(safety.mode))
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
      ["danger-flag", "human-approval"].includes(String(safety.mode)) &&
      typeof safety.flag !== "string"
    )
      errors.push(
        diagnostic(
          "ADAPTER_CAPABILITY_INVALID",
          "capabilities.toml",
          "Dangerous capability requires a flag",
          undefined,
          adapter.id,
        ),
      );
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
        (typeof item.script !== "string" || !/^\$\{[^}]+\}$/.test(item.script))
      )
        errors.push(
          diagnostic(
            "ADAPTER_SCHEMA_INVALID",
            "environments.toml",
            `Capture script for ${key} must be a single path template`,
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
    if (visiting.has(key))
      errors.push(
        diagnostic(
          "ADAPTER_TOOL_CYCLE",
          "tools.toml",
          `Tool dependency cycle includes ${key}`,
          undefined,
          adapter.id,
        ),
      );
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
            "ADAPTER_WORKFLOW_CYCLE",
            "workflows.toml",
            `Workflow ${key} has duplicate or invalid step id`,
            undefined,
            adapter.id,
          ),
        );
      seen.add(String(step.id));
      const [kind, target] = String(step.uses ?? "").split(":");
      if (kind !== "action")
        errors.push(
          diagnostic(
            "ADAPTER_WORKFLOW_CYCLE",
            "workflows.toml",
            "Workflows may only use actions",
            undefined,
            adapter.id,
          ),
        );
      else ref(errors, actions, target, "workflows.toml", adapter.id, "Action");
      condition(step.when, "workflows.toml", adapter.id, errors);
    }
  }
  for (const [key, raw] of entries(parsers)) {
    const parser = obj(raw);
    if (!Array.isArray(parser.success_exit_codes))
      errors.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "parsers.toml",
          `Parser ${key} requires success_exit_codes`,
          undefined,
          adapter.id,
        ),
      );
    for (const rule of [
      ...(Array.isArray(parser.extract) ? parser.extract : []),
      ...(Array.isArray(parser.progress) ? parser.progress : []),
      ...(Array.isArray(parser.errors) ? parser.errors : []),
    ])
      try {
        new RegExp(String(obj(rule).pattern));
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
  return errors;
};
