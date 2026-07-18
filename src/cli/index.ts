#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { Adapter, BenchPilotError, EventWriter, fail, Json } from "../core.js";
import { loadBuiltinAdapters } from "../adapters/runtime/builtin-adapters.js";
import { createApplication } from "../application/application.js";
import { openApplicationRequest } from "../application/request-scope.js";
import { readProjectLocale } from "../application/config/locale.js";
import {
  brief,
  commandGroups,
  fullHelp,
  humanFull,
  isCommandGroup,
} from "./help-renderer.js";
import { parse } from "./parser.js";
import { handleDeviceCommand } from "./commands/device.js";
import { handleRuntimeCommand } from "./commands/runtime.js";
import {
  capabilityInput,
  commandOptionFlags,
  optionEnabled,
} from "./option-parser.js";
import {
  humanErrorMessage,
  write,
  writeFailure,
  writePresentation,
  writeText,
} from "./output-renderer.js";
import { detectAgent } from "./agent/detector.js";
import { interactionDecision } from "./interaction/policy.js";
import { renderVersion, versionPage } from "./presentation/version.js";
import {
  renderInteractiveHomeHeader,
  rootHelpPage,
  rootMenuChoices,
} from "./presentation/root-help.js";
import { commandHelpPage } from "./presentation/command-help.js";
import { presentationView } from "./presentation/page.js";
import { colorEnabled, shouldShowWordmark } from "./presentation/theme.js";
import {
  InteractionCancelledError,
  InteractionBackError,
  InteractionExitedError,
  InteractionSession,
  promptInit,
} from "./interaction/prompter.js";
import { isLocale, t, type Locale, type MessageKey } from "../i18n/index.js";

const version = "0.0.0";
const supportedLanguages = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
] as const;

