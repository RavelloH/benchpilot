import { promises as fs } from "node:fs";
import path from "node:path";
import { BenchPilotError } from "../errors/benchpilot-error.js";
import type { Run } from "../runs/run-manager.js";

export interface ManagedSessionLogRecord {
  readonly generation: 1;
  readonly sequence: number;
  readonly timestamp: string;
  readonly stream: "serial";
  readonly text?: string;
  readonly base64?: string;
  readonly encodingState: "complete" | "replacement" | "binary";
}

export interface ManagedSessionLogSpoolOptions {
  readonly run: Run;
  readonly encoding: "utf8" | "binary";
  readonly lineFraming: "line" | "raw";
  readonly logRecordLimit: number;
  readonly spoolLimitBytes: number;
  readonly rawCaptureLimitBytes: number;
  readonly onRecord?: (record: ManagedSessionLogRecord) => void;
}

export class ManagedSessionLogSpool {
  private records: fs.FileHandle | undefined;
  private raw: fs.FileHandle | undefined;
  private sequence = 0;
  private spoolBytes = 0;
  private rawBytes = 0;
  private pending = "";
  private readonly decoder = new TextDecoder("utf-8", { fatal: false });
  private chain = Promise.resolve();
  private failureReason: Error | undefined;
  private rejectFailure!: (error: Error) => void;
  readonly failed = new Promise<never>((_resolve, reject) => {
    this.rejectFailure = reject;
  });

  constructor(private readonly options: ManagedSessionLogSpoolOptions) {
    void this.failed.catch(() => {});
  }

  get recordsPath() {
    return path.join(
      this.options.run.dir,
      "captures",
      "session-records.ndjson",
    );
  }

  get rawPath() {
    return path.join(this.options.run.dir, "captures", "serial.raw");
  }

  async open() {
    await fs.mkdir(path.dirname(this.recordsPath), { recursive: true });
    this.records = await fs.open(this.recordsPath, "a");
    this.raw = await fs.open(this.rawPath, "a");
  }

  append(chunk: Uint8Array) {
    this.chain = this.chain.then(async () => {
      if (this.failureReason) throw this.failureReason;
      try {
        await this.appendChunk(chunk);
      } catch (error: unknown) {
        const failure =
          error instanceof Error
            ? error
            : new BenchPilotError(
                "MANAGED_SESSION_LOG_WRITE_FAILED",
                5,
                "Managed session log spool write failed.",
              );
        this.failureReason = failure;
        this.rejectFailure(failure);
        throw failure;
      }
    });
    return this.chain;
  }

  async close() {
    let failure: unknown;
    try {
      await this.chain;
      if (
        this.options.encoding === "utf8" &&
        this.options.lineFraming === "line"
      ) {
        const tail = this.decoder.decode();
        this.pending += tail;
        if (this.pending) {
          await this.writeRecord({
            text: this.pending,
            encodingState: tail.includes("\uFFFD") ? "replacement" : "complete",
          });
          this.pending = "";
        }
      }
    } catch (error: unknown) {
      failure = error;
    } finally {
      await this.records?.close();
      await this.raw?.close();
      this.records = undefined;
      this.raw = undefined;
    }
    if (failure) throw failure;
  }

  private async appendChunk(chunk: Uint8Array) {
    if (!this.records || !this.raw)
      throw new BenchPilotError(
        "MANAGED_SESSION_LOG_NOT_OPEN",
        5,
        "Managed session log spool is not open.",
      );
    this.rawBytes += chunk.byteLength;
    if (this.rawBytes > this.options.rawCaptureLimitBytes)
      throw new BenchPilotError(
        "MANAGED_SESSION_RAW_CAPTURE_LIMIT",
        5,
        "Managed session raw capture limit was exceeded.",
      );
    await this.raw.write(Buffer.from(chunk));
    if (this.options.lineFraming === "raw") {
      if (this.options.encoding === "binary")
        await this.writeRecord({
          base64: Buffer.from(chunk).toString("base64"),
          encodingState: "binary",
        });
      else {
        const text = this.decoder.decode(chunk, { stream: true });
        await this.writeRecord({
          text,
          encodingState: text.includes("\uFFFD") ? "replacement" : "complete",
        });
      }
      return;
    }
    if (this.options.encoding === "binary") {
      await this.writeRecord({
        base64: Buffer.from(chunk).toString("base64"),
        encodingState: "binary",
      });
      return;
    }
    const decoded = this.decoder.decode(chunk, { stream: true });
    this.pending += decoded;
    let boundary = this.pending.indexOf("\n");
    while (boundary >= 0) {
      const text = this.pending.slice(0, boundary).replace(/\r$/, "");
      this.pending = this.pending.slice(boundary + 1);
      await this.writeRecord({
        text,
        encodingState: text.includes("\uFFFD") ? "replacement" : "complete",
      });
      boundary = this.pending.indexOf("\n");
    }
  }

  private async writeRecord(
    value: Pick<ManagedSessionLogRecord, "text" | "base64" | "encodingState">,
  ) {
    if (!this.records)
      throw new BenchPilotError(
        "MANAGED_SESSION_LOG_NOT_OPEN",
        5,
        "Managed session log spool is not open.",
      );
    if (this.sequence >= this.options.logRecordLimit)
      throw new BenchPilotError(
        "MANAGED_SESSION_LOG_RECORD_LIMIT",
        5,
        "Managed session log record limit was exceeded.",
      );
    const record: ManagedSessionLogRecord = {
      generation: 1,
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      stream: "serial",
      ...value,
    };
    const line = `${JSON.stringify(record)}\n`;
    this.spoolBytes += Buffer.byteLength(line, "utf8");
    if (this.spoolBytes > this.options.spoolLimitBytes)
      throw new BenchPilotError(
        "MANAGED_SESSION_LOG_SPOOL_LIMIT",
        5,
        "Managed session log spool limit was exceeded.",
      );
    await this.records.write(line);
    this.options.onRecord?.(record);
  }
}
