import type { DeviceRuntime } from "../capabilities/types.js";
import type { Json } from "../config/config.js";
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
