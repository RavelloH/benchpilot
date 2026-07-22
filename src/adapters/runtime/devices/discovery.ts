import { SerialPort } from "serialport";
import { lookup, object, type RuleObject } from "../rules/template.js";
import { normalizePortIdentity } from "./identity.js";

export interface DiscoveredDevice {
  adapter: string;
  source: string;
  score: number;
  fields: RuleObject;
  identity?: string;
  matchedRules: string[];
  probe?: {
    ok: boolean;
    result?: RuleObject;
    error?: { kind: string; retryable: boolean };
  };
}

export interface DeviceDiscoveryResult {
  devices: DiscoveredDevice[];
  sources: Array<{
    id: string;
    type: string;
    status: "pass" | "warn" | "fail";
    candidates: number;
    error?: { kind: string; retryable: boolean };
  }>;
}

export type DeviceSourceProvider = (
  source: RuleObject,
) => Promise<RuleObject[]>;

export interface DeviceDiscoveryProviders {
  serial?: DeviceSourceProvider;
  usb?: DeviceSourceProvider;
  network?: DeviceSourceProvider;
  command?: DeviceSourceProvider;
}

/** The passive metadata returned by the shared serial-port binding. */
export interface PassiveSerialPort {
  readonly path: string;
  readonly manufacturer?: string | undefined;
  readonly serialNumber?: string | undefined;
  readonly pnpId?: string | undefined;
  readonly locationId?: string | undefined;
  readonly productId?: string | undefined;
  readonly vendorId?: string | undefined;
}

const match = (actual: unknown, rule: RuleObject) => {
  const value = rule.value;
  switch (rule.operator) {
    case "exists":
      return actual !== undefined && actual !== "";
    case "equals":
      return actual === value;
    case "equals-ignore-case":
      return String(actual).toLowerCase() === String(value).toLowerCase();
    case "contains":
      return String(actual).includes(String(value));
    case "in":
      return Array.isArray(value) && value.includes(actual);
    case "regex":
      try {
        return new RegExp(String(value)).test(String(actual));
      } catch {
        return false;
      }
    default:
      return false;
  }
};

/**
 * Lists ports without opening them. Field names intentionally mirror the
 * cross-platform metadata exposed to Adapter rules, while `port` is always
 * present and usable as a connection address.
 */
export const serialCandidates = async (
  list: () => Promise<readonly PassiveSerialPort[]> = () => SerialPort.list(),
): Promise<RuleObject[]> =>
  (await list())
    .map((entry) => {
      const description =
        [entry.manufacturer, entry.pnpId].filter(Boolean).join(" ") ||
        entry.path;
      return {
        port: entry.path,
        description,
        hwid: entry.pnpId ?? "",
        vid: entry.vendorId ?? "",
        pid: entry.productId ?? "",
        serial_number: entry.serialNumber ?? "",
        manufacturer: entry.manufacturer ?? "",
        product: entry.pnpId ?? "",
        location: entry.locationId ?? "",
      };
    })
    .sort((left, right) => String(left.port).localeCompare(String(right.port)));

const sourceRecords = async (
  source: RuleObject,
  providers: DeviceDiscoveryProviders,
): Promise<RuleObject[]> => {
  if (Array.isArray(source.records)) return source.records.map(object);
  const provider = providers[source.type as keyof DeviceDiscoveryProviders];
  if (provider) return provider(source);
  if (source.type === "serial") return serialCandidates();
  // USB requires a native dependency to enumerate reliably. Network sources
  // are intentionally passive: adapters may supply static records or an
  // explicit command source, but the runtime never scans a LAN.
  return [];
};

const identityFor = (identity: RuleObject, fields: RuleObject) => {
  for (const field of Array.isArray(identity.fields) ? identity.fields : []) {
    const value = lookup({ device: fields }, String(field));
    if (value !== undefined && value !== "")
      return String(field) === "device.port" && typeof value === "string"
        ? normalizePortIdentity(value)
        : String(value);
  }
  return identity.allow_port_fallback === true &&
    typeof fields.port === "string"
    ? normalizePortIdentity(fields.port)
    : undefined;
};

export const discoverDevicesDetailed = async (
  adapter: string,
  devices: RuleObject,
  providers: DeviceDiscoveryProviders = {},
): Promise<DeviceDiscoveryResult> => {
  const discovery = object(devices.discovery);
  if (discovery.enabled !== true) return { devices: [], sources: [] };
  const matchers = Array.isArray(discovery.matchers)
    ? discovery.matchers.map(object)
    : [];
  const minimumScore = Number(object(discovery.result).minimum_score ?? 0);
  const identity = object(devices.identity);
  const discovered: DiscoveredDevice[] = [];
  const diagnostics: DeviceDiscoveryResult["sources"] = [];
  for (const source of Array.isArray(discovery.sources)
    ? discovery.sources.map(object)
    : []) {
    try {
      const records = await sourceRecords(source, providers);
      let candidates = 0;
      for (const fields of records) {
        candidates += 1;
        const matched = matchers.filter(
          (rule) =>
            rule.source === source.id &&
            match(lookup(fields, String(rule.field)), rule),
        );
        const score = matched.reduce(
          (total, rule) => total + Number(rule.score ?? 0),
          0,
        );
        if (score < minimumScore) continue;
        discovered.push({
          adapter,
          source: String(source.id),
          score,
          fields,
          identity: identityFor(identity, fields),
          matchedRules: matched.map((rule) => String(rule.id)),
        });
      }
      diagnostics.push({
        id: String(source.id),
        type: String(source.type),
        status: "pass",
        candidates,
      });
    } catch (error) {
      const retryable = Boolean(
        error &&
        typeof error === "object" &&
        (error as { retryable?: unknown }).retryable === true,
      );
      const kind =
        error &&
        typeof error === "object" &&
        typeof (error as { code?: unknown }).code === "string"
          ? String((error as { code: string }).code)
          : "ADAPTER_DISCOVERY_FAILED";
      diagnostics.push({
        id: String(source.id),
        type: String(source.type),
        status: "fail",
        candidates: 0,
        error: { kind, retryable },
      });
    }
  }
  const unique = new Map<string, DiscoveredDevice>();
  for (const item of discovered) {
    const key =
      item.identity ?? `${item.source}:${JSON.stringify(item.fields)}`;
    const previous = unique.get(key);
    if (!previous || item.score > previous.score) unique.set(key, item);
  }
  return {
    devices: [...unique.values()].sort(
      (left, right) =>
        right.score - left.score ||
        String(left.identity ?? "").localeCompare(
          String(right.identity ?? ""),
        ) ||
        JSON.stringify(left.fields).localeCompare(JSON.stringify(right.fields)),
    ),
    sources: diagnostics,
  };
};