export async function main(adapters?: Adapter[]) {
  let parsed;
  let interaction: InteractionSession | undefined;
  let presentationLocale: Locale = "en";
  try {
    parsed = parse(process.argv.slice(2));
    let parts = [...parsed.path];
    const { flags, rawOptions } = parsed;
    let commandFlags = { ...flags, ...commandOptionFlags(rawOptions) };
    const agent = detectAgent();
    const showWordmark = shouldShowWordmark({
      stdoutIsTTY: stdout.isTTY,
      agentDetected: Boolean(agent),
      agentMode: flags.agent === true,
    });
    const interactive = (locale: Locale, helpPath: string[]) => {
      const decision = interactionDecision({
        agent,
        agentMode: flags.agent === true,
        json: flags.json,
        jsonl: flags.jsonl,
        stdinIsTTY: stdin.isTTY,
        stdoutIsTTY: stdout.isTTY,
      });
      if (!decision.allowed) {
        const kind =
          decision.reason === "agent"
            ? "AGENT_INTERACTION_UNSUPPORTED"
            : decision.reason === "machine-output"
              ? "INTERACTIVE_MACHINE_OUTPUT_UNSUPPORTED"
              : "INTERACTIVE_TERMINAL_REQUIRED";
        throw new BenchPilotError(
          kind,
          2,
          t(
            locale,
            decision.reason === "agent"
              ? "cli.interaction.agent"
              : decision.reason === "machine-output"
                ? "cli.interaction.machine"
                : "cli.interaction.terminal",
          ),
          false,
          undefined,
          [],
          { help: fullHelp(helpPath) },
        );
      }
      interaction ??= new InteractionSession(
        locale,
        undefined,
        colorEnabled(flags, stdout.isTTY),
      );
      return interaction;
    };
    const currentPresentationView = (help = flags.help === true) =>
      presentationView({
        help,
        agentDetected: Boolean(agent),
        agentMode: flags.agent === true,
      });
    const present = (
      nodes: Parameters<typeof writePresentation>[0]["nodes"],
      view: ReturnType<typeof currentPresentationView>,
    ) =>
      writePresentation({
        nodes,
        flags,
        locale: presentationLocale,
        view,
      });
    const loadPresentationLocale = async () => {
      const locale = await readProjectLocale({
        cwd: process.cwd(),
        configPath: flags.config as string | undefined,
      });
      presentationLocale = locale;
      return locale;
    };
    if (flags.version) {
      const locale = await loadPresentationLocale();
      if (flags.help) {
        present(
          commandHelpPage(
            ["version"],
            locale,
            colorEnabled(flags, stdout.isTTY),
          ),
          currentPresentationView(),
        );
        return;
      }
      const value = { cliVersion: version, nodeVersion: process.version };
      present(
        versionPage(value, colorEnabled(flags, stdout.isTTY), showWordmark),
        currentPresentationView(false),
      );
      return;
    }
    if (parts[0] === "help") {
      const locale = await loadPresentationLocale();
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
      if (
        target.length === 0 ||
        (target.length === 1 && target[0] === "version")
      ) {
        present(
          commandHelpPage(target, locale, colorEnabled(flags, stdout.isTTY)),
          currentPresentationView(true),
        );
        return;
      }
      const h = fullHelp(target);
      write(h, flags, humanFull(target, locale));
      return;
    }
    const target = parts.length ? parts : [];
    if (flags.help && parts[0] !== "device") {
      const locale = await loadPresentationLocale();
      if (
        target.length === 0 ||
        (target.length === 1 && target[0] === "version")
      ) {
        present(
          commandHelpPage(target, locale, colorEnabled(flags, stdout.isTTY)),
          currentPresentationView(),
        );
        return;
      }
      const h = fullHelp(target);
      write(h, flags, humanFull(target, locale));
      return;
    }
    if (!parts.length) {
      const locale = await loadPresentationLocale();
      present(
        rootHelpPage(
          locale,
          colorEnabled(flags, stdout.isTTY),
          showWordmark,
          currentPresentationView(false) === "agent" ? "agent" : "normal",
        ),
        currentPresentationView(false),
      );
      return;
    }
    if (parts[0] === "home") {
      if (parts.length !== 1)
        fail("USAGE_ERROR", 2, "The home command takes no arguments.");
      const locale = await loadPresentationLocale();
      const decision = interactionDecision({
        agent,
        agentMode: flags.agent === true,
        json: flags.json,
        jsonl: flags.jsonl,
        stdinIsTTY: stdin.isTTY,
        stdoutIsTTY: stdout.isTTY,
      });
      if (!decision.allowed) {
        present(
          rootHelpPage(
            locale,
            colorEnabled(flags, stdout.isTTY),
            showWordmark,
            currentPresentationView(false) === "agent" ? "agent" : "normal",
          ),
          currentPresentationView(false),
        );
        return;
      }
      writeText(
        renderInteractiveHomeHeader(
          locale,
          colorEnabled(flags, stdout.isTTY),
          showWordmark,
        ),
      );
      interaction ??= new InteractionSession(
        locale,
        undefined,
        colorEnabled(flags, stdout.isTTY),
      );
      const command = await interaction.choose(
        rootMenuChoices(locale, colorEnabled(flags, stdout.isTTY)),
        {
          pageSize: 100,
          searchable: true,
        },
      );
      if (command === "help") {
        write(
          fullHelp([]),
          flags,
          brief(
            "root",
            locale,
            colorEnabled(flags, stdout.isTTY),
            showWordmark,
          ),
        );
        return;
      }
      if (command === "version") {
        const value = { cliVersion: version, nodeVersion: process.version };
        write(
          value,
          flags,
          renderVersion(value, colorEnabled(flags, stdout.isTTY), showWordmark),
        );
        return;
      }
      parts = [command];
    }
    if (parts[0] === "version") {
      if (parts.length !== 1)
        fail("USAGE_ERROR", 2, "The version command takes no arguments.");
      const locale = await loadPresentationLocale();
      const value = { cliVersion: version, nodeVersion: process.version };
      present(
        versionPage(value, colorEnabled(flags, stdout.isTTY), showWordmark),
        currentPresentationView(false),
      );
      return;
    }
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
          agent,
          agentMode: flags.agent === true,
          json: flags.json,
          jsonl: flags.jsonl,
          stdinIsTTY: stdin.isTTY,
          stdoutIsTTY: stdout.isTTY,
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
            locale: initLocale,
            projectId,
            projectName,
            color: colorEnabled(flags, stdout.isTTY),
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
      presentationLocale = input.locale;
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
      nodeVersion: process.versions.node,
      eventWriter: flags.jsonl ? new EventWriter(stdout) : undefined,
    });
    const {
      config,
      runtime,
      runtimeCommands,
      queries,
      devices,
      systems,
      configurationCommands,
      catalog,
    } = scope;
    const configuredLocale = (config.value.cli as Json | undefined)?.locale;
    const locale = isLocale(configuredLocale) ? configuredLocale : "en";
    presentationLocale = locale;
    if (parts[0] === "language") {
      const globalLayer = config.layers.find(
        (layer) => layer.scope === "global",
      );
      const globalLocale = (globalLayer?.value.cli as Json | undefined)?.locale;
      const current = isLocale(globalLocale) ? globalLocale : "en";
      if (parts.length === 1) {
        const session = interactive(locale, ["language"]);
        parts.push(
          await session.choose([
            { value: "list", label: t(locale, "menu.action.list") },
            { value: "get", label: t(locale, "menu.action.get") },
            { value: "set", label: t(locale, "menu.action.set") },
          ]),
        );
      }
      if (parts[1] === "set" && parts.length === 2)
        parts.push(
          await interactive(locale, ["language", "set"]).choose(
            supportedLanguages,
          ),
        );
      const action = parts[1];
      if (!action || !["list", "get", "set"].includes(action))
        fail("USAGE_ERROR", 2, "language expects list, get, or set <locale>.");
      if (action === "list") {
        if (parts.length !== 2)
          fail("USAGE_ERROR", 2, "language list takes no arguments.");
        write(
          { languages: supportedLanguages },
          flags,
          `${supportedLanguages.map(({ value, label }) => `${value.padEnd(7)} ${label}`).join("\n")}\n`,
        );
        return;
      }
      if (action === "get") {
        if (parts.length !== 2)
          fail("USAGE_ERROR", 2, "language get takes no arguments.");
        write({ language: current }, flags, `${current}\n`);
        return;
      }
      if (parts.length !== 3)
        fail("USAGE_ERROR", 2, "language set requires <locale>.");
      const requested = parts[2];
      if (!isLocale(requested))
        fail("USAGE_ERROR", 2, `Unsupported CLI language: ${requested}.`);
      await configurationCommands.execute({
        action: "set",
        key: "cli.locale",
        value: requested,
        scopes: ["global"],
      });
      write({ language: requested }, flags, `${requested}\n`);
      return;
    }
    const menuActionKeys = {
      get: "menu.action.get",
      set: "menu.action.set",
      unset: "menu.action.unset",
      resolved: "menu.action.resolved",
      explain: "menu.action.explain",
      validate: "menu.action.validate",
      list: "menu.action.list",
      prune: "menu.action.prune",
      scan: "menu.action.scan",
      "clear-stale": "menu.action.clear-stale",
      doctor: "menu.action.doctor",
      show: "menu.action.show",
      logs: "menu.action.logs",
      artifacts: "menu.action.artifacts",
      clear: "menu.action.clear",
      inspect: "menu.action.inspect",
      approve: "menu.action.approve",
      reject: "menu.action.reject",
    } as const satisfies Record<string, MessageKey>;
    const menuChoices = (values: readonly (keyof typeof menuActionKeys)[]) =>
      values.map((value) => ({
        value,
        label: t(locale, menuActionKeys[value]),
      }));
    const chooseExistingConfigurationKey = async (
      session: InteractionSession,
    ) => {
      const keys = queries.configurationKeys().keys;
      if (!keys.length)
        fail("CONFIG_KEY_NOT_FOUND", 3, "No configured keys are available.");
      return session.choose(keys.map((value) => ({ value })));
    };
    const completeConfigSet = async (session: InteractionSession) => {
      const keyMode = await session.choose([
        { value: "existing", label: t(locale, "menu.config.existing") },
        { value: "new", label: t(locale, "menu.config.new") },
      ]);
      return [
        keyMode === "existing"
          ? await chooseExistingConfigurationKey(session)
          : await session.value(t(locale, "menu.field.key")),
        await session.value(t(locale, "menu.field.value")),
      ];
    };
    if (isCommandGroup(parts[0]) && parts.length === 1) {
      const session = interactive(locale, parts);
      const group = parts[0];
      if (group === "config") {
        const sub = await session.choose(
          menuChoices([
            "get",
            "set",
            "unset",
            "resolved",
            "explain",
            "validate",
          ]),
        );
        parts.push(sub);
        if (["get", "unset", "explain"].includes(sub))
          parts.push(await chooseExistingConfigurationKey(session));
        if (sub === "set") parts.push(...(await completeConfigSet(session)));
      } else if (group === "run") {
        const sub = await session.choose(menuChoices(["list", "prune"]));
        parts.push(sub);
        if (sub === "prune") {
          const mode = await session.choose([
            { value: "keep", label: t(locale, "menu.runs.keep") },
            {
              value: "older-than",
              label: t(locale, "menu.runs.older-than"),
            },
            { value: "all", label: t(locale, "menu.runs.all") },
          ]);
          if (mode === "all")
            commandFlags = {
              ...commandFlags,
              "dangerously-remove-all-runs": true,
            };
          else
            commandFlags = {
              ...commandFlags,
              [mode]: await session.value(mode),
            };
        }
      } else if (group === "adapter") {
        const adapters = queries.listAdapters().adapters;
        if (!adapters.length)
          fail("ADAPTER_NOT_FOUND", 3, "No adapters are available.");
        const id = await session.choose(
          adapters.map((adapter) => ({
            value: adapter.id,
            label: `${adapter.id} — ${adapter.summary}`,
          })),
        );
        parts.push(id, await session.choose(menuChoices(["show", "doctor"])));
      } else if (group === "device") {
        const deviceNodes = await catalog.children(["device"]);
        if (!deviceNodes.length)
          fail("DEVICE_NOT_FOUND", 3, "No configured devices are available.");
        const id = await session.choose(
          deviceNodes.map((device) => ({
            value: String(device.path[1]),
            label: String(device.summaryKey),
          })),
        );
        const capabilities = await catalog.children(["device", id]);
        parts.push(
          id,
          await session.choose(
            capabilities.map((capability) => ({
              value: String(capability.path[2]),
              label: `${capability.path[2]} — ${capability.summaryKey}`,
            })),
          ),
        );
      } else if (group === "system") {
        const systemNodes = await catalog.children(["system"]);
        if (!systemNodes.length)
          fail("SYSTEM_NOT_FOUND", 3, "No configured systems are available.");
        const id = await session.choose(
          systemNodes.map((system) => ({
            value: String(system.path[1]),
            label: String(system.summaryKey),
          })),
        );
        const capabilities = await catalog.children(["system", id]);
        parts.push(
          id,
          await session.choose(
            capabilities.map((capability) => ({
              value: String(capability.path[2]),
              label: `${capability.path[2]} — ${capability.summaryKey}`,
            })),
          ),
        );
      } else if (group === "lock") {
        const locks = await runtime.listLocks();
        if (!locks.locks.length)
          fail("LOCK_NOT_FOUND", 3, "No locks are available.");
        parts.push(
          await session.choose(
            locks.locks.map((lock) => ({
              value: lock.lockId,
              label: lock.lockId,
            })),
          ),
          await session.choose(menuChoices(["show", "clear"])),
        );
      } else if (group === "approval") {
        const approvals = await runtime.listApprovals();
        if (!approvals.approvals.length)
          fail("APPROVAL_NOT_FOUND", 3, "No approvals are available.");
        parts.push(
          await session.choose(
            approvals.approvals.map((approval) => ({
              value: approval.id,
              label: `${approval.id} — ${approval.status}`,
            })),
          ),
          await session.choose(menuChoices(["inspect", "approve", "reject"])),
        );
      }
    }
    // A known parent plus an omitted action is an incomplete command. Continue
    // the same interactive flow instead of degrading to a static help screen.
    if (
      !flags.help &&
      parts[0] === "config" &&
      parts.length === 2 &&
      ["get", "unset", "explain", "set"].includes(parts[1]!)
    ) {
      const session = interactive(locale, parts);
      if (["get", "unset", "explain"].includes(parts[1]!))
        parts.push(await chooseExistingConfigurationKey(session));
      else if (parts[1] === "set")
        parts.push(...(await completeConfigSet(session)));
    }
    if (
      !flags.help &&
      parts[0] === "adapter" &&
      parts.length === 2 &&
      parts[1] !== "list"
    )
      parts.push(
        await interactive(locale, parts).choose(
          menuChoices(["show", "doctor"]),
        ),
      );
    if (
      !flags.help &&
      parts[0] === "device" &&
      parts.length === 2 &&
      !["list", "scan"].includes(parts[1]!)
    ) {
      const session = interactive(locale, parts);
      const capabilities = await catalog.children(["device", parts[1]!]);
      if (!capabilities.length)
        fail(
          "UNSUPPORTED_CAPABILITY",
          3,
          "No device capabilities are available.",
        );
      parts.push(
        await session.choose(
          capabilities.map((capability) => ({
            value: String(capability.path[2]),
            label: `${capability.path[2]} — ${capability.summaryKey}`,
          })),
        ),
      );
    }
    if (
      !flags.help &&
      parts[0] === "system" &&
      parts.length === 2 &&
      parts[1] !== "list"
    ) {
      const session = interactive(locale, parts);
      const capabilities = await catalog.children(["system", parts[1]!]);
      if (!capabilities.length)
        fail(
          "SYSTEM_CAPABILITY_UNAVAILABLE",
          3,
          "No system capabilities are available.",
        );
      parts.push(
        await session.choose(
          capabilities.map((capability) => ({
            value: String(capability.path[2]),
            label: `${capability.path[2]} — ${capability.summaryKey}`,
          })),
        ),
      );
    }
    if (
      !flags.help &&
      parts[0] === "run" &&
      parts.length === 2 &&
      !["list", "prune"].includes(parts[1]!)
    )
      parts.push(
        await interactive(locale, parts).choose(
          menuChoices(["show", "logs", "artifacts"]),
        ),
      );
    if (
      !flags.help &&
      parts[0] === "lock" &&
      parts.length === 2 &&
      !["list", "clear-stale"].includes(parts[1]!)
    )
      parts.push(
        await interactive(locale, parts).choose(menuChoices(["show", "clear"])),
      );
    if (
      !flags.help &&
      parts[0] === "approval" &&
      parts.length === 2 &&
      parts[1] !== "list"
    )
      parts.push(
        await interactive(locale, parts).choose(
          menuChoices(["inspect", "approve", "reject"]),
        ),
      );
    if (parts[0] === "config") {
      if (parts.length === 1) {
        write(fullHelp(["config"]), flags, brief("config", locale));
        return;
      }
      const outcome = await configurationCommands.execute({
        action: parts[1]!,
        key: parts[2],
        value: parts[3],
        scopes: ["local", "project", "global"].filter(
          (scope) => commandFlags[scope],
        ) as Array<"local" | "project" | "global">,
        showOrigin: commandFlags["show-origin"] === true,
      });
      const value = outcome.data as { value?: unknown };
      write(
        outcome.data,
        flags,
        outcome.kind === "config.get"
          ? String(value.value)
          : outcome.kind === "config.validate"
            ? "Configuration is valid."
            : undefined,
      );
      return;
    }
    if (parts[0] === "doctor") {
      if (commandFlags.save) {
        /* doctor is intentionally read-only unless explicit save; its diagnostics are returned */
      }
      const result = await queries.doctor();
      write(
        result,
        flags,
        result.checks
          .map(
            (check) =>
              `${String(check.status)}: ${String(check.id)} — ${String(check.message)}`,
          )
          .join("\n"),
      );
      return;
    }
    if (parts[0] === "adapter" && parts[1] === "list") {
      write(queries.listAdapters(), flags);
      return;
    }
    if (parts[0] === "adapter" && parts[1] && parts[1] !== "list") {
      const adapter = queries.adapterInfo(parts[1]);
      if (parts.length === 2) {
        write(
          fullHelp(["adapter"]),
          flags,
          `benchpilot adapter ${adapter.id} — ${adapter.summary}\n\nCommands: show, doctor\n`,
        );
        return;
      }
      if (parts[2] === "show") write(adapter, flags);
      else if (parts[2] === "doctor")
        write(await queries.adapterDoctor(parts[1]), flags);
      else fail("USAGE_ERROR", 2, "Unknown adapter command.");
      return;
    }
    if (parts[0] === "device" && ["list", "scan"].includes(parts[1]!)) {
      if (parts.length !== 2)
        fail("USAGE_ERROR", 2, `device ${parts[1]} takes no arguments.`);
      if (parts[1] === "list") {
        write(queries.listConfiguredDevices(), flags);
        return;
      }
      if (parts[1] === "scan") {
        write(
          await queries.scanDevices(
            commandFlags.adapter === undefined
              ? undefined
              : String(commandFlags.adapter),
            commandFlags.probe === true ||
              commandFlags["confirm-device-probe"] === true,
          ),
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
        devices,
        catalog,
        locale,
      })
    )
      return;
    if (parts[0] === "system" && parts[1] === "list") {
      if (parts.length !== 2)
        fail("USAGE_ERROR", 2, "system list takes no arguments.");
      write(queries.listSystems(), flags);
      return;
    }
    if (parts[0] === "system" && parts[1] && parts[1] !== "list") {
      const system = await systems.describe(parts[1]);
      if (parts.length === 2) {
        write(
          fullHelp(["system"]),
          flags,
          `benchpilot system ${parts[1]} — Configured system\n\nCommands:\n${system.capabilities.map((capability) => `  ${capability.id}`).join("\n")}\n`,
        );
        return;
      }
      await catalog.executable(["system", parts[1], parts[2]]);
      const definition = await systems.capability(parts[1], parts[2]);
      const input = capabilityInput(
        rawOptions,
        definition.options || [],
        definition.safety.flag,
        parts.slice(3),
      );
      if (definition.safety.mode !== "normal" && definition.safety.flag)
        flags[definition.safety.flag] = optionEnabled(
          rawOptions,
          definition.safety.flag,
        );
      const result = await systems.execute(parts[1], parts[2], input);
      if (!flags.jsonl) write(result, flags);
      return;
    }
    // Approval confirmation is intrinsically human-only. Check this before
    // loading a record so an agent cannot use record validity as an oracle.
    if (parts[0] === "approval" && parts[1] && parts[2] === "approve")
      interactive(locale, parts);
    if (
      await handleRuntimeCommand({
        parts,
        flags,
        commandFlags,
        runtimeCommands,
        readApprovalChallenge: async ({ approvalId, physicalId }) =>
          interactive(locale, ["approval", approvalId, "approve"]).value(
            `physical device ID (${physicalId})`,
          ),
      })
    )
      return;
    fail("UNKNOWN_COMMAND", 2, `Unknown command: ${parts.join(" ")}`);
  } catch (e: unknown) {
    if (e instanceof InteractionExitedError) return;
    if (e instanceof InteractionBackError) return main(adapters);
    const err =
      e instanceof InteractionCancelledError
        ? new BenchPilotError(
            "INTERACTION_CANCELLED",
            130,
            t(presentationLocale, "cli.interaction.cancelled"),
          )
        : e instanceof BenchPilotError
          ? e
          : new BenchPilotError("INTERNAL_ERROR", 8, (e as Error).message);
    const flags = parsed?.flags || {};
    const result = (err as BenchPilotError & { result?: Json }).result || {
      schema: "benchpilot.result",
      version: 2,
      ok: false,
      kind: err.kind,
      diagnosticId: err.diagnosticId,
      message: err.message,
      retryable: err.retryable,
      stage: err.stage,
      recovery: err.recovery,
      details: err.details,
    };
    const needsHelp = [
      "AGENT_INTERACTION_UNSUPPORTED",
      "INTERACTIVE_MACHINE_OUTPUT_UNSUPPORTED",
      "INTERACTIVE_TERMINAL_REQUIRED",
    ].includes(err.kind);
    writeFailure({
      result,
      flags,
      isOperation: ["device", "system"].includes(parsed?.path[0] || ""),
      terminalEmitted: Boolean(
        (err as BenchPilotError & { jsonlTerminalEmitted?: boolean })
          .jsonlTerminalEmitted,
      ),
      humanMessage: `${err.kind}: ${humanErrorMessage(
        presentationLocale,
        err.kind,
        err.message,
      )}`,
      ...(needsHelp
        ? {
            help: humanFull(
              ((err.details as { help?: { path?: string[] } } | undefined)?.help
                ?.path || []) as string[],
              presentationLocale,
            ),
          }
        : {}),
    });
    process.exitCode = err.exitCode;
  } finally {
    interaction?.close();
  }
}
if (process.env.BENCHPILOT_NO_AUTORUN !== "1") void main();
