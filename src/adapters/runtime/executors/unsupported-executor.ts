import { AdapterRuntimeError } from "../errors.js";

export const executeUnsupportedSerial = () => {
  throw new AdapterRuntimeError(
    "ADAPTER_EXECUTOR_UNAVAILABLE",
    "serial-read/serial-write runtime is not available in this BenchPilot version.",
  );
};
