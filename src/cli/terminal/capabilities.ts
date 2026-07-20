export interface TerminalStreamCapabilities {
  readonly isTTY: boolean;
  readonly columns?: number;
  readonly rows?: number;
}

export interface TerminalCapabilities {
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
  readonly stderrIsTTY: boolean;
  readonly columns: number;
  readonly rows?: number;
  readonly color: boolean;
  readonly cursor: boolean;
}

export const detectTerminalCapabilities = (input: {
  readonly stdin?: TerminalStreamCapabilities;
  readonly stdout?: TerminalStreamCapabilities;
  readonly stderr?: TerminalStreamCapabilities;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly color: boolean;
}): TerminalCapabilities => {
  const stdinIsTTY = input.stdin?.isTTY === true;
  const stdoutIsTTY = input.stdout?.isTTY === true;
  const stderrIsTTY = input.stderr?.isTTY === true;
  const columns = Math.max(1, input.stdout?.columns ?? 80);
  return {
    stdinIsTTY,
    stdoutIsTTY,
    stderrIsTTY,
    columns,
    ...(input.stdout?.rows ? { rows: input.stdout.rows } : {}),
    color: input.color && stdoutIsTTY,
    cursor: stdoutIsTTY && input.env?.TERM !== "dumb",
  };
};
