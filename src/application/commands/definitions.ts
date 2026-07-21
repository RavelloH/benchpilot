import { messageRef as msg } from "../../contracts/message-ref.js";
import type {
  CommandCatalogDefinition,
  CommandDefinition,
  CommandFieldDefinition,
  CommandGroupDefinition,
  CommandOutputReference,
  CommandSegment,
  DynamicChildProviderId,
} from "./definition.js";

type RootGroupId =
  "interactive" | "get-started" | "configure" | "execute" | "records" | "help";

const rootGroupMessages = {
  interactive: msg("screen.root.interactive"),
  "get-started": msg("screen.root.getStarted"),
  configure: msg("screen.root.configure"),
  execute: msg("screen.root.execute"),
  records: msg("screen.root.records"),
  help: msg("screen.root.help"),
} as const;

export const rootCommandGroupDefinitions: readonly CommandGroupDefinition[] = [
  {
    id: "interactive",
    label: rootGroupMessages.interactive,
    order: 10,
    views: ["root-help"],
  },
  {
    id: "get-started",
    label: rootGroupMessages["get-started"],
    order: 20,
    views: ["root-help", "root-menu"],
  },
  {
    id: "configure",
    label: rootGroupMessages.configure,
    order: 30,
    views: ["root-help", "root-menu"],
  },
  {
    id: "execute",
    label: rootGroupMessages.execute,
    order: 40,
    views: ["root-help", "root-menu"],
  },
  {
    id: "records",
    label: rootGroupMessages.records,
    order: 50,
    views: ["root-help", "root-menu"],
  },
  {
    id: "help",
    label: rootGroupMessages.help,
    order: 60,
    views: ["root-help", "root-menu"],
  },
];

const literal = (value: string): CommandSegment => ({ kind: "literal", value });
const argumentSegment = (name: string): CommandSegment => ({
  kind: "argument",
  name,
});
const resource = (
  name: string,
  provider: DynamicChildProviderId,
): CommandSegment => ({ kind: "dynamic-resource", name, provider });
const capability = (
  provider: "device-capabilities" | "system-capabilities",
): CommandSegment => ({
  kind: "dynamic-capability",
  name: "capability",
  provider,
});

const argument = (
  name: string,
  summaryKey: `field.${string}`,
  position: number,
  options: Partial<CommandFieldDefinition> = {},
): CommandFieldDefinition => ({
  name,
  kind: "argument",
  summary: msg(summaryKey),
  position,
  value: "string",
  ...options,
});

const option = (
  name: string,
  summaryKey: `field.${string}`,
  options: Partial<CommandFieldDefinition> = {},
): CommandFieldDefinition => ({
  name,
  kind: "option",
  summary: msg(summaryKey),
  value: "string",
  ...options,
});

const outputSchemas: Readonly<Record<string, string>> = {
  "language.list": "benchpilot.language-list",
  "language.get": "benchpilot.language",
  "language.set": "benchpilot.language",
  "config.get": "benchpilot.config-get",
  "config.set": "benchpilot.config-set",
  "config.unset": "benchpilot.config-unset",
  "config.resolved": "benchpilot.config-resolved",
  "config.validate": "benchpilot.config-validate",
  "config.explain": "benchpilot.config-explain",
  "adapter.list": "benchpilot.adapter-list",
  "adapter.show": "benchpilot.adapter",
  "adapter.doctor": "benchpilot.adapter-doctor",
  "adapter.enable": "benchpilot.adapter-state",
  "adapter.disable": "benchpilot.adapter-state",
  "device.list": "benchpilot.device-list",
  "device.scan": "benchpilot.device-scan",
  "device.add": "benchpilot.device-added",
  "device.remove": "benchpilot.device-removed",
  operation: "benchpilot.operation",
  "system.list": "benchpilot.system-list",
  "system.show": "benchpilot.system-detail",
  "system-operation": "benchpilot.system-operation",
  "run.list": "benchpilot.run-list",
  "run.prune": "benchpilot.run-prune",
  "run.detail": "benchpilot.run-detail",
  "run.logs": "benchpilot.run-log",
  "run.artifacts": "benchpilot.run-artifacts",
  "lock.list": "benchpilot.lock-list",
  "lock.clear-stale": "benchpilot.lock-clear-stale",
  "lock.detail": "benchpilot.lock-detail",
  "lock.clear": "benchpilot.lock-clear",
  "approval.list": "benchpilot.approval-list",
  "approval.inspect": "benchpilot.approval-detail",
  "approval.approve": "benchpilot.approval-change",
  "approval.reject": "benchpilot.approval-change",
  help: "benchpilot.help",
  version: "benchpilot.version",
  "upgrade.check": "benchpilot.upgrade-check",
  "upgrade.result": "benchpilot.upgrade",
};

