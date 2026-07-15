import type { DeviceRuntime, Json } from "../../core.js";
import type { RuntimeSchema } from "./schemas.js";

export interface Adapter {
  id: string;
  apiVersion: 1;
  version: string;
  summary: string;
  description?: string;
  configSchema: RuntimeSchema<Json>;
  deviceConfigSchema?: RuntimeSchema<Json>;
  discover(config: Json): Promise<Json[]>;
  doctor(config: Json): Promise<Json[]>;
  createDevice(instance: string, config: Json): Promise<DeviceRuntime>;
}
