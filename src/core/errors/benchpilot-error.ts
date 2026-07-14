export type ErrorDetails = Record<string, unknown>;

export class BenchPilotError extends Error {
  constructor(
    public kind: string,
    public exitCode: number,
    message: string,
    public retryable = false,
    public stage?: string,
    public recovery: string[] = [],
    public details: ErrorDetails = {},
  ) {
    super(message);
    this.name = "BenchPilotError";
  }
}

export const fail = (
  kind: string,
  code: number,
  message: string,
  details: ErrorDetails = {},
): never => {
  throw new BenchPilotError(kind, code, message, false, undefined, [], details);
};
