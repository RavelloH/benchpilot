import { BenchPilotError } from "../errors/benchpilot-error.js";

export type OperationSessionState =
  "created" | "prepared" | "running" | "cleaning" | "finalized";

const permitted: Record<
  OperationSessionState,
  readonly OperationSessionState[]
> = {
  created: ["prepared"],
  prepared: ["running", "cleaning"],
  running: ["cleaning"],
  cleaning: ["finalized"],
  finalized: [],
};

/** Core-owned, monotonic lifecycle guard for one capability invocation. */
export class OperationSession {
  private current: OperationSessionState = "created";

  constructor(readonly command: string) {}

  get state(): OperationSessionState {
    return this.current;
  }

  transition(next: OperationSessionState) {
    if (!permitted[this.current].includes(next))
      throw new BenchPilotError(
        "OPERATION_SESSION_STATE_INVALID",
        8,
        `Cannot transition operation ${this.command} from ${this.current} to ${next}.`,
      );
    this.current = next;
  }
}
