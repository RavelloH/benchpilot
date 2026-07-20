import type { Json } from "../../core.js";
import type { CliDataPage } from "./page.js";

type JsonRecord = Record<string, unknown>;

export interface RunSummaryData {
  readonly id: string;
  readonly status?: string;
  readonly command?: string;
  readonly timing: {
    readonly startedAt?: string;
    readonly endedAt?: string;
    readonly durationMs?: number;
  };
}

export interface RunListData {
  readonly schema: "benchpilot.run-list";
  readonly version: 1;
  readonly runs: readonly RunSummaryData[];
}

export interface RunDetailData {
  readonly schema: "benchpilot.run-detail";
  readonly version: 1;
  readonly run: RunSummaryData & {
    readonly environment: {
      readonly hostname?: string;
      readonly pid?: number;
      readonly platform?: string;
    };
  };
  readonly result?: Json;
}

export interface RunLogData {
  readonly schema: "benchpilot.run-log";
  readonly version: 1;
  readonly runId: string;
  readonly log: string;
}

export interface RunArtifactsData {
  readonly schema: "benchpilot.run-artifacts";
  readonly version: 1;
  readonly runId: string;
  readonly artifacts: readonly string[];
}

export interface RunPruneData {
  readonly schema: "benchpilot.run-prune";
  readonly version: 1;
  readonly removed: readonly string[];
}

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const optionalString = (value: unknown) =>
  typeof value === "string" ? value : undefined;

const optionalNumber = (value: unknown) =>
  typeof value === "number" ? value : undefined;

const summary = (id: string, manifest: JsonRecord): RunSummaryData => ({
  id,
  ...(optionalString(manifest.status)
    ? { status: String(manifest.status) }
    : {}),
  ...(optionalString(manifest.command)
    ? { command: String(manifest.command) }
    : {}),
  timing: {
    ...(optionalString(manifest.startedAt)
      ? { startedAt: String(manifest.startedAt) }
      : {}),
    ...(optionalString(manifest.endedAt)
      ? { endedAt: String(manifest.endedAt) }
      : {}),
    ...(optionalNumber(manifest.durationMs)
      ? { durationMs: Number(manifest.durationMs) }
      : {}),
  },
});

export const runListDataPage = (input: {
  readonly runs: readonly { id: string; manifest?: Json }[];
}): CliDataPage<RunListData> => {
  const data: RunListData = {
    schema: "benchpilot.run-list",
    version: 1,
    runs: input.runs.map((run) => summary(run.id, asRecord(run.manifest))),
  };
  return {
    data,
    jsonl: data.runs.map((run) => ({
      key: `runs.${run.id}`,
      value: run,
    })),
  };
};

export const runDetailDataPage = (input: {
  readonly manifest?: Json;
  readonly result?: Json;
}): CliDataPage<RunDetailData> => {
  const manifest = asRecord(input.manifest);
  const run = summary(String(manifest.runId || ""), manifest);
  const data: RunDetailData = {
    schema: "benchpilot.run-detail",
    version: 1,
    run: {
      ...run,
      environment: {
        ...(optionalString(manifest.hostname)
          ? { hostname: String(manifest.hostname) }
          : {}),
        ...(optionalNumber(manifest.pid) ? { pid: Number(manifest.pid) } : {}),
        ...(optionalString(manifest.platform)
          ? { platform: String(manifest.platform) }
          : {}),
      },
    },
    ...(input.result === undefined ? {} : { result: input.result }),
  };
  return {
    data,
  };
};

export const runPruneDataPage = (input: {
  readonly removed: readonly string[];
}): CliDataPage<RunPruneData> => {
  const data: RunPruneData = {
    schema: "benchpilot.run-prune",
    version: 1,
    removed: input.removed,
  };
  return {
    data,
    jsonl: data.removed.map((runId) => ({
      key: `removed.${runId}`,
      value: { runId },
    })),
  };
};

export const runLogDataPage = (input: {
  readonly runId: string;
  readonly log: string;
}): CliDataPage<RunLogData> => ({
  data: { schema: "benchpilot.run-log", version: 1, ...input },
});

export const runArtifactsDataPage = (input: {
  readonly runId: string;
  readonly artifacts: readonly string[];
}): CliDataPage<RunArtifactsData> => {
  const data: RunArtifactsData = {
    schema: "benchpilot.run-artifacts",
    version: 1,
    ...input,
  };
  return {
    data,
    jsonl: data.artifacts.map((artifact) => ({
      key: `artifacts.${artifact}`,
      value: { name: artifact },
    })),
  };
};