const outputVersions: Readonly<Record<string, number>> = { help: 3 };

const output = (id: string, view = id): CommandOutputReference => ({
  id,
  schema: outputSchemas[id] ?? outputSchemas[view] ?? `benchpilot.${id}`,
  version: outputVersions[id] ?? outputVersions[view] ?? 1,
  view,
});

const leaf = (input: {
  id: string;
  parentId?: string;
  path: readonly CommandSegment[];
  summaryKey: `command.${string}`;
  descriptionKey?: `help.group.${string}` | `help.command.${string}`;
  handler: string;
  arguments?: readonly CommandFieldDefinition[];
  options?: readonly CommandFieldDefinition[];
  interaction?: CommandDefinition["interaction"];
  interactionMenu?: {
    readonly summaryKey: `menu.${string}`;
    readonly order: number;
  };
  interactionRecipe?: CommandDefinition["interactionRecipe"];
  outputId?: string;
  viewId?: string;
  operation?: CommandDefinition["operation"];
  aliases?: readonly string[];
  navigation?: {
    readonly groupId: RootGroupId;
    readonly order: number;
    readonly summaryKey: `help.command.${string}` | `screen.root.${string}`;
  };
}): CommandDefinition => ({
  id: input.id,
  ...(input.parentId ? { parentId: input.parentId } : {}),
  path: input.path,
  summary: msg(input.summaryKey),
  ...(input.descriptionKey ? { description: msg(input.descriptionKey) } : {}),
  arguments: input.arguments ?? [],
  options: input.options ?? [],
  interaction: input.interaction ?? "never",
  ...(input.interactionMenu
    ? {
        interactionMenu: {
          summary: msg(input.interactionMenu.summaryKey),
          order: input.interactionMenu.order,
        },
      }
    : {}),
  ...(input.interactionRecipe
    ? { interactionRecipe: input.interactionRecipe }
    : {}),
  handler: input.handler,
  output: output(input.outputId ?? input.id, input.viewId),
  ...(input.operation ? { operation: input.operation } : {}),
  ...(input.aliases ? { aliases: input.aliases } : {}),
  ...(input.navigation
    ? {
        group: rootGroupMessages[input.navigation.groupId],
        navigation: {
          groupId: input.navigation.groupId,
          order: input.navigation.order,
          summary: msg(input.navigation.summaryKey),
        },
      }
    : {}),
});

const branch = (input: {
  id: string;
  parentId?: string;
  path: readonly CommandSegment[];
  summaryKey: `command.${string}`;
  descriptionKey?: `help.group.${string}` | `help.command.${string}`;
  interaction?: CommandDefinition["interaction"];
  interactionMenu?: {
    readonly summaryKey: `menu.${string}`;
    readonly order: number;
  };
  children?: CommandDefinition["children"];
  navigation?: {
    readonly groupId: RootGroupId;
    readonly order: number;
    readonly summaryKey: `help.command.${string}` | `screen.root.${string}`;
  };
}): CommandDefinition => ({
  id: input.id,
  ...(input.parentId ? { parentId: input.parentId } : {}),
  path: input.path,
  summary: msg(input.summaryKey),
  ...(input.descriptionKey ? { description: msg(input.descriptionKey) } : {}),
  arguments: [],
  options: [],
  interaction: input.interaction ?? "when-incomplete",
  ...(input.interactionMenu
    ? {
        interactionMenu: {
          summary: msg(input.interactionMenu.summaryKey),
          order: input.interactionMenu.order,
        },
      }
    : {}),
  ...(input.children ? { children: input.children } : {}),
  ...(input.navigation
    ? {
        group: rootGroupMessages[input.navigation.groupId],
        navigation: {
          groupId: input.navigation.groupId,
          order: input.navigation.order,
          summary: msg(input.navigation.summaryKey),
        },
      }
    : {}),
});

