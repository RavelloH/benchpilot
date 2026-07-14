import { Readable } from "node:stream";
import path from "node:path";
import type {
  Adapter,
  Capability,
  DeviceRuntime,
  Json,
  OperationContext,
} from "../../core.js";
import { BenchPilotError, duration } from "../../core.js";

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(
          new BenchPilotError(
            "OPERATION_TIMEOUT",
            6,
            "Operation cancelled or timed out.",
          ),
        );
      },
      { once: true },
    );
  });
function settings(ctx: OperationContext) {
  return ((ctx.config.adapters as Json | undefined)?.demo || {}) as Json;
}
function basic(
  id: string,
  summary: string,
  fn: (ctx: OperationContext) => Promise<Json>,
  opts: Partial<Capability> = {},
): Capability {
  return {
    id,
    summary,
    defaultTimeoutMs: 10_000,
    lockMode: "exclusive",
    createsRun: true,
    safety: { mode: "normal" },
    execute: (ctx) => fn(ctx),
    ...opts,
  };
}
class DemoDevice implements DeviceRuntime {
  readonly identity;
  constructor(
    instance: string,
    private config: Json,
  ) {
    this.identity = {
      instance,
      physicalId: String(config.deviceId || "demo-device-01"),
      adapter: "demo",
    };
  }
  capabilities(): Capability[] {
    return [
      basic(
        "info",
        "Show simulated device identity",
        async () => ({
          simulated: true,
          identity: this.identity,
          model: "BenchPilot Demo Device",
        }),
        { lockMode: "none", createsRun: false },
      ),
      basic(
        "status",
        "Show simulated runtime state",
        async (ctx) => ({
          connected: settings(ctx).connected !== false,
          running: false,
          uptimeMs: 0,
          simulated: true,
        }),
        { lockMode: "none", createsRun: false },
      ),
      basic(
        "capabilities",
        "List available simulated capabilities",
        async () => ({
          capabilities: this.capabilities().map((c) => ({
            id: c.id,
            summary: c.summary,
            safety: c.safety,
          })),
        }),
        { lockMode: "none", createsRun: false },
      ),
      basic("build", "Simulate a software build", async (ctx) =>
        this.delayed(ctx, "build", {
          artifact: "demo-firmware.bin",
          simulated: true,
        }),
      ),
      basic("flash", "Simulate firmware flashing", async (ctx) =>
        this.delayed(ctx, "flash", { flashed: true, simulated: true }),
      ),
      basic("deploy", "Simulate build then flash", async (ctx) => {
        await this.delayed(ctx, "build", {});
        return this.delayed(ctx, "flash", { deployed: true, simulated: true });
      }),
      basic("reset", "Simulate a safe reset", async (ctx) =>
        this.delayed(ctx, "reset", { reset: true, simulated: true }),
      ),
      basic("run", "Start the simulated device", async (ctx) =>
        this.delayed(ctx, "run", { running: true, simulated: true }),
      ),
      basic("stop", "Stop the simulated device", async (ctx) =>
        this.delayed(ctx, "stop", { running: false, simulated: true }),
      ),
      basic("logs", "Collect a bounded simulated log stream", async (ctx) => {
        const ms = duration(
          (ctx as unknown as { input?: Json }).input?.duration,
          5000,
        );
        await wait(Math.min(ms, 100), ctx.signal);
        ctx.logger.info("demo: boot complete");
        ctx.logger.info("demo: heartbeat");
        return { durationMs: ms, lines: 2, simulated: true };
      }),
      basic("capture", "Capture a simulated device stream", async (ctx) => {
        if (!ctx.run) return { simulated: true };
        const file = path.join(ctx.run.dir, "captures", "demo.log");
        const stream = Readable.from([
          "demo boot handshake\n",
          "demo telemetry=42\n",
        ]);
        const capture = ctx.logger.capture.stream(stream, {
          file,
          computeSha256: true,
          displayLevel: "none",
          signal: ctx.signal,
        });
        const result = await capture.done;
        return {
          file,
          bytes: result.bytes,
          lines: result.lines,
          sha256: result.sha256,
          simulated: true,
        };
      }),
      basic("selftest", "Run structured simulated checks", async (ctx) =>
        this.delayed(ctx, "selftest", {
          checks: [
            "connection",
            "storage",
            "boot-handshake",
            "safe-default",
          ].map((id) => ({ id, status: "pass" })),
          simulated: true,
        }),
      ),
      basic(
        "factory-reset",
        "Reset all simulated state",
        async (ctx) =>
          this.delayed(ctx, "factory-reset", { reset: true, simulated: true }),
        {
          safety: {
            mode: "danger-flag",
            flag: "dangerously-reset-demo-state",
            effects: ["Resets simulated demo state"],
          },
        },
      ),
      basic(
        "burn-fuse",
        "Simulate an irreversible fuse burn",
        async (ctx) =>
          this.delayed(ctx, "burn-fuse", { burned: true, simulated: true }),
        {
          safety: {
            mode: "human-approval",
            flag: "dangerously-burn-demo-fuse",
            effects: ["Simulates an irreversible fuse burn"],
            approvalTtlMs: 3600000,
          },
        },
      ),
    ];
  }
  private async delayed(ctx: OperationContext, stage: string, value: Json) {
    const ms = Number(
      settings(ctx).operationDelayMs || this.config.operationDelayMs || 50,
    );
    ctx.logger.event("stage.started", { stage, simulated: true });
    await wait(ms, ctx.signal);
    if (settings(ctx).failStage === stage)
      throw new BenchPilotError(
        `DEMO_${stage.toUpperCase()}_FAILED`,
        5,
        `Demo adapter injected failure at ${stage}.`,
        true,
        stage,
      );
    ctx.logger.event("stage.completed", { stage, simulated: true });
    return value;
  }
}
export const demoAdapter: Adapter = {
  id: "demo",
  version: "0.0.0",
  summary: "Explicitly simulated software-only adapter",
  async discover(config) {
    const d = (config.adapters as Json | undefined)?.demo as Json | undefined;
    return d?.connected === false
      ? []
      : [
          {
            adapter: "demo",
            deviceId: String(d?.deviceId || "demo-device-01"),
            simulated: true,
          },
        ];
  },
  async doctor(config) {
    const d = (config.adapters as Json | undefined)?.demo as Json | undefined;
    return [
      {
        id: "demo-connected",
        status: d?.connected === false ? "warn" : "pass",
        message:
          d?.connected === false
            ? "Demo adapter configured disconnected."
            : "Demo adapter ready (simulated).",
      },
    ];
  },
  async createDevice(instance, config) {
    return new DemoDevice(instance, config);
  },
};
