import { readdir } from "node:fs/promises";
import path from "node:path";
import { lookup, object, type RuleObject } from "../rules/template.js";

export interface DiscoveredDevice {
  adapter: string;
  source: string;
  score: number;
  fields: RuleObject;
  identity?: string;
  matchedRules: string[];
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

const serialCandidates = async (): Promise<RuleObject[]> => {
  if (process.platform === "win32") return [];
  const entries = await readdir("/dev").catch(() => []);
  return entries
    .filter((name) => /^(tty(USB|ACM|S|AMA|\.)|cu\.)/.test(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({ port: path.join("/dev", name) }));
};

const sourceRecords = async (source: RuleObject): Promise<RuleObject[]> => {
  if (Array.isArray(source.records)) return source.records.map(object);
  if (source.type === "serial") return serialCandidates();
  // USB and network intentionally remain passive/no-op without native dependencies
  // or a declared targeted command provider.
  return [];
};

const identityFor = (identity: RuleObject, fields: RuleObject) => {
  for (const field of Array.isArray(identity.fields) ? identity.fields : []) {
    const value = lookup({ device: fields }, String(field));
    if (value !== undefined && value !== "") return String(value);
  }
  return identity.allow_port_fallback === true &&
    typeof fields.port === "string"
    ? fields.port
    : undefined;
};

export const discoverDevices = async (
  adapter: string,
  devices: RuleObject,
): Promise<DiscoveredDevice[]> => {
  const discovery = object(devices.discovery);
  if (discovery.enabled !== true) return [];
  const matchers = Array.isArray(discovery.matchers)
    ? discovery.matchers.map(object)
    : [];
  const minimumScore = Number(object(discovery.result).minimum_score ?? 0);
  const identity = object(devices.identity);
  const discovered: DiscoveredDevice[] = [];
  for (const source of Array.isArray(discovery.sources)
    ? discovery.sources.map(object)
    : []) {
    try {
      for (const fields of await sourceRecords(source)) {
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
    } catch {
      // One unavailable passive source never invalidates the rest of a scan.
    }
  }
  const unique = new Map<string, DiscoveredDevice>();
  for (const item of discovered) {
    const key =
      item.identity ?? `${item.source}:${JSON.stringify(item.fields)}`;
    const previous = unique.get(key);
    if (!previous || item.score > previous.score) unique.set(key, item);
  }
  return [...unique.values()].sort(
    (left, right) =>
      right.score - left.score ||
      String(left.identity ?? "").localeCompare(String(right.identity ?? "")) ||
      JSON.stringify(left.fields).localeCompare(JSON.stringify(right.fields)),
  );
};
