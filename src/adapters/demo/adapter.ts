import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  Adapter,
  Capability,
  DeviceRuntime,
  Json,
  OperationContext,
} from "../../core.js";
import {
  atomicJson,
  abortPromise,
  BenchPilotError,
  duration,
  durationSchema,
  objectSchema,
  readJson,
  sha,
} from "../../core.js";

const wait = (ms: number, signal: AbortSignal) => {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
    abortPromise(signal),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};
function settings(ctx: OperationContext) {
  return ((ctx.config.adapters as Json | undefined)?.demo || {}) as Json;
}
function basic(
  id: string,
  summary: string,
  fn: (ctx: OperationContext, input: Json) => Promise<Json>,
  opts: Partial<Capability> = {},
): Capability {
  return {
    id,
    summary,
    defaultTimeoutMs: 10_000,
    lockMode: "exclusive",
    createsRun: true,
    safety: { mode: "normal" },
    inputSchema: objectSchema(),
    outputSchema: objectSchema(),
    execute: (ctx, input) => fn(ctx, input),
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
      physicalId: String(
        config.device_id || config.deviceId || "demo-device-01",
      ),
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
          connected: this.connected(ctx),
          ...(await this.state(ctx)),
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
      basic("build", "Simulate a software build", async (ctx) => {
        const artifact = await this.buildArtifact(ctx);
        return { artifact, simulated: true };
      }),
      basic("flash", "Simulate firmware flashing", async (ctx) => {
        const result = await this.delayed(ctx, "flash", {
          flashed: true,
          simulated: true,
        });
        await this.saveState(ctx, { lastFlashedArtifact: "demo-artifact" });
        return result;
      }),
      basic("deploy", "Simulate build then flash", async (ctx) => {
        const build = await this.buildArtifact(ctx);
        const flashResult = await this.delayed(ctx, "flash", { flashed: true });
        const verification = await this.delayed(ctx, "verify", {
          verified: true,
        });
        const started = await this.delayed(ctx, "start", { running: true });
        const bootHandshake =
          settings(ctx).boot_handshake ?? settings(ctx).bootHandshake ?? true;
        if (!bootHandshake)
          throw new BenchPilotError(
            "DEMO_BOOT_HANDSHAKE_FAILED",
            5,
            "Demo boot handshake is disabled.",
            true,
            "boot-handshake",
          );
        await this.delayed(ctx, "boot-handshake", { bootHandshake: true });
        await this.saveState(ctx, {
          running: true,
          lastStartedAt: new Date().toISOString(),
          lastDeployAt: new Date().toISOString(),
          lastFlashedArtifact: "demo-artifact",
        });
        return {
          artifact: build,
          flashResult,
          verification,
          running: started.running,
          bootHandshake,
          deployed: true,
          simulated: true,
        };
      }),
      basic("reset", "Simulate a safe reset", async (ctx) => {
        const result = await this.delayed(ctx, "reset", {
          reset: true,
          simulated: true,
        });
        const state = await this.state(ctx);
        await this.saveState(ctx, {
          resetCount: Number(state.resetCount || 0) + 1,
        });
        return result;
      }),
      basic("run", "Start the simulated device", async (ctx) => {
        const result = await this.delayed(ctx, "run", {
          running: true,
          simulated: true,
        });
        await this.saveState(ctx, {
          running: true,
          lastStartedAt: new Date().toISOString(),
        });
        return result;
      }),
      basic("stop", "Stop the simulated device", async (ctx) => {
        const result = await this.delayed(ctx, "stop", {
          running: false,
          simulated: true,
        });
        await this.saveState(ctx, { running: false });
        return result;
      }),
      basic(
        "logs",
        "Collect a bounded simulated log stream",
        async (ctx, input) => {
          const ms = duration(input.duration, 5000);
          await wait(Math.min(ms, 100), ctx.signal);
          ctx.logger.info("demo: boot complete");
          ctx.logger.info("demo: heartbeat");
          return { durationMs: ms, lines: 2, simulated: true };
        },
        {
          options: [
            {
              name: "duration",
              summary: "Maximum log collection duration",
              schema: durationSchema(),
            },
          ],
        },
      ),
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
        async (ctx) => {
          const result = await this.delayed(ctx, "factory-reset", {
            reset: true,
            simulated: true,
          });
          await atomicJson(this.stateFile(ctx), {
            running: false,
            resetCount: 0,
            lastStartedAt: null,
            lastFlashedArtifact: null,
            lastDeployAt: null,
          });
          return result;
        },
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
          this.delayed(
            ctx,
            "burn-fuse",
            { burned: true, simulated: true },
            () => ctx.markDangerousEffectStarted(),
          ),
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
  private async delayed(
    ctx: OperationContext,
    stage: string,
    value: Json,
    beforeEffect?: () => void,
  ) {
    if (stage !== "build" && !this.connected(ctx))
      throw new BenchPilotError(
        "DEVICE_NOT_CONNECTED",
        3,
        "Demo device is configured disconnected.",
      );
    const config = settings(ctx);
    if (
      config.operationDelayMs !== undefined ||
      this.config.operationDelayMs !== undefined
    )
      ctx.logger.warn(
        "demo: operationDelayMs is deprecated; use operation_delay_ms",
      );
    const ms = Number(
      config.operation_delay_ms ||
        config.operationDelayMs ||
        this.config.operation_delay_ms ||
        this.config.operationDelayMs ||
        50,
    );
    ctx.logger.event("stage.started", { stage, simulated: true });
    ctx.emitEvent("stage.started", { stage, simulated: true });
    await wait(ms, ctx.signal);
    if (
      settings(ctx).fail_stage === stage ||
      settings(ctx).failStage === stage ||
      settings(ctx).fail_operation === stage
    )
      throw new BenchPilotError(
        `DEMO_${stage.toUpperCase()}_FAILED`,
        5,
        `Demo adapter injected failure at ${stage}.`,
        true,
        stage,
      );
    beforeEffect?.();
    ctx.logger.event("stage.completed", { stage, simulated: true });
    ctx.emitEvent("stage.completed", { stage, simulated: true });
    return value;
  }
  private async buildArtifact(ctx: OperationContext): Promise<Json> {
    await this.delayed(ctx, "build", {});
    if (!ctx.run) return { simulated: true };
    const file = path.join(ctx.run.dir, "artifacts", "demo-firmware.bin");
    const contents = `benchpilot demo firmware\ninstance=${this.identity.instance}\n`;
    await fs.writeFile(file, contents);
    const artifact = {
      name: "demo-firmware.bin",
      kind: "firmware",
      path: file,
      size: Buffer.byteLength(contents),
      sha256: createHash("sha256").update(contents).digest("hex"),
      createdAt: new Date().toISOString(),
    };
    ctx.registerArtifact(artifact);
    return artifact;
  }
  private connected(ctx: OperationContext) {
    return settings(ctx).connected !== false;
  }
  private stateFile(ctx: OperationContext) {
    return path.join(
      ctx.stateRoot,
      "demo",
      `${sha(this.identity).slice(0, 24)}.json`,
    );
  }
  private async state(ctx: OperationContext): Promise<Json> {
    return (
      (await readJson<Json>(this.stateFile(ctx))) || {
        running: false,
        resetCount: 0,
        lastStartedAt: null,
        lastFlashedArtifact: null,
        lastDeployAt: null,
      }
    );
  }
  private async saveState(ctx: OperationContext, patch: Json) {
    await atomicJson(this.stateFile(ctx), {
      ...(await this.state(ctx)),
      ...patch,
    });
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
            deviceId: String(d?.device_id || d?.deviceId || "demo-device-01"),
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
