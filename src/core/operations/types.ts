import RlogModule from "rlog-js";
import type { DeviceRuntime } from "../capabilities/types.js";
import type { Json, ResolvedConfig } from "../config/config.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type {
  ArtifactRegistration,
  ArtifactRecord,
} from "../artifacts/types.js";
import type { BenchPilotEventWriter } from "../events/types.js";
import type { PathService } from "../paths/path-service.js";
import type { Run } from "../runs/run-manager.js";

const Rlog = RlogModule.default;

export interface OperationContext {
  signal: AbortSignal;
  logger: InstanceType<typeof Rlog>;
  run?: Run;
  stateRoot: string;
  config: Json;
  device: DeviceRuntime;
  registerCleanup(
    name: string,
    handler: () => Promise<void> | void,
    options?: { critical?: boolean },
  ): void;
  readonly dangerousEffect: {
    readonly started: boolean;
    readonly startedAt?: string;
    readonly details?: Json;
  };
  markDangerousEffectStarted(details?: Json): void;
  emitEvent(type: string, data?: Json): void;
  registerArtifact(record: ArtifactRegistration): Promise<ArtifactRecord>;
}

export interface OperationServices {
  paths: PathService;
  registry: AdapterRegistry;
  config: ResolvedConfig;
  project: { root: string; config: string } | undefined;
  flags: Json;
  lockHeartbeatIntervalMs?: number;
  lockLeaseMs?: number;
  eventWriter?: BenchPilotEventWriter;
}
