import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fail } from "../errors/benchpilot-error.js";
import { PathService } from "../paths/path-service.js";
import { atomicJson, readJson } from "../utilities/atomic-json.js";
import { resolveInside } from "../utilities/resolve-inside.js";

export type Json = Record<string, unknown>;
export const RUN_ID_PATTERN = /^\d{8}T\d{6}\.\d{3}Z-[a-zA-Z0-9_-]+-[a-f0-9]+$/;
export interface Run {
  id: string;
  dir: string;
  started: number;
  command: string;
}
export interface ArtifactRecord {
  name: string;
  kind: string;
  path: string;
  size: number;
  sha256: string;
  createdAt: string;
  metadata?: Json;
}

export class RunManager {
  constructor(
    private paths: PathService,
    private projectId: string,
  ) {}
  async create(command: string, context: Json): Promise<Run> {
    const id = `${new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(
        /(\d{8}T\d{6})\.(\d{3})Z/,
        "$1.$2Z",
      )}-${command.replace(/[^a-zA-Z0-9_-]/g, "-")}-${randomBytes(3).toString("hex")}`;
    const dir = resolveInside(this.paths.runsRoot(this.projectId), id);
    await fs.mkdir(path.join(dir, "captures"), { recursive: true });
    await fs.mkdir(path.join(dir, "artifacts"), { recursive: true });
    const started = Date.now();
    await atomicJson(path.join(dir, "manifest.json"), {
      schema: "benchpilot.run",
      version: 1,
      runId: id,
      status: "running",
      command,
      startedAt: new Date(started).toISOString(),
      pid: process.pid,
      hostname: os.hostname(),
      platform: process.platform,
      ...context,
    });
    return { id, dir, started, command };
  }
  async finalize(run: Run, status: string, result: Json) {
    const durationMs = Date.now() - run.started;
    await atomicJson(path.join(run.dir, "result.json"), result);
    const manifest =
      (await readJson<Json>(path.join(run.dir, "manifest.json"))) || {};
    await atomicJson(path.join(run.dir, "manifest.json"), {
      ...manifest,
      status,
      endedAt: new Date().toISOString(),
      durationMs,
      cleanupErrors: result.cleanupErrors || [],
      abortReason:
        result.kind === "OPERATION_TIMEOUT"
          ? "timeout"
          : result.kind === "OPERATION_ABORTED"
            ? "signal"
            : undefined,
    });
  }
  async finish(run: Run, status: string, result: Json) {
    await this.finalize(run, status, result);
  }
  async list() {
    const root = this.paths.runsRoot(this.projectId);
    try {
      return await Promise.all(
        (await fs.readdir(root)).map(async (id) => ({
          id,
          manifest: await readJson<Json>(path.join(root, id, "manifest.json")),
        })),
      );
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async get(id: string) {
    if (!RUN_ID_PATTERN.test(id))
      fail("INVALID_RUN_ID", 2, `Invalid run ID: ${id}`);
    const dir = resolveInside(this.paths.runsRoot(this.projectId), id);
    return {
      dir,
      manifest: await readJson<Json>(path.join(dir, "manifest.json")),
      result: await readJson<Json>(path.join(dir, "result.json")),
    };
  }
}
