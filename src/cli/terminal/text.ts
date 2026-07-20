import stringWidth from "string-width";
import stripAnsi from "strip-ansi";
import wrapAnsi from "wrap-ansi";

export const stripTerminalText = (value: string) => stripAnsi(value);

export const displayWidth = (value: string) =>
  stringWidth(stripTerminalText(value));

export const padDisplay = (value: string, targetWidth: number, minimum = 1) =>
  `${value}${" ".repeat(Math.max(minimum, targetWidth - displayWidth(value)))}`;

export const wrapTerminalText = (value: string, columns: number) =>
  wrapAnsi(value, Math.max(1, columns), {
    hard: true,
    trim: true,
    wordWrap: true,
  });