const configScopeOptions = [
  option("local", "field.scopeLocal", { value: "boolean" }),
  option("project", "field.scopeProject", { value: "boolean" }),
  option("global", "field.scopeGlobal", { value: "boolean" }),
] as const;

export const globalOptionDefinitions = [
  option("json", "field.json", { value: "boolean" }),
  option("jsonl", "field.jsonl", { value: "boolean" }),
  option("quiet", "field.quiet", { value: "boolean" }),
  option("verbose", "field.verbose", { value: "boolean" }),
  option("timeout", "field.timeout"),
  option("dry-run", "field.dryRun", { value: "boolean" }),
  option("agent", "field.agent", { value: "boolean" }),
  option("color", "field.color", { value: "boolean", negatable: true }),
  option("config", "field.configPath", { placeholder: "path" }),
  option("session", "field.session"),
  option("help", "field.help", { value: "boolean" }),
  option("version", "field.versionFlag", { value: "boolean" }),
] as const satisfies readonly CommandFieldDefinition[];

const adapterPath = [
  literal("adapter"),
  resource("adapter", "adapters"),
] as const;
const devicePath = [
  literal("device"),
  resource("device", "configured-devices"),
] as const;
const systemPath = [
  literal("system"),
  resource("system", "configured-systems"),
] as const;
const runPath = [literal("run"), resource("run", "runs")] as const;
const lockPath = [literal("lock"), resource("lock", "locks")] as const;
const approvalPath = [
  literal("approval"),
  resource("approval", "approvals"),
] as const;

