export interface TerminalTheme {
  brand(value: string): string;
  heading(value: string): string;
  command(value: string): string;
  option(value: string): string;
  muted(value: string): string;
}

const reset = "\u001B[0m";
const paint = (code: string, value: string) =>
  `\u001B[${code}m${value}${reset}`;

const plainTheme: TerminalTheme = {
  brand: (value) => value,
  heading: (value) => value,
  command: (value) => value,
  option: (value) => value,
  muted: (value) => value,
};

const colorTheme: TerminalTheme = {
  brand: (value) => paint("1;38;5;220", value),
  heading: (value) => paint("1;38;5;229", value),
  command: (value) => paint("38;5;114", value),
  option: (value) => paint("38;5;220", value),
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
  nonInteractive: boolean;
}) {
  return (
    input.stdoutIsTTY === true && !input.agentDetected && !input.nonInteractive
  );
}
