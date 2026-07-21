import stripAnsi from "strip-ansi";
import type { ManagedSessionIdentity } from "../core/sessions/types.js";
import { BenchPilotError } from "../core/errors/benchpilot-error.js";
import { SerialSessionLauncher } from "./serial-session-launcher.js";

export interface SerialSessionConsoleInput {
  readonly identity: ManagedSessionIdentity;
  readonly sessionId?: string;
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly signal: AbortSignal;
}

const cleanText = (value: string) =>
  stripAnsi(value).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");

/** Human-only TTY attachment. It never owns the serial port or stops a session. */
export async function attachSerialSessionConsole(
  launcher: SerialSessionLauncher,
  input: SerialSessionConsoleInput,
) {
  const session = await launcher.find({
    identity: input.identity,
    sessionId: input.sessionId,
    activeOnly: true,
  });
  if (!session)
    throw new BenchPilotError(
      "MANAGED_SESSION_NOT_FOUND",
      3,
      "No active managed serial session was found for this device.",
    );
  const lease = await launcher.acquireWriterLease(session.id);
  let cursor: string | undefined;
  let writing = Promise.resolve();
  let polling = false;
  let failure: Error | undefined;
  let detached = false;
  let detach!: () => void;
  const detachedPromise = new Promise<void>((resolve) => {
    detach = () => {
      detached = true;
      resolve();
    };
  });
  const print = async () => {
    if (polling || input.signal.aborted) return;
    polling = true;
    try {
      const logs = await launcher.logs({
        identity: input.identity,
        sessionId: session.id,
        tail: 100,
        cursor,
      });
      cursor = logs.cursor ?? cursor;
      for (const record of logs.records) {
        if (record.text !== undefined)
          input.stdout.write(`${cleanText(record.text)}\n`);
        else if (record.base64)
          input.stdout.write(
            `[binary ${Buffer.from(record.base64, "base64").byteLength} bytes]\n`,
          );
      }
    } catch (error: unknown) {
      failure = error instanceof Error ? error : new Error(String(error));
    } finally {
      polling = false;
    }
  };
  const onData = (chunk: Buffer) => {
    if (chunk.includes(3)) {
      detach();
      const remaining = Buffer.from(chunk.filter((byte) => byte !== 3));
      if (!remaining.byteLength) return;
      chunk = remaining;
    }
    writing = writing
      .then(async () => {
        await launcher.writeWithLease({
          sessionId: session.id,
          controlToken: lease.controlToken,
          leaseId: lease.leaseId,
          data: chunk,
        });
      })
      .catch((error: unknown) => {
        failure = error instanceof Error ? error : new Error(String(error));
      });
  };
  input.stdin.on("data", onData);
  input.stdin.resume();
  const pollTimer = setInterval(() => void print(), 100);
  const renewTimer = setInterval(() => {
    void launcher
      .renewWriterLease({
        sessionId: session.id,
        controlToken: lease.controlToken,
        leaseId: lease.leaseId,
      })
      .catch((error: unknown) => {
        failure = error instanceof Error ? error : new Error(String(error));
      });
  }, 10_000);
  try {
    await print();
    await Promise.race([
      detachedPromise,
      new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (input.signal.aborted || failure || detached) {
            clearInterval(timer);
            resolve();
          }
        }, 25);
      }),
    ]);
    await writing;
    if (failure) throw failure;
  } finally {
    clearInterval(pollTimer);
    clearInterval(renewTimer);
    input.stdin.off("data", onData);
    await launcher.releaseWriterLease(lease).catch(() => {});
  }
}