export const staticCommandDefinitions: readonly CommandDefinition[] = [
  leaf({
    id: "init",
    path: [literal("init")],
    summaryKey: "command.init",
    descriptionKey: "help.command.init",
    handler: "init.execute",
    interaction: "when-incomplete",
    navigation: {
      groupId: "get-started",
      order: 10,
      summaryKey: "help.command.init",
    },
    options: [
      option("project-name", "field.projectName", { required: true }),
      option("locale", "field.locale", { enum: ["en", "zh-CN"] }),
      option("adapter", "field.adapterId", {
        repeatable: true,
        choiceProvider: "available-adapters",
      }),
    ],
    interactionRecipe: {
      steps: [
        {
          field: "locale",
          choices: "supported-locales",
          collect: "absent",
          updatesLocale: true,
        },
        { field: "project-name" },
        {
          field: "adapter",
          choices: "available-adapters",
          collect: "absent",
        },
      ],
    },
  }),
  leaf({
    id: "doctor",
    path: [literal("doctor")],
    summaryKey: "command.doctor",
    descriptionKey: "help.command.doctor",
    handler: "doctor.execute",
    options: [option("save", "field.save", { value: "boolean" })],
    navigation: {
      groupId: "get-started",
      order: 20,
      summaryKey: "help.command.doctor",
    },
  }),
  branch({
    id: "language",
    path: [literal("language")],
    summaryKey: "command.language.root",
    descriptionKey: "help.group.language",
    navigation: {
      groupId: "get-started",
      order: 30,
      summaryKey: "screen.root.language",
    },
  }),
  leaf({
    id: "language.list",
    parentId: "language",
    path: [literal("language"), literal("list")],
    summaryKey: "command.language.list",
    handler: "language.list",
    interactionMenu: { summaryKey: "menu.action.list", order: 10 },
  }),
  leaf({
    id: "language.get",
    parentId: "language",
    path: [literal("language"), literal("get")],
    summaryKey: "command.language.get",
    handler: "language.get",
    interactionMenu: { summaryKey: "menu.action.get", order: 20 },
  }),
  leaf({
    id: "language.set",
    parentId: "language",
    path: [literal("language"), literal("set"), argumentSegment("locale")],
    summaryKey: "command.language.set",
    handler: "language.set",
    interactionMenu: { summaryKey: "menu.action.set", order: 30 },
    arguments: [argument("locale", "field.locale", 0, { required: true })],
    interaction: "when-incomplete",
    interactionRecipe: {
      steps: [{ field: "locale", choices: "supported-locales" }],
    },
  }),
  branch({
    id: "config",
    path: [literal("config")],
    summaryKey: "command.config.root",
    descriptionKey: "help.group.config",
    navigation: {
      groupId: "configure",
      order: 10,
      summaryKey: "screen.root.config",
    },
  }),
  leaf({
    id: "config.get",
    parentId: "config",
    path: [literal("config"), literal("get"), argumentSegment("key")],
    summaryKey: "command.config.get",
    handler: "config.get",
    interactionMenu: { summaryKey: "menu.action.get", order: 10 },
    arguments: [argument("key", "field.configKey", 0, { required: true })],
    options: [
      option("show-origin", "field.origin", {
        value: "boolean",
        aliases: ["origin"],
      }),
    ],
    interaction: "when-incomplete",
    interactionRecipe: {
      steps: [{ field: "key", choices: "configuration-keys" }],
    },
  }),
  leaf({
    id: "config.set",
    parentId: "config",
    path: [
      literal("config"),
      literal("set"),
      argumentSegment("key"),
      argumentSegment("value"),
    ],
    summaryKey: "command.config.set",
    handler: "config.set",
    interactionMenu: { summaryKey: "menu.action.set", order: 20 },
    arguments: [
      argument("key", "field.configKey", 0, { required: true }),
      argument("value", "field.configValue", 1, { required: true }),
    ],
    options: configScopeOptions,
    interaction: "when-incomplete",
    interactionRecipe: {
      steps: [
        { field: "key", choices: "configuration-keys" },
        {
          oneOf: ["local", "project", "global"],
          choices: "configuration-scopes",
        },
        { field: "value", choices: "configuration-values" },
      ],
    },
  }),
  leaf({
    id: "config.unset",
    parentId: "config",
    path: [literal("config"), literal("unset"), argumentSegment("key")],
    summaryKey: "command.config.unset",
    handler: "config.unset",
    interactionMenu: { summaryKey: "menu.action.unset", order: 30 },
    arguments: [argument("key", "field.configKey", 0, { required: true })],
    options: configScopeOptions,
    interaction: "when-incomplete",
    interactionRecipe: {
      steps: [
        { field: "key", choices: "configuration-keys" },
        {
          oneOf: ["local", "project", "global"],
          choices: "configuration-scopes",
        },
      ],
    },
  }),
  ...["resolved", "validate"].map((action) =>
    leaf({
      id: `config.${action}`,
      parentId: "config",
      path: [literal("config"), literal(action)],
      summaryKey: `command.config.${action}` as
        "command.config.resolved" | "command.config.validate",
      handler: `config.${action}`,
      interactionMenu: {
        summaryKey: `menu.action.${action}` as
          "menu.action.resolved" | "menu.action.validate",
        order: action === "resolved" ? 40 : 60,
      },
    }),
  ),
  leaf({
    id: "config.explain",
    parentId: "config",
    path: [literal("config"), literal("explain"), argumentSegment("key")],
    summaryKey: "command.config.explain",
    handler: "config.explain",
    interactionMenu: { summaryKey: "menu.action.explain", order: 50 },
    arguments: [argument("key", "field.configKey", 0, { required: true })],
    interaction: "when-incomplete",
    interactionRecipe: {
      steps: [{ field: "key", choices: "configuration-keys" }],
    },
  }),
  branch({
    id: "adapter",
    path: [literal("adapter")],
    summaryKey: "command.adapter.root",
    descriptionKey: "help.group.adapter",
    navigation: {
      groupId: "configure",
      order: 20,
      summaryKey: "screen.root.adapter",
    },
  }),
  leaf({
    id: "adapter.list",
    parentId: "adapter",
    path: [literal("adapter"), literal("list")],
    summaryKey: "command.adapter.list",
    handler: "adapter.list",
    interactionMenu: { summaryKey: "menu.action.list", order: 10 },
  }),
  branch({
    id: "adapter.resource",
    parentId: "adapter",
    path: adapterPath,
    summaryKey: "command.adapter.resource",
  }),
  ...["show", "doctor", "enable", "disable"].map((action) =>
    leaf({
      id: `adapter.${action}`,
      parentId: "adapter.resource",
      path: [...adapterPath, literal(action)],
      summaryKey: `command.adapter.${action}` as
        | "command.adapter.show"
        | "command.adapter.doctor"
        | "command.adapter.enable"
        | "command.adapter.disable",
      handler: `adapter.${action}`,
      interactionMenu: {
        summaryKey: `menu.action.${action}` as
          | "menu.action.show"
          | "menu.action.doctor"
          | "menu.action.enable"
          | "menu.action.disable",
        order: { show: 10, doctor: 20, enable: 30, disable: 40 }[action]!,
      },
      arguments: [
        argument("adapter", "field.adapterId", 0, { required: true }),
      ],
    }),
  ),
  branch({
    id: "device",
    path: [literal("device")],
    summaryKey: "command.device.root",
    descriptionKey: "help.group.device",
    navigation: {
      groupId: "execute",
      order: 10,
      summaryKey: "screen.root.device",
    },
  }),
  leaf({
    id: "device.list",
    parentId: "device",
    path: [literal("device"), literal("list")],
    summaryKey: "command.device.list",
    handler: "device.list",
    interactionMenu: { summaryKey: "menu.action.list", order: 10 },
  }),
  leaf({
    id: "device.scan",
    parentId: "device",
    path: [literal("device"), literal("scan")],
    summaryKey: "command.device.scan",
    handler: "device.scan",
    interactionMenu: { summaryKey: "menu.action.scan", order: 20 },
    options: [option("adapter", "field.adapterId")],
  }),
  leaf({
    id: "device.add",
    parentId: "device",
    path: [literal("device"), literal("add")],
    summaryKey: "command.device.add",
    handler: "device.add",
    interaction: "when-incomplete",
    interactionMenu: { summaryKey: "menu.action.add", order: 30 },
    options: [
      option("adapter", "field.adapterId", { required: true }),
      option("identity", "field.identity", { required: true }),
      option("name", "field.deviceName", { required: true }),
      option("port", "field.port"),
    ],
  }),
  leaf({
    id: "device.remove",
    parentId: "device",
    path: [literal("device"), literal("remove"), argumentSegment("device")],
    summaryKey: "command.device.remove",
    handler: "device.remove",
    interaction: "when-incomplete",
    interactionMenu: { summaryKey: "menu.action.remove", order: 40 },
    arguments: [
      argument("device", "field.deviceInstance", 0, { required: true }),
    ],
  }),
  branch({
    id: "device.resource",
    parentId: "device",
    path: devicePath,
    summaryKey: "command.device.resource",
  }),
  leaf({
    id: "device.execute",
    parentId: "device.resource",
    path: [...devicePath, capability("device-capabilities")],
    summaryKey: "command.device.execute",
    handler: "device.execute",
    arguments: [
      argument("device", "field.deviceInstance", 0, { required: true }),
      argument("capability", "field.capability", 1, { required: true }),
    ],
    outputId: "operation",
    operation: { kind: "dynamic-capability" },
  }),
  branch({
    id: "system",
    path: [literal("system")],
    summaryKey: "command.system.root",
    descriptionKey: "help.group.system",
    navigation: {
      groupId: "execute",
      order: 20,
      summaryKey: "screen.root.system",
    },
  }),
  leaf({
    id: "system.list",
    parentId: "system",
    path: [literal("system"), literal("list")],
    summaryKey: "command.system.list",
    handler: "system.list",
    interactionMenu: { summaryKey: "menu.action.list", order: 10 },
  }),
  leaf({
    id: "system.create",
    parentId: "system",
    path: [
      literal("system"),
      literal("create"),
      argumentSegment("name"),
      argumentSegment("devices"),
    ],
    summaryKey: "command.system.create",
    handler: "system.create",
    viewId: "config.set",
    interaction: "when-incomplete",
    interactionMenu: { summaryKey: "menu.action.create", order: 20 },
    arguments: [
      argument("name", "field.systemName", 0, { required: true }),
      argument("devices", "field.devices", 1, {
        required: true,
        variadic: true,
        repeatable: true,
      }),
    ],
  }),
  leaf({
    id: "system.delete",
    parentId: "system",
    path: [literal("system"), literal("delete"), argumentSegment("system")],
    summaryKey: "command.system.delete",
    handler: "system.delete",
    viewId: "config.unset",
    interaction: "when-incomplete",
    interactionMenu: { summaryKey: "menu.action.delete", order: 30 },
    arguments: [argument("system", "field.systemName", 0, { required: true })],
  }),
  branch({
    id: "system.member",
    parentId: "system",
    path: [literal("system"), literal("member")],
    summaryKey: "command.system.member.root",
    interactionMenu: { summaryKey: "menu.action.member", order: 40 },
  }),
  ...["add", "remove"].map((action) =>
    leaf({
      id: `system.member.${action}`,
      parentId: "system.member",
      path: [
        literal("system"),
        literal("member"),
        literal(action),
        argumentSegment("system"),
        argumentSegment("device"),
      ],
      summaryKey: `command.system.member.${action}` as
        "command.system.member.add" | "command.system.member.remove",
      handler: `system.member.${action}`,
      interactionMenu: {
        summaryKey: `menu.action.${action}` as
          "menu.action.add" | "menu.action.remove",
        order: action === "add" ? 10 : 20,
      },
      viewId: "config.set",
      arguments: [
        argument("system", "field.systemName", 0, { required: true }),
        argument("device", "field.deviceInstance", 1, { required: true }),
      ],
    }),
  ),
  branch({
    id: "system.resource",
    parentId: "system",
    path: systemPath,
    summaryKey: "command.system.resource",
  }),
  leaf({
    id: "system.show",
    parentId: "system.resource",
    path: [...systemPath, literal("show")],
    summaryKey: "command.system.show",
    handler: "system.show",
    interactionMenu: { summaryKey: "menu.action.show", order: 10 },
    arguments: [argument("system", "field.systemName", 0, { required: true })],
  }),
  leaf({
    id: "system.execute",
    parentId: "system.resource",
    path: [...systemPath, capability("system-capabilities")],
    summaryKey: "command.system.execute",
    handler: "system.execute",
    arguments: [
      argument("system", "field.systemName", 0, { required: true }),
      argument("capability", "field.capability", 1, { required: true }),
    ],
    outputId: "system-operation",
    operation: { kind: "dynamic-capability" },
  }),
  branch({
    id: "run",
    path: [literal("run")],
    summaryKey: "command.run.root",
    descriptionKey: "help.group.run",
    navigation: {
      groupId: "records",
      order: 10,
      summaryKey: "screen.root.run",
    },
  }),
  leaf({
    id: "run.list",
    parentId: "run",
    path: [literal("run"), literal("list")],
    summaryKey: "command.run.list",
    handler: "run.list",
    options: [option("status", "field.status"), option("limit", "field.limit")],
    interactionMenu: { summaryKey: "menu.action.list", order: 10 },
  }),
  leaf({
    id: "run.prune",
    parentId: "run",
    path: [literal("run"), literal("prune")],
    summaryKey: "command.run.prune",
    handler: "run.prune",
    options: [
      option("older-than", "field.olderThan"),
      option("keep", "field.keep"),
      option("dangerously-remove-all-runs", "field.removeAllRuns", {
        value: "boolean",
      }),
    ],
    interactionRecipe: {
      steps: [
        {
          oneOf: ["keep", "older-than", "dangerously-remove-all-runs"],
          choices: "run-prune-mode",
        },
        {
          field: "keep",
          collect: "absent",
          whenOption: { name: "keep" },
        },
        {
          field: "older-than",
          collect: "absent",
          whenOption: { name: "older-than" },
        },
      ],
    },
    interactionMenu: { summaryKey: "menu.action.prune", order: 20 },
  }),
  branch({
    id: "run.resource",
    parentId: "run",
    path: runPath,
    summaryKey: "command.run.resource",
  }),
  ...["show", "logs", "artifacts"].map((action) =>
    leaf({
      id: `run.${action}`,
      parentId: "run.resource",
      path: [...runPath, literal(action)],
      summaryKey: `command.run.${action}` as
        "command.run.show" | "command.run.logs" | "command.run.artifacts",
      handler: `run.${action}`,
      interactionMenu: {
        summaryKey: `menu.action.${action}` as
          "menu.action.show" | "menu.action.logs" | "menu.action.artifacts",
        order: { show: 10, logs: 20, artifacts: 30 }[action]!,
      },
      ...(action === "show" ? { viewId: "run.detail" } : {}),
      arguments: [argument("run", "field.runId", 0, { required: true })],
    }),
  ),
  branch({
    id: "lock",
    path: [literal("lock")],
    summaryKey: "command.lock.root",
    descriptionKey: "help.group.lock",
    navigation: {
      groupId: "records",
      order: 30,
      summaryKey: "screen.root.lock",
    },
  }),
  leaf({
    id: "lock.list",
    parentId: "lock",
    path: [literal("lock"), literal("list")],
    summaryKey: "command.lock.list",
    handler: "lock.list",
    interactionMenu: { summaryKey: "menu.lock.listAll", order: 10 },
  }),
  leaf({
    id: "lock.clear-stale",
    parentId: "lock",
    path: [literal("lock"), literal("clear-stale")],
    summaryKey: "command.lock.clearStale",
    handler: "lock.clear-stale",
    interactionMenu: {
      summaryKey: "menu.action.clear-stale",
      order: 20,
    },
  }),
  branch({
    id: "lock.resource",
    parentId: "lock",
    path: lockPath,
    summaryKey: "command.lock.resource",
  }),
  ...["show", "inspect", "clear"].map((action) =>
    leaf({
      id: `lock.${action}`,
      parentId: "lock.resource",
      path: [...lockPath, literal(action)],
      summaryKey:
        `command.lock.${action === "inspect" ? "inspect" : action}` as
          "command.lock.show" | "command.lock.inspect" | "command.lock.clear",
      handler: `lock.${action}`,
      interactionMenu: {
        summaryKey: `menu.action.${action}` as
          "menu.action.show" | "menu.action.inspect" | "menu.action.clear",
        order: { show: 10, inspect: 20, clear: 30 }[action]!,
      },
      ...(action === "show" || action === "inspect"
        ? { viewId: "lock.detail" }
        : {}),
      arguments: [argument("lock", "field.lockId", 0, { required: true })],
      ...(action === "clear"
        ? {
            options: [
              option("dangerously-clear-active-lock", "field.clearActiveLock", {
                value: "boolean",
              }),
              option(
                "dangerously-clear-quarantined-lock",
                "field.clearQuarantinedLock",
                { value: "boolean" },
              ),
            ],
          }
        : {}),
      interaction: action === "clear" ? "required" : "never",
    }),
  ),
  branch({
    id: "approval",
    path: [literal("approval")],
    summaryKey: "command.approval.root",
    descriptionKey: "help.group.approval",
    navigation: {
      groupId: "records",
      order: 20,
      summaryKey: "screen.root.approval",
    },
  }),
  leaf({
    id: "approval.list",
    parentId: "approval",
    path: [literal("approval"), literal("list")],
    summaryKey: "command.approval.list",
    handler: "approval.list",
    interactionMenu: { summaryKey: "menu.approval.listAll", order: 10 },
  }),
  branch({
    id: "approval.resource",
    parentId: "approval",
    path: approvalPath,
    summaryKey: "command.approval.resource",
  }),
  ...["inspect", "approve", "reject"].map((action) =>
    leaf({
      id: `approval.${action}`,
      parentId: "approval.resource",
      path: [...approvalPath, literal(action)],
      summaryKey: `command.approval.${action}` as
        | "command.approval.inspect"
        | "command.approval.approve"
        | "command.approval.reject",
      handler: `approval.${action}`,
      interactionMenu: {
        summaryKey: `menu.action.${action}` as
          "menu.action.inspect" | "menu.action.approve" | "menu.action.reject",
        order: { inspect: 10, approve: 20, reject: 30 }[action]!,
      },
      arguments: [
        argument("approval", "field.approvalId", 0, { required: true }),
      ],
      interaction:
        action === "approve" || action === "reject" ? "required" : "never",
    }),
  ),
  leaf({
    id: "help",
    path: [literal("help"), argumentSegment("path")],
    summaryKey: "command.help",
    descriptionKey: "help.group.help",
    handler: "help.show",
    arguments: [
      argument("path", "field.commandPath", 0, {
        variadic: true,
        repeatable: true,
      }),
    ],
    options: [option("all", "field.all", { value: "boolean" })],
    outputId: "help",
    navigation: {
      groupId: "help",
      order: 20,
      summaryKey: "help.command.help",
    },
  }),
  leaf({
    id: "home",
    path: [literal("home")],
    summaryKey: "command.home",
    descriptionKey: "help.group.home",
    handler: "home.show",
    interaction: "required",
    navigation: {
      groupId: "interactive",
      order: 10,
      summaryKey: "help.command.home",
    },
  }),
  leaf({
    id: "version",
    path: [literal("version")],
    summaryKey: "command.version",
    descriptionKey: "help.group.version",
    handler: "version.show",
    navigation: {
      groupId: "help",
      order: 30,
      summaryKey: "help.command.version",
    },
  }),
  branch({
    id: "upgrade",
    path: [literal("upgrade")],
    summaryKey: "command.upgrade.root",
    descriptionKey: "help.group.upgrade",
    navigation: {
      groupId: "help",
      order: 10,
      summaryKey: "screen.root.upgrade",
    },
  }),
  leaf({
    id: "upgrade.check",
    parentId: "upgrade",
    path: [literal("upgrade"), literal("check")],
    summaryKey: "command.upgrade.check",
    handler: "upgrade.check",
  }),
  leaf({
    id: "upgrade.latest",
    parentId: "upgrade",
    path: [literal("upgrade"), literal("latest")],
    summaryKey: "command.upgrade.latest",
    handler: "upgrade.install",
    viewId: "upgrade.result",
  }),
  leaf({
    id: "upgrade.version",
    parentId: "upgrade",
    path: [literal("upgrade"), resource("version", "upgrade-versions")],
    summaryKey: "command.upgrade.version",
    handler: "upgrade.install",
    viewId: "upgrade.result",
    arguments: [
      argument("version", "field.targetVersion", 0, { required: true }),
    ],
  }),
];

/** Authoritative semantic source for command resolution, help, and menus. */
export const commandCatalogDefinition: CommandCatalogDefinition = {
  root: {
    id: "root",
    summary: msg("help.group.root"),
    usage: ["benchpilot <command> [arguments] [options]"],
    helpView: "root-help",
    allHelpView: "all-help",
    interactionView: "root-menu",
    globalOptions: [
      { name: "json", summary: msg("screen.root.optionJson") },
      { name: "jsonl", summary: msg("screen.root.optionJsonl") },
      { name: "config", summary: msg("screen.root.optionConfig") },
      { name: "agent", summary: msg("screen.root.optionAgent") },
      { name: "help", summary: msg("screen.root.optionHelp") },
    ],
    examples: [
      { argv: ["device", "scan"] },
      { argv: ["device", "<device>", "status"] },
      { argv: ["device", "<device>", "status", "--json"] },
    ],
    footer: [msg("screen.root.more"), msg("screen.root.repository")],
  },
  commandHelpView: "command-help",
  groups: rootCommandGroupDefinitions,
  globalOptions: globalOptionDefinitions,
  commands: staticCommandDefinitions,
};
