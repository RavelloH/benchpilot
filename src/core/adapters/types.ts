import type { DeviceRuntime } from "../capabilities/types.js";
import type { Json } from "../config/config.js";
import type { RuntimeSchema } from "./schemas.js";
import type { PathService } from "../paths/path-service.js";

export interface AdapterContext {
  adapterConfig: Json;
  paths: PathService;
}

export interface AdapterServices extends AdapterContext {}

export interface Adapter {
  id: string;
  apiVersion: 1;
  version: string;
  summary: string;
  description?: string;
  configSchema: RuntimeSchema<Json>;
  deviceConfigSchema?: RuntimeSchema<Json>;
  redactConfig?(config: Json): Json;
  redactDeviceConfig?(config: Json): Json;
  discover(context: AdapterContext): Promise<Json[]>;
  discoverDetailed?(context: AdapterContext): Promise<{
    devices: Json[];
    diagnostics?: Json[];
  }>;
  doctor(context: AdapterContext): Promise<Json[]>;
  translate?(
    locale: string,
    key: string,
    variables?: Record<string, string>,
  ): string | undefined;
  createDevice(
    instance: string,
    deviceConfig: Json,
    services: AdapterServices,
  ): Promise<DeviceRuntime>;
}
