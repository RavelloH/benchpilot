export interface TerminalTheme {
  brand(value: string): string;
  heading(value: string): string;
  executable(value: string): string;
  command(value: string): string;
  argument(value: string): string;
  optional(value: string): string;
  flag(value: string): string;
  success(value: string): string;
  warning(value: string): string;
  error(value: string): string;
  debug(value: string): string;
  muted(value: string): string;
}

const reset = "\u001B[0m";
const paint = (code: string, value: string) =>
  `\u001B[${code}m${value}${reset}`;

const plainTheme: TerminalTheme = {
  brand: (value) => value,
  heading: (value) => value,
  executable: (value) => value,
  command: (value) => value,
  argument: (value) => value,
  optional: (value) => value,
  flag: (value) => value,
  success: (value) => value,
  warning: (value) => value,
  error: (value) => value,
  debug: (value) => value,
  muted: (value) => value,
};

const colorTheme: TerminalTheme = {
  brand: (value) => paint("1;38;5;226", value),
  heading: (value) => paint("1;38;5;229", value),
  executable: (value) => paint("38;5;255", value),
  command: (value) => paint("38;5;114", value),
  argument: (value) => paint("38;5;117", value),
  optional: (value) => paint("38;5;220", value),
  flag: (value) => paint("38;5;220", value),
  success: (value) => paint("38;5;114", value),
  warning: (value) => paint("38;5;220", value),
  error: (value) => paint("38;5;203", value),
  debug: (value) => paint("38;5;244", value),
  muted: (value) => paint("2", value),
};

export function terminalTheme(color: boolean): TerminalTheme {
  return color ? colorTheme : plainTheme;
}

export function colorEnabled(
  flags: { color?: unknown },
  stdoutIsTTY: boolean | undefined,
) {
  if (flags.color === false) return false;
  if (flags.color === true) return true;
  return stdoutIsTTY === true;
}

export function shouldShowWordmark(input: {
  stdoutIsTTY: boolean | undefined;
  agentDetected: boolean;
  agentMode: boolean;
}) {
  return input.stdoutIsTTY === true && !input.agentDetected && !input.agentMode;
}
