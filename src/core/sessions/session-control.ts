import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { BenchPilotError } from "../errors/benchpilot-error.js";
import { PathService } from "../paths/path-service.js";
import type {
  ManagedSessionControlRequest,
  ManagedSessionControlResponse,
} from "./types.js";

const maximumFrameBytes = 16 * 1024;

const socketName = (sessionId: string) =>
  createHash("sha256").update(sessionId).digest("hex").slice(0, 24);

/**
 * A deterministic but unguessable-in-practice endpoint. Access is authenticated
 * separately with a 256-bit control token, so an endpoint path is not a secret.
 */
export const managedSessionControlEndpoint = (
  paths: PathService,
  sessionId: string,
) => {
  const name = socketName(sessionId);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\benchpilot-session-${name}`
    : path.join(paths.managedSessionsRoot(), sessionId, `${name}.sock`);
};

const response = (
  value: Omit<ManagedSessionControlResponse, "schema" | "version">,
): ManagedSessionControlResponse => ({
  schema: "benchpilot.managed-session-control-response",
  version: 1,
  ...value,
});

const protocolError = (message: string) =>
  response({ ok: false, error: { kind: "SESSION_CONTROL_PROTOCOL", message } });

const parseRequest = (
  value: unknown,
): ManagedSessionControlRequest | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const request = value as Partial<ManagedSessionControlRequest>;
  return request.schema === "benchpilot.managed-session-control-request" &&
    request.version === 1 &&
    typeof request.sessionId === "string" &&
    typeof request.controlToken === "string" &&
    (request.type === "stop" ||
      request.type === "acquire-writer" ||
      ((request.type === "write" ||
        request.type === "renew-writer" ||
        request.type === "release-writer") &&
        typeof request.leaseId === "string" &&
        (request.type !== "write" || typeof request.dataBase64 === "string")))
    ? (request as ManagedSessionControlRequest)
    : undefined;
};

export interface ManagedSessionControlServerOptions {
  readonly endpoint: string;
  readonly handle: (
    request: ManagedSessionControlRequest,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

/** One-request JSONL control server used only by the managed-session host. */
export class ManagedSessionControlServer {
  private server: net.Server | undefined;
  private readonly sockets = new Set<net.Socket>();

  constructor(private readonly options: ManagedSessionControlServerOptions) {}

  async listen() {
    if (this.server) return;
    if (process.platform !== "win32")
      await fs
        .unlink(this.options.endpoint)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
    const server = net.createServer((socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
      socket.setEncoding("utf8");
      let frame = "";
      let handled = false;
      const send = (value: ManagedSessionControlResponse) => {
        if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`);
      };
      socket.on("data", (chunk: string) => {
        if (handled) return;
        frame += chunk;
        if (Buffer.byteLength(frame, "utf8") > maximumFrameBytes) {
          handled = true;
          send(
            protocolError("Control request exceeds the maximum frame size."),
          );
          return;
        }
        const boundary = frame.indexOf("\n");
        if (boundary < 0) return;
        handled = true;
        if (frame.slice(boundary + 1).trim()) {
          send(
            protocolError("Control connection accepts exactly one request."),
          );
          return;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(frame.slice(0, boundary));
        } catch {
          send(protocolError("Control request is not valid JSON."));
          return;
        }
        const request = parseRequest(raw);
        if (!request) {
          send(protocolError("Control request has an invalid schema."));
          return;
        }
        void Promise.resolve(this.options.handle(request)).then(
          (result) => send(response({ ok: true, result })),
          (error: unknown) =>
            send(
              response({
                ok: false,
                error: {
                  kind:
                    error instanceof BenchPilotError
                      ? error.kind
                      : "SESSION_CONTROL_FAILED",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Managed session control request failed.",
                },
              }),
            ),
        );
      });
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.options.endpoint);
    });
    this.server = server;
  }

  async close() {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (process.platform !== "win32")
      await fs.unlink(this.options.endpoint).catch(() => {});
  }
}

export async function requestManagedSessionControl(
  endpoint: string,
  request: ManagedSessionControlRequest,
  timeoutMs = 5_000,
): Promise<ManagedSessionControlResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let frame = "";
    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      action();
    };
    const timeout = setTimeout(
      () =>
        settle(() =>
          reject(
            new BenchPilotError(
              "SESSION_CONTROL_UNAVAILABLE",
              4,
              "Managed session control request timed out.",
              true,
            ),
          ),
        ),
      timeoutMs,
    );
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk: string) => {
      frame += chunk;
      if (Buffer.byteLength(frame, "utf8") > maximumFrameBytes)
        return settle(() =>
          reject(
            new BenchPilotError(
              "SESSION_CONTROL_PROTOCOL",
              5,
              "Managed session control response exceeds the maximum frame size.",
            ),
          ),
        );
      const boundary = frame.indexOf("\n");
      if (boundary < 0) return;
      try {
        const parsed = JSON.parse(
          frame.slice(0, boundary),
        ) as ManagedSessionControlResponse;
        if (
          parsed.schema !== "benchpilot.managed-session-control-response" ||
          parsed.version !== 1 ||
          typeof parsed.ok !== "boolean"
        )
          throw new Error("Control response has an invalid schema.");
        settle(() => resolve(parsed));
      } catch (error: unknown) {
        settle(() =>
          reject(
            new BenchPilotError(
              "SESSION_CONTROL_PROTOCOL",
              5,
              error instanceof Error
                ? error.message
                : "Managed session control response is invalid.",
            ),
          ),
        );
      }
    });
    socket.once("error", () =>
      settle(() =>
        reject(
          new BenchPilotError(
            "SESSION_CONTROL_UNAVAILABLE",
            4,
            "Managed session control endpoint is unavailable.",
            true,
          ),
        ),
      ),
    );
  });
}
