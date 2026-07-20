import { stdout } from "node:process";

export interface OutputSink {
  readonly stdout: { write(value: string): unknown };
  readonly stderr: { write(value: string): unknown };
}

export const processOutputSink: OutputSink = {
  stdout,
  stderr: process.stderr,
};
