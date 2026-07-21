import { SerialPort } from "serialport";
import type { ManagedSessionTransport } from "../core/sessions/session-host.js";

export interface SerialPortSessionTransportOptions {
  readonly path: string;
  readonly baudRate: number;
  readonly dtr: "preserve" | "off" | "on";
  readonly rts: "preserve" | "off" | "on";
}

type SerialPortFactory = (options: {
  path: string;
  baudRate: number;
  autoOpen: false;
  rtscts: false;
}) => SerialPort;

const callback = <T>(
  invoke: (done: (error: Error | null | undefined, value?: T) => void) => void,
) =>
  new Promise<T>((resolve, reject) => {
    invoke((error, value) => (error ? reject(error) : resolve(value as T)));
  });

/** Native serial transport. Core owns session policy; this adapter owns only I/O. */
export class SerialPortSessionTransport implements ManagedSessionTransport {
  private port: SerialPort | undefined;
  private readonly listeners = new Set<(chunk: Uint8Array) => void>();
  private closePromise: Promise<void> | undefined;
  private rejectClosed!: (error: Error) => void;
  private resolveClosed!: () => void;
  readonly closed = new Promise<void>((resolve, reject) => {
    this.resolveClosed = resolve;
    this.rejectClosed = reject;
  });

  constructor(
    private readonly options: SerialPortSessionTransportOptions,
    private readonly createPort: SerialPortFactory = (options) =>
      new SerialPort(options),
  ) {}

  async open() {
    if (this.port) return;
    const port = this.createPort({
      path: this.options.path,
      baudRate: this.options.baudRate,
      autoOpen: false,
      rtscts: false,
    });
    port.on("data", (chunk: Buffer) => {
      for (const listener of this.listeners) listener(chunk);
    });
    port.once("error", (error) => this.rejectClosed(error));
    port.once("close", () => this.resolveClosed());
    await callback<void>((done) => port.open(done));
    this.port = port;
    const signals: { dtr?: boolean; rts?: boolean } = {};
    if (this.options.dtr !== "preserve")
      signals.dtr = this.options.dtr === "on";
    if (this.options.rts !== "preserve")
      signals.rts = this.options.rts === "on";
    if (Object.keys(signals).length)
      await callback<void>((done) => port.set(signals, done));
  }

  onData(listener: (chunk: Uint8Array) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async write(data: Uint8Array) {
    const port = this.requirePort();
    const buffer = Buffer.from(data);
    await callback<void>((done) => port.write(buffer, done));
    await callback<void>((done) => port.drain(done));
    return buffer.byteLength;
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    const port = this.port;
    this.port = undefined;
    this.closePromise =
      !port || !port.isOpen
        ? Promise.resolve()
        : callback<void>((done) => port.close(done));
    return this.closePromise;
  }

  private requirePort() {
    if (!this.port || !this.port.isOpen)
      throw new Error("Serial port is not open.");
    return this.port;
  }
}
