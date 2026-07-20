import { messageRef as msg } from "../../contracts/message-ref.js";
import type { DataViewDefinition } from "./data-types.js";

export const dataViewDefinitions: readonly DataViewDefinition[] = [
  {
    id: "capability.device",
    blocks: [
      {
        component: "Detail",
        source: "execution",
        title: msg("capabilityResult.execution.title"),
        labelWidth: 12,
        rows: [
          {
            field: "status",
            label: msg("capabilityResult.status"),
            formatter: "capability-status",
          },
          {
            field: "runId",
            label: msg("capabilityResult.run"),
            formatter: "string",
            tone: "argument",
            omitEmpty: true,
          },
          {
            field: "durationMs",
            label: msg("capabilityResult.duration"),
            formatter: "duration-ms",
            tone: "debug",
          },
        ],
      },
      {
        component: "ObjectTree",
        source: "output",
        title: msg("capabilityResult.output.title"),
        empty: msg("capabilityResult.output.empty"),
        labelWidth: 10,
        rows: [
          {
            field: "value",
            label: msg("capabilityResult.value"),
            formatter: "json-value",
          },
        ],
      },
      {
        component: "Table",
        source: "artifacts",
        title: msg("capabilityResult.artifacts.title"),
        empty: msg("capabilityResult.artifacts.empty"),
        omitWhenEmpty: true,
        columns: [
          {
            field: "name",
            formatter: "string",
            tone: "command",
            width: { kind: "content", min: 16, gap: 2 },
          },
          {
            field: "kind",
            formatter: "string",
            tone: "argument",
            width: { kind: "content", min: 12, gap: 2 },
          },
          { field: "path", formatter: "string" },
        ],
      },
      {
        component: "Table",
        source: "diagnostics",
        title: msg("capabilityResult.diagnostics.title"),
        empty: msg("capabilityResult.diagnostics.empty"),
        omitWhenEmpty: true,
        columns: [
          {
            field: "level",
            formatter: "diagnostic-level",
            width: { kind: "content", min: 8, gap: 2 },
          },
          { field: "message", formatter: "diagnostic-message" },
        ],
      },
    ],
  },
  {
    id: "capability.system",
    blocks: [
      {
        component: "Detail",
        source: "execution",
        title: msg("capabilityResult.execution.title"),
        labelWidth: 12,
        rows: [
          {
            field: "status",
            label: msg("capabilityResult.status"),
            formatter: "capability-status",
          },
          {
            field: "durationMs",
            label: msg("capabilityResult.duration"),
            formatter: "duration-ms",
            tone: "debug",
          },
        ],
      },
      {
        component: "Table",
        source: "members",
        title: msg("capabilityResult.members.title"),
        empty: msg("capabilityResult.members.empty"),
        columns: [
          {
            field: "device.instance",
            formatter: "string",
            tone: "command",
            width: { kind: "content", min: 12, gap: 2 },
          },
          {
            field: "outcome.execution.status",
            formatter: "capability-status",
            width: { kind: "fixed", size: 12, minimum: 1 },
          },
          {
            field: "outcome.execution.runId",
            formatter: "fallback-dash",
            tone: "argument",
          },
        ],
      },
    ],
  },
  {
    id: "language.list",
    blocks: [
      {
        component: "Table",
        source: "languages",
        title: msg("languageResult.list.title"),
        empty: msg("languageResult.list.empty"),
        header: true,
        columns: [
          {
            field: "locale",
            header: msg("languageResult.locale"),
            formatter: "string",
            tone: "command",
            width: { kind: "content", min: 10, gap: 2 },
          },
          {
            field: "name",
            header: msg("languageResult.name"),
            formatter: "string",
          },
        ],
      },
    ],
  },
  ...(
    [
      ["language.get", msg("languageResult.current.title")],
      ["language.set", msg("languageResult.updated.title")],
    ] as const
  ).map(([id, title]) => ({
    id,
    blocks: [
      {
        component: "Detail" as const,
        source: "language",
        title,
        labelWidth: 12,
        rows: [
          {
            field: "locale",
            label: msg("languageResult.locale"),
            formatter: "string" as const,
            tone: "command" as const,
          },
          {
            field: "name",
            label: msg("languageResult.name"),
            formatter: "string" as const,
            tone: "argument" as const,
          },
        ],
      },
    ],
  })),
  {
    id: "adapter.list",
    blocks: [
      {
        component: "Table",
        source: "adapters",
        title: msg("adapterResult.list.title"),
        empty: msg("adapterResult.list.empty"),
        columns: [
          {
            field: "id",
            formatter: "string",
            tone: "command",
            width: { kind: "content", min: 12, gap: 2 },
          },
          {
            field: "version",
            formatter: "string",
            tone: "argument",
            width: { kind: "fixed", size: 10, minimum: 1 },
          },
          { field: "summary", formatter: "string" },
        ],
      },
    ],
  },
  {
    id: "device.list",
    blocks: [
      {
        component: "Table",
        source: "items",
        title: msg("resourceResult.devices.title"),
        empty: msg("resourceResult.devices.empty"),
        columns: [
          {
            field: "id",
            formatter: "string",
            tone: "command",
            width: { kind: "content", min: 14, gap: 2 },
          },
          { field: "adapter", formatter: "resource-summary" },
        ],
      },
    ],
  },
  {
    id: "system.list",
    blocks: [
      {
        component: "Table",
        source: "items",
        title: msg("resourceResult.systems.title"),
        empty: msg("resourceResult.systems.empty"),
        columns: [
          {
            field: "id",
            formatter: "string",
            tone: "command",
            width: { kind: "content", min: 14, gap: 2 },
          },
          { field: "members", formatter: "resource-summary" },
        ],
      },
    ],
  },
  {
    id: "run.list",
    blocks: [
      {
        component: "Table",
        source: "runs",
        title: msg("run.list.title"),
        empty: msg("run.list.none"),
        header: true,
        columns: [
          {
            field: "id",
            header: msg("run.list.id"),
            formatter: "string",
            tone: "command",
            width: { kind: "content", min: 34, gap: 2 },
          },
          {
            field: "status",
            header: msg("run.list.status"),
            formatter: "run-status",
            paddingTone: "outside",
            width: { kind: "fixed", size: 10, minimum: 1 },
          },
          {
            field: "command",
            header: msg("run.list.command"),
            formatter: "fallback-dash",
            tone: "argument",
          },
        ],
      },
    ],
  },
  {
    id: "run.prune",
    blocks: [
      {
        component: "List",
        source: "removed",
        title: msg("run.prune.title"),
        empty: msg("run.prune.none"),
        formatter: "string",
        tone: "command",
      },
    ],
  },
  {
    id: "adapter.show",
    blocks: [
      {
        component: "Detail",
        source: "adapter",
        title: msg("adapterResult.info.title"),
        labelWidth: 12,
        rows: [
          {
            field: "id",
            label: msg("adapterResult.id"),
            formatter: "string",
            tone: "command",
          },
          {
            field: "version",
            label: msg("adapterResult.version"),
            formatter: "string",
            tone: "argument",
          },
          {
            field: "summary",
            label: msg("adapterResult.summary"),
            formatter: "string",
          },
        ],
      },
    ],
  },
  {
    id: "adapter.doctor",
    blocks: [
      {
        component: "Table",
        source: "checks",
        title: msg("adapterResult.doctor.title"),
        header: true,
        headerWhenEmpty: true,
        columns: [
          {
            field: "id",
            header: msg("doctor.id"),
            formatter: "string",
            tone: "command",
            width: { kind: "content", min: 14, gap: 2 },
          },
          {
            field: "status",
            header: msg("doctor.result"),
            formatter: "doctor-status",
            paddingTone: "outside",
            width: { kind: "fixed", size: 8, minimum: 1 },
          },
          {
            field: "message",
            header: msg("doctor.message"),
            formatter: "diagnostic-message",
          },
        ],
      },
    ],
  },
  {
    id: "doctor",
    blocks: [
      {
        component: "GroupedTable",
        source: "checks",
        groupBy: "adapter",
        defaultTitle: msg("doctor.local"),
        groupTitle: msg("doctor.adapter"),
        groupValueName: "adapter",
        header: true,
        headerWhenEmpty: true,
        columns: [
          {
            field: "id",
            header: msg("doctor.id"),
            formatter: "string",
            tone: "command",
            width: { kind: "content", min: 14, gap: 2 },
          },
          {
            field: "status",
            header: msg("doctor.result"),
            formatter: "doctor-status",
            paddingTone: "outside",
            width: { kind: "fixed", size: 8, minimum: 1 },
          },
          {
            field: "message",
            header: msg("doctor.message"),
            formatter: "diagnostic-message",
          },
        ],
      },
    ],
  },
  {
    id: "device.add",
    blocks: [
      {
        component: "Detail",
        source: "device",
        title: msg("resourceResult.added.title"),
        labelWidth: 12,
        rows: [
          {
            field: "instance",
            label: msg("resourceResult.added.instance"),
            formatter: "string",
            tone: "command",
          },
          {
            field: "adapter",
            label: msg("resourceResult.added.adapter"),
            formatter: "string",
            tone: "argument",
          },
          {
            field: "identity",
            label: msg("resourceResult.added.identity"),
            formatter: "string",
            tone: "argument",
            omitEmpty: true,
          },
          {
            field: "port",
            label: msg("resourceResult.added.port"),
            formatter: "string",
            tone: "argument",
            omitEmpty: true,
          },
          {
            field: "path",
            label: msg("resourceResult.added.path"),
            formatter: "string",
            tone: "muted",
          },
        ],
      },
    ],
  },
  {
    id: "device.remove",
    blocks: [
      {
        component: "Detail",
        source: "device",
        title: msg("resourceResult.removed.title"),
        labelWidth: 12,
        rows: [
          {
            field: "instance",
            label: msg("resourceResult.removed.instance"),
            formatter: "string",
            tone: "command",
          },
          {
            field: "path",
            label: msg("resourceResult.removed.path"),
            formatter: "string",
            tone: "muted",
          },
        ],
      },
    ],
  },
  {
    id: "device.scan",
    blocks: [
      {
        component: "Table",
        source: "devices",
        title: msg("resourceResult.scan.title"),
        empty: msg("resourceResult.scan.empty"),
        header: true,
        columns: [
          {
            field: "identity",
            header: msg("resourceResult.scan.identity"),
            formatter: "fallback-unknown",
            tone: "command",
            width: { kind: "content", min: 1, gap: 2 },
          },
          {
            field: "adapter",
            header: msg("resourceResult.scan.adapter"),
            formatter: "fallback-unknown",
            tone: "argument",
            width: { kind: "content", min: 1, gap: 2 },
          },
          {
            field: "fields.port",
            header: msg("resourceResult.scan.port"),
            formatter: "fallback-dash",
          },
        ],
      },
    ],
  },
  {
    id: "system.show",
    blocks: [
      {
        component: "Detail",
        source: "system",
        title: msg("system.detail.title"),
        labelWidth: 14,
        rows: [
          {
            field: "name",
            label: msg("system.detail.id"),
            formatter: "string",
            tone: "argument",
          },
          {
            field: "displayName",
            label: msg("system.detail.name"),
            formatter: "string",
            tone: "argument",
            omitEmpty: true,
          },
          {
            field: "description",
            label: msg("system.detail.description"),
            formatter: "string",
            tone: "argument",
            omitEmpty: true,
          },
          {
            field: "labels",
            label: msg("system.detail.labels"),
            formatter: "comma-list",
            tone: "argument",
            omitEmpty: true,
          },
        ],
      },
      {
        component: "Table",
        source: "system.members",
        title: msg("system.detail.members"),
        columns: [
          {
            field: "device",
            formatter: "string",
            tone: "command",
            width: { kind: "fixed", size: 18, minimum: 1 },
          },
          { field: "role", formatter: "role" },
        ],
      },
      {
        component: "Table",
        source: "system.capabilities",
        title: msg("system.detail.capabilities"),
        empty: msg("system.detail.capabilitiesEmpty"),
        columns: [
          {
            field: "id",
            formatter: "string",
            tone: "command",
            width: { kind: "fixed", size: 18, minimum: 1 },
          },
          { field: "summary", formatter: "string" },
        ],
      },
    ],
  },
  {
    id: "system-operation",
    blocks: [
      {
        component: "Detail",
        source: "operation",
        title: msg("system.operation.title"),
        labelWidth: 14,
        rows: [
          {
            field: "system",
            label: msg("system.operation.system"),
            formatter: "string",
            tone: "command",
          },
          {
            field: "capability",
            label: msg("system.operation.capability"),
            formatter: "string",
            tone: "command",
          },
        ],
      },
      {
        component: "Table",
        source: "operation.results",
        title: msg("system.operation.results"),
        columns: [
          {
            field: "device",
            formatter: "string",
            tone: "command",
            width: { kind: "fixed", size: 18, minimum: 1 },
          },
          { field: "ok", formatter: "system-result" },
        ],
      },
    ],
  },
  {
    id: "config.get",
    blocks: [
      {
        component: "Detail",
        source: "",
        title: msg("configResult.get.title"),
        labelWidth: 12,
        rows: [
          {
            field: "key",
            label: msg("configResult.key"),
            formatter: "string",
            tone: "command",
          },
          {
            field: "value",
            label: msg("configResult.value"),
            formatter: "json-value",
            tone: "argument",
          },
          {
            field: "origin",
            label: msg("configResult.origin"),
            formatter: "origin",
            tone: "muted",
          },
        ],
      },
    ],
  },
  {
    id: "config.resolved",
    blocks: [
      {
        component: "ObjectTree",
        source: "config",
        metadataSource: "origins",
        title: msg("configResult.resolved.title"),
        empty: msg("configResult.resolved.empty"),
        labelWidth: 12,
        rows: [
          {
            field: "value",
            label: msg("configResult.value"),
            formatter: "json-value",
            tone: "argument",
          },
          {
            field: "origin",
            label: msg("configResult.origin"),
            formatter: "origin",
            tone: "muted",
          },
        ],
      },
    ],
  },
  {
    id: "config.explain",
    blocks: [
      {
        component: "Detail",
        source: "",
        title: msg("configResult.explain.title"),
        labelWidth: 12,
        rows: [
          {
            field: "key",
            label: msg("configResult.key"),
            formatter: "string",
            tone: "command",
          },
          {
            field: "value",
            label: msg("configResult.value"),
            formatter: "json-value",
            tone: "argument",
          },
          {
            field: "origin",
            label: msg("configResult.origin"),
            formatter: "origin",
            tone: "muted",
          },
        ],
      },
      {
        component: "Table",
        source: "layers",
        title: msg("configResult.explain.layers"),
        header: true,
        lineBreakAfter: true,
        columns: [
          {
            field: "scope",
            header: msg("configResult.scope"),
            formatter: "string",
            tone: "command",
            width: { kind: "fixed", size: 16, minimum: 1 },
          },
          {
            field: "value",
            header: msg("configResult.value"),
            formatter: "json-value",
            tone: "argument",
            width: { kind: "fixed", size: 28, minimum: 1 },
          },
          {
            field: "path",
            header: msg("configResult.path"),
            formatter: "fallback-dash",
            tone: "muted",
          },
        ],
      },
    ],
  },
  {
    id: "config.validate",
    blocks: [
      {
        component: "Detail",
        source: "",
        title: msg("configResult.validate.title"),
        labelWidth: 12,
        rows: [
          {
            field: "valid",
            label: msg("configResult.status"),
            formatter: "valid-status",
          },
        ],
      },
    ],
  },
  {
    id: "config.set",
    blocks: [
      {
        component: "Detail",
        source: "",
        title: msg("configResult.mutation.setTitle"),
        labelWidth: 12,
        rows: [
          {
            field: "key",
            label: msg("configResult.key"),
            formatter: "string",
            tone: "command",
          },
          {
            field: "value",
            label: msg("configResult.value"),
            formatter: "json-value",
            tone: "argument",
          },
          {
            field: "scope",
            label: msg("configResult.scope"),
            formatter: "scope",
            tone: "argument",
          },
          {
            field: "path",
            label: msg("configResult.path"),
            formatter: "string",
            tone: "muted",
          },
        ],
      },
    ],
  },
  {
    id: "config.unset",
    blocks: [
      {
        component: "Detail",
        source: "",
        title: msg("configResult.mutation.unsetTitle"),
        labelWidth: 12,
        rows: [
          {
            field: "key",
            label: msg("configResult.key"),
            formatter: "string",
            tone: "command",
          },
          {
            field: "scope",
            label: msg("configResult.scope"),
            formatter: "scope",
            tone: "argument",
          },
          {
            field: "path",
            label: msg("configResult.path"),
            formatter: "string",
            tone: "muted",
          },
        ],
      },
    ],
  },
  {
    id: "init",
    blocks: [
      {
        component: "Message",
        field: "existing",
        messages: {
          true: msg("init.applied"),
          false: msg("init.done"),
        },
        tone: "heading",
      },
      {
        component: "Detail",
        source: "",
        title: msg("init.project"),
        labelWidth: 12,
        rows: [
          {
            field: "project.name",
            label: msg("init.projectName"),
            formatter: "string",
            tone: "argument",
            omitEmpty: true,
          },
          {
            field: "project.id",
            label: msg("init.projectId"),
            formatter: "string",
            tone: "argument",
            omitEmpty: true,
          },
          {
            field: "adapters.enabled",
            label: msg("init.enabledAdapters"),
            formatter: "enabled-adapters",
            tone: "argument",
          },
        ],
      },
    ],
  },
  {
    id: "run.logs",
    blocks: [{ component: "Log", source: "log" }],
  },
  {
    id: "run.detail",
    blocks: [
      {
        component: "Detail",
        source: "run",
        title: msg("run.detail.title"),
        labelWidth: 12,
        rows: [
          {
            field: "id",
            label: msg("run.detail.id"),
            formatter: "string",
            tone: "command",
          },
          {
            field: "status",
            label: msg("run.detail.status"),
            formatter: "run-status",
          },
          {
            field: "command",
            label: msg("run.detail.command"),
            formatter: "string",
            tone: "command",
            omitEmpty: true,
          },
        ],
      },
      {
        component: "Detail",
        source: "run.timing",
        title: msg("run.detail.timing"),
        labelWidth: 12,
        omitWhenEmpty: true,
        rows: [
          {
            field: "startedAt",
            label: msg("run.detail.startedAt"),
            formatter: "string",
            tone: "debug",
            omitEmpty: true,
          },
          {
            field: "endedAt",
            label: msg("run.detail.endedAt"),
            formatter: "string",
            tone: "debug",
            omitEmpty: true,
          },
          {
            field: "durationMs",
            label: msg("run.detail.duration"),
            formatter: "duration-ms",
            tone: "debug",
            omitEmpty: true,
          },
        ],
      },
      {
        component: "Detail",
        source: "run.environment",
        title: msg("run.detail.environment"),
        labelWidth: 12,
        omitWhenEmpty: true,
        rows: [
          {
            field: "hostname",
            label: msg("run.detail.host"),
            formatter: "string",
            omitEmpty: true,
          },
          {
            field: "pid",
            label: msg("run.detail.process"),
            formatter: "string",
            omitEmpty: true,
          },
          {
            field: "platform",
            label: msg("run.detail.platform"),
            formatter: "string",
            omitEmpty: true,
          },
        ],
      },
    ],
  },
  {
    id: "run.artifacts",
    blocks: [
      {
        component: "List",
        source: "artifacts",
        title: msg("run.artifacts.title"),
        empty: msg("run.artifacts.none"),
        formatter: "string",
        tone: "argument",
      },
    ],
  },
  {
    id: "lock.clear-stale",
    blocks: [
      {
        component: "List",
        source: "cleared",
        title: msg("lock.clearStale.heading"),
        empty: msg("lock.clearStale.none"),
        formatter: "string",
        tone: "command",
        limit: 5,
        overflow: {
          message: msg("lock.clearStale.remaining"),
          tone: "warning",
        },
      },
    ],
  },
  {
    id: "lock.list",
    blocks: [
      {
        component: "Table",
        source: "locks",
        title: msg("lock.list.title"),
        empty: msg("lock.list.none"),
        header: true,
        columns: [
          {
            field: "id",
            header: msg("lock.list.id"),
            formatter: "string",
            tone: "command",
            width: { kind: "fixed", size: 34, minimum: 1 },
          },
          {
            field: "liveness",
            header: msg("lock.list.status"),
            formatter: "lock-liveness",
            paddingTone: "outside",
            width: { kind: "fixed", size: 10, minimum: 1 },
          },
          {
            field: "resource",
            header: msg("lock.list.resource"),
            formatter: "lock-resource",
            tone: "argument",
          },
        ],
      },
      {
        component: "Table",
        source: "corrupt",
        title: msg("lock.list.corrupt"),
        header: true,
        omitWhenEmpty: true,
        columns: [
          {
            field: "id",
            header: msg("lock.list.id"),
            formatter: "string",
            tone: "error",
            width: { kind: "fixed", size: 34, minimum: 1 },
          },
          {
            field: "entries",
            header: msg("lock.list.contents"),
            formatter: "comma-list",
            tone: "muted",
          },
        ],
      },
    ],
  },
  {
    id: "lock.detail",
    blocks: [
      {
        component: "Detail",
        source: "",
        title: msg("lock.detail.title"),
        labelWidth: 12,
        rows: [
          {
            field: "id",
            label: msg("lock.detail.id"),
            formatter: "string",
            tone: "command",
          },
          {
            field: "liveness",
            label: msg("lock.detail.liveness"),
            formatter: "lock-liveness",
          },
          {
            field: "state",
            label: msg("lock.detail.recordState"),
            formatter: "lock-state",
          },
        ],
      },
      {
        component: "Detail",
        source: "resource",
        title: msg("lock.detail.resource"),
        labelWidth: 12,
        rows: [
          {
            field: "adapter",
            label: msg("lock.detail.adapter"),
            formatter: "string",
            tone: "argument",
          },
          {
            field: "kind",
            label: msg("lock.detail.kind"),
            formatter: "string",
            tone: "argument",
          },
          {
            field: "physicalId",
            label: msg("lock.detail.physicalId"),
            formatter: "string",
            tone: "argument",
          },
        ],
      },
      {
        component: "Detail",
        source: "owner",
        title: msg("lock.detail.owner"),
        labelWidth: 12,
        rows: [
          {
            field: "hostname",
            label: msg("lock.detail.host"),
            formatter: "string",
            tone: "argument",
          },
          {
            field: "pid",
            label: msg("lock.detail.process"),
            formatter: "string",
            tone: "argument",
          },
          {
            field: "command",
            label: msg("lock.detail.command"),
            formatter: "string",
            tone: "command",
          },
          {
            field: "session",
            label: msg("lock.detail.session"),
            formatter: "string",
            tone: "argument",
            omitEmpty: true,
          },
          {
            field: "runId",
            label: msg("lock.detail.run"),
            formatter: "string",
            tone: "argument",
            omitEmpty: true,
          },
        ],
      },
      {
        component: "Detail",
        source: "timing",
        title: msg("lock.detail.timing"),
        labelWidth: 12,
        rows: [
          {
            field: "acquiredAt",
            label: msg("lock.detail.acquiredAt"),
            formatter: "string",
            tone: "debug",
          },
          {
            field: "heartbeatAt",
            label: msg("lock.detail.heartbeatAt"),
            formatter: "string",
            tone: "debug",
          },
          {
            field: "expiresAt",
            label: msg("lock.detail.expiresAt"),
            formatter: "string",
            tone: "debug",
          },
        ],
      },
    ],
  },
  {
    id: "lock.clear",
    blocks: [
      {
        component: "Detail",
        source: "lock",
        title: msg("lock.clear.title"),
        labelWidth: 12,
        rows: [
          {
            field: "id",
            label: msg("lock.detail.id"),
            formatter: "string",
            tone: "command",
          },
          {
            field: "resource.physicalId",
            label: msg("lock.detail.physicalId"),
            formatter: "string",
            tone: "argument",
          },
        ],
      },
    ],
  },
  ...(
    [
      ["approval.approve", msg("approval.change.approved")],
      ["approval.reject", msg("approval.change.rejected")],
    ] as const
  ).map(([id, title]) => ({
    id,
    blocks: [
      {
        component: "Detail" as const,
        source: "approval",
        title,
        labelWidth: 12,
        rows: [
          {
            field: "id",
            label: msg("approval.detail.id"),
            formatter: "string" as const,
            tone: "command" as const,
          },
          {
            field: "status",
            label: msg("approval.detail.status"),
            formatter: "approval-status" as const,
          },
        ],
      },
    ],
  })),
  {
    id: "approval.inspect",
    blocks: [
      {
        component: "Detail",
        source: "",
        title: msg("approval.detail.title"),
        labelWidth: 12,
        rows: [
          {
            field: "id",
            label: msg("approval.detail.id"),
            formatter: "string",
            tone: "command",
          },
          {
            field: "status",
            label: msg("approval.detail.status"),
            formatter: "approval-status",
          },
        ],
      },
      {
        component: "Detail",
        source: "binding",
        title: msg("approval.detail.binding"),
        labelWidth: 12,
        rows: [
          {
            field: "command",
            label: msg("approval.detail.command"),
            formatter: "approval-command",
            tone: "command",
            omitEmpty: true,
          },
          {
            field: "project",
            label: msg("approval.detail.project"),
            formatter: "approval-project",
            tone: "argument",
            omitEmpty: true,
          },
          {
            field: "input",
            label: msg("approval.detail.input"),
            formatter: "json-value-optional",
            tone: "debug",
            omitEmpty: true,
          },
        ],
      },
      {
        component: "Detail",
        source: "binding.device",
        title: msg("approval.detail.device"),
        labelWidth: 12,
        omitWhenEmpty: true,
        rows: [
          {
            field: "adapter",
            label: msg("approval.detail.adapter"),
            formatter: "string",
            tone: "argument",
            omitEmpty: true,
          },
          {
            field: "instance",
            label: msg("approval.detail.instance"),
            formatter: "string",
            tone: "argument",
            omitEmpty: true,
          },
          {
            field: "physicalId",
            label: msg("approval.detail.physicalId"),
            formatter: "string",
            tone: "argument",
            omitEmpty: true,
          },
        ],
      },
      {
        component: "Detail",
        source: "timing",
        title: msg("approval.detail.timing"),
        labelWidth: 12,
        rows: [
          {
            field: "createdAt",
            label: msg("approval.detail.createdAt"),
            formatter: "string",
            tone: "debug",
          },
          {
            field: "expiresAt",
            label: msg("approval.detail.expiresAt"),
            formatter: "string",
            tone: "debug",
          },
          {
            field: "changedAt",
            label: msg("approval.detail.changedAt"),
            formatter: "string",
            tone: "debug",
            omitEmpty: true,
          },
          {
            field: "releasedAt",
            label: msg("approval.detail.releasedAt"),
            formatter: "string",
            tone: "debug",
            omitEmpty: true,
          },
          {
            field: "consumedAt",
            label: msg("approval.detail.consumedAt"),
            formatter: "string",
            tone: "debug",
            omitEmpty: true,
          },
        ],
      },
      {
        component: "Detail",
        source: "claim",
        title: msg("approval.detail.claim"),
        labelWidth: 12,
        omitWhenEmpty: true,
        rows: [
          {
            field: "by",
            label: msg("approval.detail.claimedBy"),
            formatter: "string",
            tone: "argument",
            omitEmpty: true,
          },
          {
            field: "claimedAt",
            label: msg("approval.detail.claimedAt"),
            formatter: "string",
            tone: "debug",
            omitEmpty: true,
          },
          {
            field: "heartbeatAt",
            label: msg("approval.detail.heartbeatAt"),
            formatter: "string",
            tone: "debug",
            omitEmpty: true,
          },
          {
            field: "expiresAt",
            label: msg("approval.detail.claimExpiresAt"),
            formatter: "string",
            tone: "debug",
            omitEmpty: true,
          },
        ],
      },
    ],
  },
  {
    id: "approval.list",
    blocks: [
      {
        component: "Table",
        source: "approvals",
        title: msg("approval.list.title"),
        empty: msg("approval.list.none"),
        header: true,
        columns: [
          {
            field: "id",
            header: msg("approval.list.id"),
            formatter: "string",
            tone: "command",
            width: { kind: "fixed", size: 28, minimum: 1 },
          },
          {
            field: "status",
            header: msg("approval.list.status"),
            formatter: "approval-status",
            paddingTone: "outside",
            width: { kind: "fixed", size: 10, minimum: 1 },
          },
          {
            field: "timing.expiresAt",
            header: msg("approval.list.expiresAt"),
            formatter: "string",
            tone: "debug",
          },
        ],
      },
    ],
  },
  {
    id: "upgrade.check",
    blocks: [
      {
        component: "Detail",
        source: "",
        title: msg("upgradeResult.check.title"),
        labelWidth: 12,
        rows: [
          {
            field: "packageManager",
            label: msg("upgradeResult.packageManager"),
            formatter: "string",
            tone: "argument",
          },
          {
            field: "currentVersion",
            label: msg("upgradeResult.currentVersion"),
            formatter: "string",
            tone: "argument",
          },
          {
            field: "latestVersion",
            label: msg("upgradeResult.latestVersion"),
            formatter: "fallback-dash",
            tone: "argument",
          },
          {
            field: "updateAvailable",
            label: msg("upgradeResult.updateStatus"),
            formatter: "upgrade-status",
            tone: "argument",
          },
        ],
      },
    ],
  },
  {
    id: "upgrade.result",
    blocks: [
      {
        component: "Detail",
        source: "",
        title: msg("upgradeResult.result.title"),
        labelWidth: 12,
        rows: [
          {
            field: "packageManager",
            label: msg("upgradeResult.packageManager"),
            formatter: "string",
            tone: "argument",
          },
          {
            field: "installedVersion",
            label: msg("upgradeResult.version"),
            formatter: "upgrade-version",
            tone: "argument",
          },
        ],
      },
    ],
  },
];
