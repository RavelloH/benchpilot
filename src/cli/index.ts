#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import {
  Adapter,
  BenchPilotError,
  EventWriter,
  fail,
  getKey,
  Json,
  loadConfig,
  isSupportedNodeVersion,
  OperationRunner,
  PathService,
} from "../core.js";
import { loadBuiltinAdapters } from "../adapters/runtime/builtin-adapters.js";
import { createApplication } from "../application/application.js";
import { openApplicationRequest } from "../application/request-scope.js";
import {
  brief,
  commandGroups,
  fullHelp,
  humanFull,
  isCommandGroup,
  systemCapabilities,
} from "./help-renderer.js";
import { parse } from "./parser.js";
import { editConfig } from "./commands/config-editor.js";
import { handleDeviceCommand } from "./commands/device.js";
import { handleRuntimeCommand } from "./commands/runtime.js";
import { systemOperation } from "./commands/system.js";
import { commandOptionFlags } from "./option-parser.js";
import { write } from "./output-renderer.js";
import { detectAgent } from "./agent/detector.js";
import { interactionDecision } from "./interaction/policy.js";
import { promptInit } from "./interaction/prompter.js";
import { isLocale, t, type Locale } from "../i18n/index.js";

const version = "0.0.0";
export async function main(adapters?: Adapter[]) {
  let parsed;
  try {
    parsed = parse(process.argv.slice(2));
    const { path: parts, flags, rawOptions } = parsed;
    const commandFlags = { ...flags, ...commandOptionFlags(rawOptions) };
    if (flags.version) {
      stdout.write(`${version}\n`);
      return;
    }
    if (parts[0] === "help") {
      const target = parts.slice(1);
      if (commandFlags.all) {
        const value = {
          schema: "benchpilot.help-index",
          version: 2,
          commands: commandGroups,
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
    if (isCommandGroup(parts[0]) && parts.length === 1) {
      stdout.write(brief(parts[0]));
      return;
    }
    const paths = new PathService();
    if (parts[0] === "init") {
      const suppliedLocale = commandFlags.locale;
      const initLocale: Locale = isLocale(suppliedLocale)
        ? suppliedLocale
        : "en";
      const projectId =
        typeof commandFlags["project-id"] === "string"
          ? String(commandFlags["project-id"])
          : undefined;
      const projectName =
        typeof commandFlags["project-name"] === "string"
          ? String(commandFlags["project-name"])
          : undefined;
      let input =
        projectId && projectName && isLocale(suppliedLocale)
          ? { projectId, projectName, locale: suppliedLocale }
          : undefined;
      if (!input) {
        const decision = interactionDecision({
          agent: detectAgent(),
          json: flags.json,
          jsonl: flags.jsonl,
          stdinIsTTY: stdin.isTTY,
          stdoutIsTTY: stdout.isTTY,
          ci: Boolean(process.env.CI),
        });
        if (!decision.allowed) {
          const kind =
            decision.reason === "agent"
              ? "AGENT_INTERACTION_UNSUPPORTED"
              : decision.reason === "machine-output"
                ? "INTERACTIVE_MACHINE_OUTPUT_UNSUPPORTED"
                : "INTERACTIVE_TERMINAL_REQUIRED";
          const message = t(
            initLocale,
            decision.reason === "agent"
              ? "cli.interaction.agent"
              : decision.reason === "machine-output"
                ? "cli.interaction.machine"
                : "cli.interaction.terminal",
          );
          throw new BenchPilotError(kind, 2, message, false, undefined, [], {
            help: fullHelp(["init"]),
          });
        }
        try {
          input = await promptInit({
            io: { input: stdin, output: stdout },
            locale: initLocale,
            projectId,
            projectName,
            selectedLocale: isLocale(suppliedLocale)
              ? suppliedLocale
              : undefined,
          });
        } catch (error) {
          if ((error as Error).name === "INTERACTION_CANCELLED")
            throw new BenchPilotError(
              "INTERACTION_CANCELLED",
              130,
              t(initLocale, "cli.interaction.cancelled"),
            );
          throw error;
        }
      }
      const app = createApplication([]);
      write(
        await app.initializeProject({ cwd: process.cwd(), ...input }),
        flags,
        t(input.locale, "init.done"),
      );
      return;
    }
    const declared = adapters ?? (await loadBuiltinAdapters());
    const scope = await openApplicationRequest({
      cwd: process.cwd(),
      configPath: flags.config as string | undefined,
      flags,
      adapters: declared,
      eventWriter: flags.jsonl ? new EventWriter(stdout) : undefined,
    });
    const { registry } = scope.application;
    const { project, config, runner } = scope;
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
            origin: commandFlags["show-origin"]
              ? config.origins.get(key)
              : undefined,
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
            commandFlags,
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
        status: isSupportedNodeVersion(process.versions.node) ? "pass" : "fail",
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
        checks.push(...(await registry.doctor(d, config.value, paths)));
      if (commandFlags.save) {
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
        write(
          {
            checks: await registry.doctor(adapter, config.value, paths),
          },
          flags,
        );
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
        const adapters = commandFlags.adapter
          ? [registry.get(String(commandFlags.adapter))]
          : registry.list();
        const scans = await Promise.all(
          adapters.map(async (adapter) => {
            try {
              const result = await registry.discoverDetailed(
                adapter,
                config.value,
                paths,
                {
                  probe: commandFlags.probe === true,
                  confirmDeviceProbe:
                    commandFlags["confirm-device-probe"] === true,
                },
              );
              return {
                adapter: adapter.id,
                devices: result.devices,
                sources: result.diagnostics,
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
            adapters: scans.map(({ adapter, error, sources }) => ({
              adapter,
              error,
              ...(sources ? { sources } : {}),
            })),
          },
          flags,
        );
        return;
      }
    }
    if (
      await handleDeviceCommand({
        parts,
        flags,
        rawOptions,
        registry,
        runner,
        config,
        paths,
      })
    )
      return;
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
      const result = await systemOperation(
        parts[1],
        parts[2],
        runner,
        config.value,
      );
      if (!flags.jsonl) write(result, flags);
      return;
    }
    if (
      await handleRuntimeCommand({
        parts,
        flags,
        commandFlags,
        paths,
        project,
        config,
      })
    )
      return;
    fail("UNKNOWN_COMMAND", 2, `Unknown command: ${parts.join(" ")}`);
  } catch (e: unknown) {
    const err =
      e instanceof BenchPilotError
        ? e
        : new BenchPilotError("INTERNAL_ERROR", 8, (e as Error).message);
    const flags = parsed?.flags || {};
    const result = (err as BenchPilotError & { result?: Json }).result || {
      schema: "benchpilot.result",
      version: 2,
      ok: false,
      kind: err.kind,
      message: err.message,
      retryable: err.retryable,
      stage: err.stage,
      recovery: err.recovery,
      details: err.details,
    };
    if (flags.json) stdout.write(`${JSON.stringify(result)}\n`);
    else if (
      flags.jsonl &&
      !(err as BenchPilotError & { jsonlTerminalEmitted?: boolean })
        .jsonlTerminalEmitted
    ) {
      const isOperation = ["device", "system"].includes(parsed?.path[0] || "");
      stdout.write(
        `${JSON.stringify({ schema: "benchpilot.event", version: 2, event: { type: isOperation ? "operation.failed" : "command.failed", timestamp: new Date().toISOString() }, context: {}, data: { error: result } })}\n`,
      );
    } else {
      process.stderr.write(`${err.kind}: ${err.message}\n`);
      if (
        [
          "AGENT_INTERACTION_UNSUPPORTED",
          "INTERACTIVE_MACHINE_OUTPUT_UNSUPPORTED",
          "INTERACTIVE_TERMINAL_REQUIRED",
        ].includes(err.kind)
      )
        process.stderr.write(`\n${humanFull(["init"])}\n`);
    }
    process.exitCode = err.exitCode;
  }
}
if (process.env.BENCHPILOT_NO_AUTORUN !== "1") void main();
