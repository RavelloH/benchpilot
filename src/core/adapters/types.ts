import type { DeviceRuntime } from "../capabilities/types.js";
import type { Json } from "../config/config.js";
import type { RuntimeSchema } from "./schemas.js";
import type { PathService } from "../paths/path-service.js";
import type { OperationReporter } from "../reporting/types.js";
import type { BusinessLog } from "../reporting/business-log.js";

export interface AdapterContext {
  adapterConfig: Json;
  paths: PathService;
}

export interface AdapterConfigurationTool {
  id: string;
  required: boolean;
  status: "resolved" | "unavailable";
  path?: string;
  candidateId?: string;
  message?: string;
}

/** A human-configurable path required to run an Adapter without discovery. */
export interface AdapterConfigurationField {
  key: string;
  required: boolean;
}

export interface AdapterInstallationField {
  key: string;
  summary: string;
  required: boolean;
  choices?: readonly { value: string; label: string }[];
  /** A single option may contain multiple selected values separated by this character. */
  separator?: ",";
}

export interface AdapterInstallationEstimate {
  minimumBytes: number;
  maximumBytes: number;
}

/** Adapter-owned installer contract. Core provides paths and reporting only. */
export interface AdapterInstallation {
  platforms: readonly ("windows" | "linux" | "macos")[];
  stability: "stable" | "experimental";
  estimate: AdapterInstallationEstimate;
  fields: readonly AdapterInstallationField[];
  install(context: {
    paths: PathService;
    root: string;
    values: Json;
    reporter: OperationReporter;
    logger: BusinessLog;
  }): Promise<Json>;
}

/** Read-only toolchain discovery result used to prepare global Adapter config. */
export interface AdapterConfigurationDiscovery {
  adapter: string;
  ready: boolean;
  config: Json;
  tools: AdapterConfigurationTool[];
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
  discoverConfiguration?(
    context: AdapterContext,
  ): Promise<AdapterConfigurationDiscovery>;
  configurationFields?(): readonly AdapterConfigurationField[];
  /** Allows an Adapter to distinguish a missing installation from a partial configuration. */
  configurationNotFound?(discovery: AdapterConfigurationDiscovery): boolean;
  installation?(): AdapterInstallation | undefined;
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
