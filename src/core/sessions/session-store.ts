import { promises as fs } from "node:fs";
import path from "node:path";
import { BenchPilotError } from "../errors/benchpilot-error.js";
import { PathService } from "../paths/path-service.js";
import { atomicJson, readJson } from "../utilities/atomic-json.js";
import { resolveInside } from "../utilities/resolve-inside.js";
import {
  MANAGED_SESSION_ID_PATTERN,
  type ManagedSessionControlRecord,
  type ManagedSessionRecord,
} from "./types.js";

const publicFileName = "session.json";
const controlFileName = "control.json";

/** Persists the public index and its token-bearing private counterpart. */
export class ManagedSessionStore {
  constructor(private readonly paths: PathService) {}

  root() {
    return this.paths.managedSessionsRoot();
  }

  directory(sessionId: string) {
    this.assertId(sessionId);
    return resolveInside(this.root(), sessionId);
  }

  publicFile(sessionId: string) {
    return path.join(this.directory(sessionId), publicFileName);
  }

  controlFile(sessionId: string) {
    return path.join(this.directory(sessionId), controlFileName);
  }

  guardFile(sessionId: string) {
    return path.join(this.directory(sessionId), "update.guard");
  }

  async create(
    record: ManagedSessionRecord,
    control: ManagedSessionControlRecord,
  ) {
    const directory = this.directory(record.id);
    await fs.mkdir(this.root(), { recursive: true, mode: 0o700 });
    await fs.mkdir(directory, { mode: 0o700 });
    try {
      await atomicJson(this.publicFile(record.id), record);
      await atomicJson(this.controlFile(record.id), control);
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async read(sessionId: string): Promise<ManagedSessionRecord | undefined> {
    const record = await readJson<ManagedSessionRecord>(
      this.publicFile(sessionId),
    );
    if (record === undefined) return undefined;
    if (!this.isRecord(record))
      throw new BenchPilotError(
        "MANAGED_SESSION_CORRUPT",
        5,
        `Managed session record is invalid: ${sessionId}.`,
      );
    return record;
  }

  async readControl(
    sessionId: string,
  ): Promise<ManagedSessionControlRecord | undefined> {
    const control = await readJson<ManagedSessionControlRecord>(
      this.controlFile(sessionId),
    );
    if (control === undefined) return undefined;
    if (
      control.schema !== "benchpilot.managed-session-control" ||
      control.version !== 1 ||
      control.sessionId !== sessionId ||
      !control.controlToken ||
      !control.handshakeToken
    )
      throw new BenchPilotError(
        "MANAGED_SESSION_CORRUPT",
        5,
        `Managed session control record is invalid: ${sessionId}.`,
      );
    return control;
  }

  async write(record: ManagedSessionRecord) {
    await atomicJson(this.publicFile(record.id), record);
  }

  async list(): Promise<ManagedSessionRecord[]> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(this.root(), { withFileTypes: true });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() && MANAGED_SESSION_ID_PATTERN.test(entry.name),
        )
        .map((entry) => this.read(entry.name)),
    );
    return records
      .filter((record): record is ManagedSessionRecord => Boolean(record))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private assertId(sessionId: string) {
    if (!MANAGED_SESSION_ID_PATTERN.test(sessionId))
      throw new BenchPilotError(
        "INVALID_MANAGED_SESSION_ID",
        2,
        `Invalid managed session ID: ${sessionId}.`,
      );
  }

  private isRecord(value: ManagedSessionRecord) {
    return (
      value.schema === "benchpilot.managed-session" &&
      value.version === 1 &&
      MANAGED_SESSION_ID_PATTERN.test(value.id) &&
      typeof value.revision === "number" &&
      typeof value.createdAt === "string" &&
      typeof value.updatedAt === "string" &&
      typeof value.projectRoot === "string" &&
      typeof value.capabilityId === "string" &&
      typeof value.identity?.adapter === "string" &&
      typeof value.identity.instance === "string" &&
      typeof value.identity.physicalId === "string"
    );
  }
}
