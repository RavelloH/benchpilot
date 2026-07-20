import assert from "node:assert/strict";
import test from "node:test";
import {
  CommandDispatcher,
  CommandDispatchError,
} from "../dist/application/commands/dispatcher.js";

const intent = {
  commandId: "fixture",
  handlerId: "fixture.execute",
  path: ["fixture"],
  input: {},
  options: {},
  globals: {},
};

test("dispatcher invokes a stable handler id and returns a neutral outcome", async () => {
  const dispatcher = new CommandDispatcher({
    "fixture.execute": async (received) => ({
      commandId: received.commandId,
      kind: "fixture.completed",
      data: { value: "ok" },
    }),
  });
  assert.deepEqual(await dispatcher.dispatch(intent), {
    commandId: "fixture",
    kind: "fixture.completed",
    data: { value: "ok" },
  });
});

test("dispatcher rejects branches, unknown handlers, and duplicate registration", async () => {
  const dispatcher = new CommandDispatcher();
  await assert.rejects(
    dispatcher.dispatch({ ...intent, handlerId: undefined }),
    (error) =>
      error instanceof CommandDispatchError &&
      error.code === "COMMAND_NOT_EXECUTABLE",
  );
  await assert.rejects(
    dispatcher.dispatch(intent),
    (error) =>
      error instanceof CommandDispatchError &&
      error.code === "HANDLER_NOT_REGISTERED",
  );
  dispatcher.register("fixture.execute", async () => ({
    commandId: "fixture",
    kind: "fixture.completed",
    data: {},
  }));
  assert.throws(
    () => dispatcher.register("fixture.execute", async () => undefined),
    (error) =>
      error instanceof CommandDispatchError &&
      error.code === "HANDLER_ALREADY_REGISTERED",
  );
});
