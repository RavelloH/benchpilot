#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { stdin, stdout } from "node:process";
import TOML from "@iarna/toml";
import {
  Adapter,
  ApprovalManager,
  BenchPilotError,
  deleteKey,
  duration,
  fail,
  getKey,
  Json,
  loadConfig,
  LockManager,
  OperationRunner,
  PathService,
  projectStorageKey,
  readJson,
  RunManager,
  setKey,
  validateConfig,
} from "../core.js";
import { demoAdapter } from "../adapters/demo/adapter.js";
import { createBenchPilotApplication } from "./application.js";
import { type Flags, parse } from "./parser.js";
import { write } from "./output-renderer.js";

const version = "0.0.0";
const globalOptions = [
  "--config <path>",
  "--json",
  "--jsonl",
  "--quiet",
  "--verbose",
  "--timeout <duration>",
  "--dry-run",
  "--no-color",
  "--session <name>",
  "--help",
  "--version",
];
const groups: Record<string, { summary: string; children: string[] }> = {
  root: {
    summary: "Agent-first device lifecycle CLI.",
    children: [
      "init",
      "doctor",
      "config",
      "adapters",
      "adapter",
      "devices",
      "device",
      "systems",
      "system",
      "runs",
      "run",
      "locks",
      "lock",
      "approvals",
      "approval",
      "help",
    ],
  },
  config: {
    summary: "Read, explain, validate and safely edit configuration.",
    children: ["get", "set", "unset", "resolved", "explain", "validate"],
  },
  adapters: {
    summary: "List installed adapter definitions.",
    children: ["list"],
  },
  adapter: { summary: "Inspect an adapter.", children: ["<adapter-id>"] },
  devices: {
    summary: "List configured or discovered devices.",
    children: ["list", "scan"],
  },
  device: {
    summary: "Operate a configured device through its capabilities.",
    children: ["<device-instance>"],
  },
  systems: { summary: "List configured systems.", children: ["list"] },
  system: {
    summary: "Orchestrate a configured system.",
    children: ["<system-instance>"],
  },
  runs: {
    summary: "List and prune immutable operation records.",
    children: ["list", "prune"],
  },
  run: { summary: "Inspect a recorded operation.", children: ["<run-id>"] },
  locks: {
    summary: "Inspect physical-resource locks.",
    children: ["list", "clear-stale"],
  },
  lock: { summary: "Inspect or clear one lock.", children: ["<lock-id>"] },
  approvals: { summary: "List local human approval requests.", children: [] },
  approval: {
    summary: "Inspect or resolve one human approval request.",
    children: ["<approval-id>"],
  },
};
const systemCapabilities = [
  "info",
  "status",
  "deploy",
  "smoke",
  "collect",
  "emergency-stop",
];
function brief(name: string) {
  const g = groups[name] || groups.root;
  return `${name === "root" ? "benchpilot" : `benchpilot ${name}`} — ${g.summary}\n\nUsage: benchpilot${name === "root" ? "" : ` ${name}`} <command>\n\nCommands:\n${g.children.map((c) => `  ${c.padEnd(17)} ${summary(name, c)}`).join("\n")}\n\nGlobal options: ${globalOptions.slice(0, 5).join("  ")}\nRun 'benchpilot${name === "root" ? "" : ` ${name}`} --help' for complete help.\n`;
}
function summary(group: string, child: string) {
  return (
    (
      {
        get: "Get a resolved configuration value",
        set: "Set a configuration value",
        unset: "Unset a configuration value",
        resolved: "Show resolved configuration",
        explain: "Explain value provenance",
        validate: "Validate configuration",
        list: "List resources",
        scan: "Discover registered adapter devices",
        init: "Create a demo project",
        doctor: "Check local environment",
        prune: "Remove old run records",
        "clear-stale": "Remove stale locks",
      } as Record<string, string>
    )[child] || "Inspect or operate resource"
  );
}
function fullHelp(parts: string[]) {
  const pathName = parts.join(" ") || "benchpilot";
  return {
    schema: "benchpilot.help",
    version: 1,
    path: parts,
    summary: groups[parts.at(-1) || "root"]?.summary || "BenchPilot command",
    description:
      "Command definitions drive parsing, help, validation, safety and execution.",
    arguments: [],
    options: globalOptions,
    safety: { mode: "normal" },
    errors: ["USAGE_ERROR", "CONFIG_ERROR", "DEVICE_BUSY", "OPERATION_TIMEOUT"],
    examples: [`benchpilot ${pathName} --json`],
  };
}
function humanFull(parts: string[]) {
  const h = fullHelp(parts);
  return `NAME\n  benchpilot ${parts.join(" ")} — ${h.summary}\n\nSYNOPSIS\n  benchpilot ${parts.join(" ")} [OPTIONS]\n\nDESCRIPTION\n  ${h.description}\n\nWORKFLOW\n  Configuration → adapter → capability → operation runner → run record.\n\nARGUMENTS\n  See command path.\n\nOPTIONS\n  ${globalOptions.join("\n  ")}\n\nCONFIGURATION\n  global, project, local, explicit file and BENCHPILOT_* variables are merged.\n\nOUTPUT\n  Human summary by default; --json result or --jsonl structured events.\n\nSAFETY\n  ${JSON.stringify(h.safety)}\n\nEXIT CODES\n  0 success; 2 usage; 3 configuration/resource; 4 lock; 5 operation; 6 timeout; 7 safety; 8 internal.\n\nERROR KINDS\n  ${h.errors.join(", ")}\n\nEXAMPLES\n  ${h.examples.join("\n  ")}\n\nSEE ALSO\n  benchpilot help --all\n`;
}
async function init() {
  const file = path.join(process.cwd(), "benchpilot.toml");
  try {
    await fs.access(file);
    fail(
      "CONFIG_EXISTS",
      3,
      `${file} already exists; refusing to overwrite it.`,
    );
  } catch (e) {
    if (e instanceof BenchPilotError) throw e;
  }
  await fs.writeFile(
    file,
    `version = 1\n\n[project]\nid = "benchpilot-demo"\nname = "BenchPilot Demo"\n\n[devices.demo]\nadapter = "demo"\n\n[systems.demo]\ndevices = ["demo"]\n\n[adapters.demo]\nconnected = true\ndevice_id = "demo-device-01"\noperation_delay_ms = 50\n`,
  );
  await fs.mkdir(path.join(process.cwd(), ".benchpilot"), { recursive: true });
  await fs.writeFile(
    path.join(process.cwd(), ".benchpilot", ".gitignore"),
    "*\n!.gitignore\n",
  );
  return { created: file, adapter: "demo", simulated: true };
}
async function editConfig(
  paths: PathService,
  project: Awaited<ReturnType<PathService["project"]>>,
  flags: Flags,
  key: string,
  value?: string,
) {
  const scopes = ["local", "project", "global"].filter(
    (x) => flags[x],
  ) as string[];
  if (scopes.length > 1)
    fail("USAGE_ERROR", 2, "Choose only one configuration scope.");
  const scope = scopes[0] || (project ? "local" : "global");
  const file =
    scope === "local"
      ? project && path.join(project.root, ".benchpilot", "config.local.toml")
      : scope === "project"
        ? project?.config
        : paths.globalConfig();
  if (!file)
    fail("PROJECT_NOT_FOUND", 3, "--project requires a BenchPilot project.");
  const targetFile = file!;
  let config: Json = {};
  try {
    config = TOML.parse(await fs.readFile(targetFile, "utf8")) as Json;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (value === undefined) deleteKey(config, key);
  else {
    let v: unknown = value;
    if (value === "true" || value === "false") v = value === "true";
    else if (/^-?\d+(\.\d+)?$/.test(value)) v = Number(value);
    else
      try {
        v = JSON.parse(value);
      } catch {}
    setKey(config, key, v);
  }
  validateConfig(config);
  await fs.mkdir(path.dirname(targetFile), { recursive: true });
  const temp = `${targetFile}.${process.pid}.tmp`;
  await fs.writeFile(temp, TOML.stringify(config as never));
  await fs.rename(temp, targetFile);
  return {
    scope,
    path: targetFile,
    key,
    value: value === undefined ? undefined : getKey(config, key),
  };
}
async function systemOperation(
  name: string,
  op: string,
  runner: OperationRunner,
  config: Json,
) {
  const sys = (config.systems as Json | undefined)?.[name];
  if (!sys || typeof sys !== "object" || !Array.isArray((sys as Json).devices))
    fail("SYSTEM_NOT_FOUND", 3, `System not found: ${name}`);
  const devices = (sys as Json).devices as string[];
  if (op === "info")
    return { system: name, devices, operations: systemCapabilities };
  if (op === "status")
    return {
      system: name,
      results: await Promise.all(
        devices.map(async (d) => ({
          device: d,
          result: await runner.execute(d, "status", {}),
        })),
      ),
    };
  if (op === "emergency-stop") {
    const results = [];
    for (const d of devices)
      try {
        results.push({
          device: d,
          result: await runner.execute(d, "stop", {}),
        });
      } catch (e) {
        results.push({ device: d, error: (e as Error).message });
      }
    return { system: name, results };
  }
  const capability =
    op === "smoke" ? "selftest" : op === "collect" ? "capture" : "deploy";
  const results = [];
  for (const d of [...devices].sort())
    results.push({
      device: d,
      result: await runner.execute(d, capability, {}),
    });
  return { system: name, operation: op, results };
}
export async function main(adapters: Adapter[] = [demoAdapter]) {
  let parsed;
  try {
    parsed = parse(process.argv.slice(2));
    const { path: parts, flags } = parsed;
    if (flags.version) {
      stdout.write(`${version}\n`);
      return;
    }
    if (parts[0] === "help") {
      const target = parts.slice(1);
      if (flags.all) {
        const value = {
          schema: "benchpilot.help-index",
          version: 1,
          commands: Object.keys(groups),
        };
        write(value, flags, JSON.stringify(value, null, 2));
        return;
      }
      const h = fullHelp(target);
      write(h, flags, humanFull(target));
      return;
    }
    const target = parts.length ? parts : [];
    if (flags.help && parts[0] !== "device") {
      const h = fullHelp(target);
      write(h, flags, humanFull(target));
      return;
    }
    if (!parts.length) {
      stdout.write(brief("root"));
      return;
    }
    if (groups[parts[0]] && parts.length === 1) {
      stdout.write(brief(parts[0]));
      return;
    }
    const paths = new PathService();
    if (parts[0] === "init") {
      write(await init(), flags, "Initialized BenchPilot demo project.");
      return;
    }
    const project = await paths.project(
      process.cwd(),
      flags.config as string | undefined,
    );
    const config = await loadConfig(
      paths,
      project,
      flags.config as string | undefined,
    );
    const { registry } = createBenchPilotApplication(adapters);
    const runner = new OperationRunner({
      paths,
      registry,
      config,
      project,
      flags,
    });
    if (parts[0] === "config") {
      if (parts.length === 1) {
        stdout.write(brief("config"));
        return;
      }
      const sub = parts[1],
        key = parts[2];
      if (["get", "explain"].includes(sub) && !key)
        fail("USAGE_ERROR", 2, `config ${sub} requires <key>.`);
      if (sub === "get") {
        const value = getKey(config.value, key);
        if (value === undefined)
          fail(
            "CONFIG_KEY_NOT_FOUND",
            3,
            `Configuration key not found: ${key}`,
          );
        write(
          {
            key,
            value,
            origin: flags["show-origin"] ? config.origins.get(key) : undefined,
          },
          flags,
          String(value),
        );
        return;
      }
      if (sub === "resolved") {
        write(
          { config: config.value, origins: Object.fromEntries(config.origins) },
          flags,
        );
        return;
      }
      if (sub === "explain") {
        write(
          {
            key,
            value: getKey(config.value, key),
            origin: config.origins.get(key),
            layers: config.layers.map((x) => ({
              scope: x.scope,
              path: x.path,
              value: getKey(x.value, key),
            })),
          },
          flags,
        );
        return;
      }
      if (sub === "validate") {
        write({ valid: true }, flags, "Configuration is valid.");
        return;
      }
      if (sub === "set" || sub === "unset") {
        if (!key || (sub === "set" && !parts[3]))
          fail(
            "USAGE_ERROR",
            2,
            `config ${sub} requires a key${sub === "set" ? " and value" : ""}.`,
          );
        write(
          await editConfig(
            paths,
            project,
            flags,
            key,
            sub === "set" ? parts[3] : undefined,
          ),
          flags,
        );
        return;
      }
      fail("USAGE_ERROR", 2, `Unknown config command: ${sub}`);
    }
    if (parts[0] === "doctor") {
      const checks: Json[] = [];
      checks.push({
        id: "node",
        status:
          Number(process.versions.node.split(".")[0]) >= 20 ? "pass" : "fail",
        message: `Node.js ${process.version}`,
      });
      checks.push({
        id: "project",
        status: project ? "pass" : "warn",
        message: project ? project.root : "No project discovered",
      });
      checks.push({
        id: "config",
        status: "pass",
        message: "TOML and configuration schema valid",
      });
      for (const d of registry.list())
        checks.push(...(await d.doctor(config.value)));
      if (flags.save) {
        /* doctor is intentionally read-only unless explicit save; its diagnostics are returned */
      }
      write(
        { checks },
        flags,
        checks.map((c) => `${c.status}: ${c.id} — ${c.message}`).join("\n"),
      );
      return;
    }
    if (parts[0] === "adapters" && parts[1] === "list") {
      write(
        {
          adapters: registry
            .list()
            .map((a) => ({ id: a.id, version: a.version, summary: a.summary })),
        },
        flags,
      );
      return;
    }
    if (parts[0] === "adapter" && parts[1]) {
      const adapter = registry.get(parts[1]);
      if (parts.length === 2) {
        stdout.write(
          `benchpilot adapter ${adapter.id} — ${adapter.summary}\n\nCommands: info, doctor\n`,
        );
        return;
      }
      if (parts[2] === "info")
        write(
          {
            id: adapter.id,
            version: adapter.version,
            summary: adapter.summary,
          },
          flags,
        );
      else if (parts[2] === "doctor")
        write({ checks: await adapter.doctor(config.value) }, flags);
      else fail("USAGE_ERROR", 2, "Unknown adapter command.");
      return;
    }
    if (parts[0] === "devices") {
      if (parts.length === 1) {
        stdout.write(brief("devices"));
        return;
      }
      if (parts[1] === "list") {
        write(
          {
            devices: Object.entries((config.value.devices || {}) as Json).map(
              ([id, v]) => ({ id, ...(v as Json) }),
            ),
          },
          flags,
        );
        return;
      }
      if (parts[1] === "scan") {
        const adapters = flags.adapter
          ? [registry.get(String(flags.adapter))]
          : registry.list();
        const scans = await Promise.all(
          adapters.map(async (adapter) => {
            try {
              return {
                adapter: adapter.id,
                devices: await adapter.discover(config.value),
              };
            } catch (error: unknown) {
              return {
                adapter: adapter.id,
                devices: [],
                error: (error as Error).message,
              };
            }
          }),
        );
        write(
          {
            devices: scans.flatMap((scan) => scan.devices),
            adapters: scans.map(({ adapter, error }) => ({ adapter, error })),
          },
          flags,
        );
        return;
      }
    }
    if (parts[0] === "device" && parts[1]) {
      const rawDevice = (config.value.devices as Json | undefined)?.[parts[1]];
      if (!rawDevice || typeof rawDevice !== "object")
        fail("DEVICE_NOT_FOUND", 3, `Device not found: ${parts[1]}`);
      const adapter = registry.get(String((rawDevice as Json).adapter));
      const runtime = await adapter.createDevice(parts[1], rawDevice as Json);
      if (parts.length === 2) {
        stdout.write(
          `benchpilot device ${parts[1]} — ${adapter.summary}\n\nCommands:\n${runtime
            .capabilities()
            .map((x) => `  ${x.id.padEnd(17)} ${x.summary}`)
            .join("\n")}\n`,
        );
        return;
      }
      const capability = parts[2];
      if (!runtime.capabilities().some((item) => item.id === capability))
        fail(
          "UNSUPPORTED_CAPABILITY",
          3,
          `Device ${parts[1]} does not support ${capability}.`,
        );
      if (flags.help) {
        const definition = runtime
          .capabilities()
          .find((item) => item.id === capability)!;
        const help = {
          schema: "benchpilot.help",
          version: 1,
          path: parts,
          summary: definition.summary,
          description: definition.description || definition.summary,
          options: definition.options || [],
          inputSchema: definition.inputSchema?.describe() || { type: "object" },
          outputSchema: definition.outputSchema?.describe() || {
            type: "object",
          },
          safety: definition.safety,
        };
        write(help, flags, `${definition.id} — ${definition.summary}\n`);
        return;
      }
      const globalFlagNames = new Set([
        "json",
        "jsonl",
        "quiet",
        "verbose",
        "timeout",
        "dry-run",
        "no-color",
        "session",
        "help",
        "version",
        "config",
      ]);
      const input = Object.fromEntries(
        Object.entries(flags).filter(
          ([name]) =>
            !globalFlagNames.has(name) && !name.startsWith("dangerously-"),
        ),
      );
      const result = await runner.execute(parts[1], capability, input);
      const r = result as Json;
      write(
        result,
        flags,
        r.dryRun
          ? `${capability} dry-run plan created.`
          : `${capability} completed${r.runId ? ` (run ${String(r.runId)})` : ""}.`,
      );
      return;
    }
    if (parts[0] === "systems" && parts[1] === "list") {
      write(
        {
          systems: Object.entries((config.value.systems || {}) as Json).map(
            ([id, v]) => ({ id, ...(v as Json) }),
          ),
        },
        flags,
      );
      return;
    }
    if (parts[0] === "system" && parts[1]) {
      const system = (config.value.systems as Json | undefined)?.[parts[1]];
      if (!system || typeof system !== "object")
        fail("SYSTEM_NOT_FOUND", 3, `System not found: ${parts[1]}`);
      if (parts.length === 2) {
        stdout.write(
          `benchpilot system ${parts[1]} — Configured system\n\nCommands:\n${systemCapabilities.map((x) => `  ${x}`).join("\n")}\n`,
        );
        return;
      }
      write(
        await systemOperation(parts[1], parts[2], runner, config.value),
        flags,
      );
      return;
    }
    if (parts[0] === "runs") {
      if (parts.length === 1) {
        stdout.write(brief("runs"));
        return;
      }
      const manager = new RunManager(
        paths,
        projectStorageKey({
          id: String((config.value.project as Json | undefined)?.id || ""),
          root: project?.root,
        }),
      );
      if (parts[1] === "list") {
        let runs = await manager.list();
        if (flags.status)
          runs = runs.filter((r) => r.manifest?.status === flags.status);
        if (flags.limit) runs = runs.slice(0, Number(flags.limit));
        write({ runs }, flags);
        return;
      }
      if (parts[1] === "prune") {
        const runs = await manager.list();
        if (
          !flags["older-than"] &&
          !flags.keep &&
          !flags["dangerously-remove-all-runs"]
        )
          fail(
            "DANGEROUS_CONFIRMATION_REQUIRED",
            7,
            "runs prune requires --older-than, --keep, or --dangerously-remove-all-runs.",
          );
        let remove = runs;
        if (flags.keep) remove = runs.slice(Number(flags.keep));
        if (flags["older-than"]) {
          const age = duration(flags["older-than"]);
          remove = runs.filter(
            (r) => Date.now() - Date.parse(String(r.manifest?.startedAt)) > age,
          );
        }
        for (const r of remove)
          await fs.rm(
            path.join(
              paths.runsRoot(
                projectStorageKey({
                  id: String(
                    (config.value.project as Json | undefined)?.id || "",
                  ),
                  root: project?.root,
                }),
              ),
              r.id,
            ),
            { recursive: true, force: true },
          );
        write({ removed: remove.map((x) => x.id) }, flags);
        return;
      }
    }
    if (parts[0] === "run" && parts[1]) {
      if (parts.length === 2) {
        stdout.write(
          "benchpilot run <run-id> — Commands: show, logs, artifacts\n",
        );
        return;
      }
      const manager = new RunManager(
        paths,
        projectStorageKey({
          id: String((config.value.project as Json | undefined)?.id || ""),
          root: project?.root,
        }),
      );
      const record = await manager.get(parts[1]);
      const dir = record.dir;
      if (parts[2] === "show")
        write({ manifest: record.manifest, result: record.result }, flags);
      else if (parts[2] === "logs")
        write(
          { log: await fs.readFile(path.join(dir, "benchpilot.log"), "utf8") },
          flags,
          await fs.readFile(path.join(dir, "benchpilot.log"), "utf8"),
        );
      else if (parts[2] === "artifacts")
        write(
          {
            artifacts: await fs
              .readdir(path.join(dir, "artifacts"))
              .catch(() => []),
          },
          flags,
        );
      else fail("USAGE_ERROR", 2, "Unknown run command.");
      return;
    }
    if (parts[0] === "locks") {
      if (parts.length === 1) {
        stdout.write(brief("locks"));
        return;
      }
      const locks = new LockManager(paths);
      if (parts[1] === "list") write({ locks: await locks.list() }, flags);
      else if (parts[1] === "clear-stale") {
        const ls = await locks.list();
        const cleared = [];
        for (const l of ls)
          if (l && (await locks.liveness(l)) === "stale") {
            await locks.clear(l.lockId, false);
            cleared.push(l.lockId);
          }
        write({ cleared }, flags);
        return;
      }
      return;
    }
    if (parts[0] === "lock" && parts[1]) {
      if (parts.length === 2) {
        stdout.write("benchpilot lock <lock-id> — Commands: inspect, clear\n");
        return;
      }
      const locks = new LockManager(paths);
      if (parts[2] === "inspect")
        write(await readJson(locks.file(parts[1])), flags);
      else if (parts[2] === "clear")
        write(
          {
            cleared: await locks.clear(
              parts[1],
              Boolean(flags["dangerously-clear-active-lock"]),
            ),
          },
          flags,
        );
      else fail("USAGE_ERROR", 2, "Unknown lock command.");
      return;
    }
    if (parts[0] === "approvals" && parts.length === 1) {
      stdout.write(brief("approvals"));
      return;
    }
    if (parts[0] === "approvals" && parts[1] === "list") {
      const a = new ApprovalManager(paths);
      write({ approvals: await Promise.all(await a.list()) }, flags);
      return;
    }
    if (parts[0] === "approval" && parts[1]) {
      if (parts.length === 2) {
        stdout.write(
          "benchpilot approval <approval-id> — Commands: inspect, approve, reject\n",
        );
        return;
      }
      const a = new ApprovalManager(paths);
      if (parts[2] === "inspect") write(await a.get(parts[1]), flags);
      else if (parts[2] === "reject") {
        await a.change(parts[1], "rejected");
        write({ id: parts[1], status: "rejected" }, flags);
      } else if (parts[2] === "approve") {
        if (
          !stdin.isTTY ||
          !stdout.isTTY ||
          process.env.CI ||
          flags.json ||
          flags.jsonl
        )
          fail(
            "INTERACTIVE_APPROVAL_REQUIRED",
            7,
            "Approval requires an interactive TTY and cannot use JSON output.",
          );
        const req = await a.get(parts[1]);
        stdout.write(
          `Risk approval ${parts[1]}. Type physical device ID (${(req.binding as Json).device && ((req.binding as Json).device as Json).physicalId}): `,
        );
        const answer = await new Promise<string>((r) =>
          stdin.once("data", (x) => r(String(x).trim())),
        );
        if (answer !== ((req.binding as Json).device as Json).physicalId)
          fail("APPROVAL_CHALLENGE_FAILED", 7, "Challenge did not match.");
        await a.change(parts[1], "approved");
        write({ id: parts[1], status: "approved" }, flags);
      } else fail("USAGE_ERROR", 2, "Unknown approval command.");
      return;
    }
    fail("UNKNOWN_COMMAND", 2, `Unknown command: ${parts.join(" ")}`);
  } catch (e: unknown) {
    const err =
      e instanceof BenchPilotError
        ? e
        : new BenchPilotError("INTERNAL_ERROR", 8, (e as Error).message);
    const flags = parsed?.flags || {};
    const result = (err as BenchPilotError & { result?: Json }).result || {
      schema: "benchpilot.result",
      version: 1,
      ok: false,
      kind: err.kind,
      message: err.message,
      retryable: err.retryable,
      stage: err.stage,
      recovery: err.recovery,
      details: err.details,
    };
    if (flags.json) stdout.write(`${JSON.stringify(result)}\n`);
    else if (flags.jsonl)
      stdout.write(
        `${JSON.stringify({ schema: "benchpilot.event", version: 1, event: { type: "operation.failed", timestamp: new Date().toISOString() }, error: result })}\n`,
      );
    else process.stderr.write(`${err.kind}: ${err.message}\n`);
    process.exitCode = err.exitCode;
  }
}
if (process.env.BENCHPILOT_NO_AUTORUN !== "1") void main();
