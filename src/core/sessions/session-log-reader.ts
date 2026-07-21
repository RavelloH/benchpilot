import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { BenchPilotError } from "../errors/benchpilot-error.js";
import { PathService } from "../paths/path-service.js";
import type { ManagedSessionRecord } from "./types.js";
import type { ManagedSessionLogRecord } from "./session-log-spool.js";

export interface ManagedSessionLogQuery {
  readonly tail?: number;
  readonly cursor?: string;
}

export interface ManagedSessionLogReadResult {
  readonly records: readonly ManagedSessionLogRecord[];
  readonly cursor?: string;
}

const cursorPattern = /^1:(\d+)$/;

const cursorSequence = (cursor: string | undefined) => {
  if (!cursor) return 0;
  const match = cursorPattern.exec(cursor);
  if (!match)
    throw new BenchPilotError(
      "MANAGED_SESSION_LOG_CURSOR_INVALID",
      2,
      "Managed session log cursor is invalid.",
    );
  return Number(match[1]);
};

const validRecord = (value: unknown): value is ManagedSessionLogRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ManagedSessionLogRecord>;
  return (
    record.generation === 1 &&
    typeof record.sequence === "number" &&
    Number.isSafeInteger(record.sequence) &&
    record.sequence > 0 &&
    typeof record.timestamp === "string" &&
    record.stream === "serial" &&
    (typeof record.text === "string" || typeof record.base64 === "string") &&
    ["complete", "replacement", "binary"].includes(String(record.encodingState))
  );
};

export const managedSessionRecordsPath = (
  paths: PathService,
  session: ManagedSessionRecord,
) => {
  if (!session.runId)
    throw new BenchPilotError(
      "MANAGED_SESSION_RUN_UNAVAILABLE",
      4,
      "Managed session does not have a Run yet.",
      true,
    );
  return path.join(
    paths.runsRoot(session.projectRoot),
    session.runId,
    "captures",
    "session-records.ndjson",
  );
};

/** Reads bounded records only; it never opens the physical serial transport. */
export async function readManagedSessionLog(
  paths: PathService,
  session: ManagedSessionRecord,
  query: ManagedSessionLogQuery = {},
): Promise<ManagedSessionLogReadResult> {
  const tail = query.tail ?? 100;
  if (!Number.isSafeInteger(tail) || tail < 0 || tail > 10_000)
    throw new BenchPilotError(
      "MANAGED_SESSION_LOG_TAIL_INVALID",
      2,
      "Managed session log tail must be between 0 and 10000.",
    );
  const after = cursorSequence(query.cursor);
  const file = managedSessionRecordsPath(paths, session);
  try {
    await access(file);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { records: [] };
    throw error;
  }
  const records: ManagedSessionLogRecord[] = [];
  const lines = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new BenchPilotError(
        "MANAGED_SESSION_LOG_CORRUPT",
        5,
        "Managed session log record is invalid JSON.",
      );
    }
    if (!validRecord(parsed))
      throw new BenchPilotError(
        "MANAGED_SESSION_LOG_CORRUPT",
        5,
        "Managed session log record has an invalid schema.",
      );
    if (parsed.sequence <= after) continue;
    records.push(parsed);
    if (records.length > tail) records.shift();
  }
  const latest = records.at(-1);
  return {
    records,
    ...(latest ? { cursor: `1:${latest.sequence}` } : {}),
  };
}
