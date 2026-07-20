import type { CommandResultV3 } from "./command-result.js";
import type { OutputFrame } from "./cli-event.js";
import type { JsonObject, JsonValue } from "./json.js";

export interface OutputProgressState {
  readonly current: number;
  readonly total?: number;
  readonly status?: string;
  readonly data?: JsonObject;
}

export interface OutputState {
  readonly started: boolean;
  readonly snapshots: Readonly<Record<string, JsonValue>>;
  readonly appended: Readonly<Record<string, readonly JsonValue[]>>;
  readonly progress: Readonly<Record<string, OutputProgressState>>;
  readonly notices: readonly Extract<OutputFrame, { type: "notice" }>[];
  readonly lifecycle: readonly Extract<
    OutputFrame,
    { type: `operation.${string}` }
  >[];
  readonly terminal?: CommandResultV3;
}

export class OutputFrameSequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputFrameSequenceError";
  }
}

export const initialOutputState = (): OutputState => ({
  started: false,
  snapshots: {},
  appended: {},
  progress: {},
  notices: [],
  lifecycle: [],
});

export function reduceOutputFrame(
  state: OutputState,
  frame: OutputFrame,
): OutputState {
  if (state.terminal)
    throw new OutputFrameSequenceError("No frame may follow a terminal frame.");
  if (!state.started && frame.type !== "command.started")
    throw new OutputFrameSequenceError(
      "The first output frame must be command.started.",
    );
  if (frame.type === "command.started") {
    if (state.started)
      throw new OutputFrameSequenceError(
        "command.started may only be emitted once.",
      );
    return { ...state, started: true };
  }
  if (frame.type === "snapshot" || frame.type === "update")
    return {
      ...state,
      snapshots: { ...state.snapshots, [frame.key]: frame.value },
    };
  if (frame.type === "append")
    return {
      ...state,
      appended: {
        ...state.appended,
        [frame.key]: [...(state.appended[frame.key] ?? []), frame.value],
      },
    };
  if (frame.type === "progress")
    return {
      ...state,
      progress: {
        ...state.progress,
        [frame.key]: {
          current: frame.current,
          ...(frame.total === undefined ? {} : { total: frame.total }),
          ...(frame.status === undefined ? {} : { status: frame.status }),
          ...(frame.data === undefined ? {} : { data: frame.data }),
        },
      },
    };
  if (frame.type === "notice")
    return { ...state, notices: [...state.notices, frame] };
  if (frame.type === "command.completed" || frame.type === "command.failed") {
    const completed = frame.type === "command.completed";
    if (completed !== frame.result.ok)
      throw new OutputFrameSequenceError(
        `${frame.type} does not match result.ok=${String(frame.result.ok)}.`,
      );
    return { ...state, terminal: frame.result };
  }
  return {
    ...state,
    lifecycle: [
      ...state.lifecycle,
      frame as Extract<OutputFrame, { type: `operation.${string}` }>,
    ],
  };
}

export function reduceOutputFrames(
  frames: readonly OutputFrame[],
): OutputState {
  const state = frames.reduce(reduceOutputFrame, initialOutputState());
  if (!state.terminal)
    throw new OutputFrameSequenceError(
      "An output frame sequence must end with a terminal frame.",
    );
  return state;
}
