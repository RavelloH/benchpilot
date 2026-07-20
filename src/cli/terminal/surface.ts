import type { TerminalCapabilities } from "./capabilities.js";
import { displayWidth, stripTerminalText } from "./text.js";

export interface TerminalWritable {
  write(value: string): unknown;
}

export interface TerminalUpdateOptions {
  readonly final?: boolean;
}

export interface TerminalSurface {
  write(value: string): void;
  append(value: string): void;
  update(key: string, value: string, options?: TerminalUpdateOptions): void;
  remove(key: string): void;
  close(): void;
}

const normalized = (value: string) => value.replace(/\n+$/g, "");

const renderedLines = (value: string, columns: number) =>
  normalized(stripTerminalText(value))
    .split("\n")
    .reduce(
      (total, line) =>
        total + Math.max(1, Math.ceil(displayWidth(line) / columns)),
      0,
    );

/** Injected terminal sink with keyed TTY replacement and bounded fallback. */
export class StreamTerminalSurface implements TerminalSurface {
  private readonly live = new Map<string, string>();
  private readonly fallbackWrites = new Map<string, number>();
  private liveLines = 0;
  private closed = false;

  constructor(
    private readonly output: TerminalWritable,
    private readonly capabilities: TerminalCapabilities,
    private readonly fallbackLimit = 5,
  ) {}

  write(value: string) {
    this.assertOpen();
    if (!this.capabilities.cursor || !this.live.size) {
      this.output.write(value);
      return;
    }
    this.eraseLiveRegion();
    this.output.write(value);
    this.drawLiveRegion();
  }

  append(value: string) {
    this.write(value.endsWith("\n") ? value : `${value}\n`);
  }

  update(key: string, value: string, options: TerminalUpdateOptions = {}) {
    this.assertOpen();
    const next = normalized(value);
    if (this.capabilities.cursor) {
      const previous = [...this.live.values()].join("\n");
      if (this.live.get(key) === next) return;
      this.live.set(key, next);
      const replacement = [...this.live.values()].join("\n");
      if (this.patchLiveRegion(previous, replacement)) return;
      this.eraseLiveRegion();
      this.drawLiveRegion();
      return;
    }
    const count = this.fallbackWrites.get(key) ?? 0;
    if (!options.final && count >= this.fallbackLimit) return;
    this.fallbackWrites.set(key, count + 1);
    this.output.write(`${next}\n`);
  }

  remove(key: string) {
    this.assertOpen();
    if (!this.capabilities.cursor) return;
    this.eraseLiveRegion();
    this.live.delete(key);
    this.drawLiveRegion();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.live.clear();
    this.liveLines = 0;
  }

  private eraseLiveRegion() {
    if (!this.liveLines) return;
    this.output.write(`\u001B[${this.liveLines}A\r\u001B[J`);
    this.liveLines = 0;
  }

  private drawLiveRegion() {
    if (!this.live.size) return;
    const content = [...this.live.values()].join("\n");
    this.output.write(`${content}\n`);
    this.liveLines = renderedLines(content, this.capabilities.columns);
  }

  /** Updates unchanged-height, unwrapped live regions without clearing them. */
  private patchLiveRegion(previous: string, replacement: string) {
    if (!this.liveLines || previous === replacement)
      return previous === replacement;
    const before = previous.split("\n");
    const after = replacement.split("\n");
    if (
      before.length !== after.length ||
      before.length !== this.liveLines ||
      [...before, ...after].some(
        (line) =>
          displayWidth(stripTerminalText(line)) > this.capabilities.columns,
      )
    )
      return false;
    for (let index = 0; index < after.length; index += 1) {
      if (before[index] === after[index]) continue;
      const offset = this.liveLines - index;
      this.output.write(
        `\u001B[${offset}A\r\u001B[2K${after[index]}\u001B[${offset}B\r`,
      );
    }
    return true;
  }

  private assertOpen() {
    if (this.closed) throw new Error("Terminal surface is closed.");
  }
}
