import assert from "node:assert/strict";
import test from "node:test";
import { detectTerminalCapabilities } from "../dist/cli/terminal/capabilities.js";
import { StreamTerminalSurface } from "../dist/cli/terminal/surface.js";
import {
  displayWidth,
  padDisplay,
  stripTerminalText,
  wrapTerminalText,
} from "../dist/cli/terminal/text.js";

test("terminal text primitives handle ANSI, CJK, and emoji", () => {
  assert.equal(displayWidth("A中文"), 5);
  assert.equal(displayWidth("\u001B[31m错误\u001B[0m"), 4);
  assert.equal(displayWidth("ok ✓"), 4);
  assert.equal(stripTerminalText("\u001B[31mred\u001B[0m"), "red");
  assert.equal(padDisplay("中", 4), "中  ");
  assert.equal(wrapTerminalText("alpha beta", 5), "alpha\nbeta");
});

test("terminal capabilities disable cursor output for non-TTY and dumb terminals", () => {
  assert.deepEqual(
    detectTerminalCapabilities({
      stdin: { isTTY: true },
      stdout: { isTTY: true, columns: 120, rows: 40 },
      stderr: { isTTY: true },
      env: { TERM: "xterm-256color" },
      color: true,
    }),
    {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      columns: 120,
      rows: 40,
      color: true,
      cursor: true,
    },
  );
  assert.equal(
    detectTerminalCapabilities({
      stdout: { isTTY: true },
      env: { TERM: "dumb" },
      color: true,
    }).cursor,
    false,
  );
});

test("terminal surface replaces keyed TTY state and bounds non-TTY updates", () => {
  const ttyWrites = [];
  const tty = new StreamTerminalSurface(
    { write: (value) => ttyWrites.push(value) },
    {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      columns: 80,
      color: false,
      cursor: true,
    },
  );
  tty.update("progress", "one");
  tty.update("progress", "two");
  tty.update("status", "ready");
  tty.append("log entry");
  assert.equal(ttyWrites[0], "one\n");
  assert.match(ttyWrites.join(""), /\u001B\[1A\r\u001B\[2Ktwo\u001B\[1B\r/);
  assert.match(ttyWrites.join(""), /\u001B\[2A\r\u001B\[Jlog entry/);
  tty.close();
  assert.throws(() => tty.update("progress", "closed"), /closed/);

  const fallbackWrites = [];
  const fallback = new StreamTerminalSurface(
    { write: (value) => fallbackWrites.push(value) },
    {
      stdinIsTTY: false,
      stdoutIsTTY: false,
      stderrIsTTY: false,
      columns: 80,
      color: false,
      cursor: false,
    },
    2,
  );
  fallback.update("progress", "one");
  fallback.update("progress", "two");
  fallback.update("progress", "suppressed");
  fallback.update("progress", "final", { final: true });
  assert.deepEqual(fallbackWrites, ["one\n", "two\n", "final\n"]);
});

test("terminal surface patches only changed lines in a stable live region", () => {
  const writes = [];
  const surface = new StreamTerminalSurface(
    { write: (value) => writes.push(value) },
    {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      columns: 80,
      color: false,
      cursor: true,
    },
  );
  surface.update("progress", "building\n  old step\n  unchanged");
  writes.length = 0;
  surface.update("progress", "building\n  new step\n  unchanged");
  assert.deepEqual(writes, ["\u001B[2A\r\u001B[2K  new step\u001B[2B\r"]);
  assert.doesNotMatch(writes.join(""), /\u001B\[J/);
});
