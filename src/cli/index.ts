#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import {
  Adapter,
  approvalLevel,
  BenchPilotError,
  EventWriter,
  fail,
  Json,
  requiresApproval,
} from "../core.js";
import { loadBuiltinAdapters } from "../adapters/runtime/builtin-adapters.js";
import { createApplication } from "../application/application.js";
import { openApplicationRequest } from "../application/request-scope.js";
import {
  readGlobalLocale,
  readGlobalLocaleSetting,
  writeGlobalLocale,
} from "../application/config/locale.js";
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
  writeDataPage,
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
import {
  colorEnabled,
  shouldShowWordmark,
  terminalTheme,
} from "./presentation/theme.js";
import {
  InteractionCancelledError,
  InteractionBackError,
  InteractionExitedError,
  InteractionSession,
  menuDivider,
  promptInit,
} from "./interaction/prompter.js";
import { isLocale, t, type Locale, type MessageKey } from "../i18n/index.js";
import {
  checkForUpgrade,
  compareUpgradeVersion,
  upgradeBenchPilot,
} from "./upgrade.js";
import { upgradeCheckDataPage, upgradeResultDataPage } from "./data/upgrade.js";
import { doctorDataPage } from "./data/doctor.js";
import {
  adapterDoctorDataPage,
  adapterInfoDataPage,
  adapterListDataPage,
} from "./data/adapter.js";
import {
  deviceAddedDataPage,
  deviceListDataPage,
  deviceRemovedDataPage,
  deviceScanDataPage,
  systemDetailDataPage,
  systemListDataPage,
  systemOperationDataPage,
} from "./data/resource.js";
import {
  configExplainDataPage,
  configGetDataPage,
  configMutationDataPage,
  configResolvedDataPage,
  configValidateDataPage,
} from "./data/config.js";
import { initDataPage } from "./data/init.js";
import {
  configurationCatalogEntry,
  configurationMenuChoices,
  configurationValueMenuChoices,
  type ConfigurationCatalogEntry,
} from "./config-catalog.js";

const version = "0.0.0";
const supportedLanguages = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
] as const;

const displayWidth = (value: string) =>
  [...value].reduce(
    (width, character) => width + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );

const padDisplay = (value: string, width: number) =>
  `${value}${" ".repeat(Math.max(1, width - displayWidth(value)))}`;

const recordChoiceWidth = (ids: readonly string[]) =>
  Math.max(1, ...ids.map((id) => displayWidth(id) + 2));

const recordChoiceLabel = (id: string, status: string, width: number) =>
  `${padDisplay(id, width)}— ${status}`;

const approvalStatusLabel = (locale: Locale, status: string) => {
  if (status === "pending") return t(locale, "approval.status.pending");
  if (status === "approved") return t(locale, "approval.status.approved");
  if (status === "rejected") return t(locale, "approval.status.rejected");
  if (status === "claimed") return t(locale, "approval.status.claimed");
  if (status === "consumed") return t(locale, "approval.status.consumed");
  return status;
};

const runStatusLabel = (locale: Locale, status: unknown) => {
  if (status === "running") return t(locale, "run.status.running");
  if (status === "succeeded") return t(locale, "run.status.succeeded");
  if (status === "failed") return t(locale, "run.status.failed");
  if (status === "aborted") return t(locale, "run.status.aborted");
  return t(locale, "run.status.unknown");
};

const lockStatusLabel = (locale: Locale, state: unknown, liveness: unknown) => {
  if (state === "quarantined")
    return t(locale, "lock.detail.state.quarantined");
  if (state === "quarantine-failed")
    return t(locale, "lock.detail.state.quarantineFailed");
  const status = liveness;
  if (status === "active") return t(locale, "lock.list.liveness.active");
  if (status === "stale") return t(locale, "lock.list.liveness.stale");
  return t(locale, "lock.list.liveness.unknown");
};

interface MainResume {
  readonly path: readonly string[];
  readonly flags: ReturnType<typeof parse>["flags"];
  readonly rawOptions: ReturnType<typeof parse>["rawOptions"];
  readonly backPaths?: readonly (readonly string[])[];
  readonly ignoreHomeEscape?: boolean;
}

export async function main(adapters?: Adapter[], resume?: MainResume) {
  let interaction: InteractionSession | undefined;
  let presentationLocale: Locale = "en";
  let replay: Omit<MainResume, "path"> | undefined;
  let invokedPath: readonly string[] = [];
  let selectedCommandEmitted = false;
  let renderAdapterDoctor: ((adapterId: string) => Promise<void>) | undefined;
  try {
    const parsed = resume ?? parse(process.argv.slice(2));
    let parts = [...parsed.path];
    const { flags, rawOptions } = parsed;
    replay = { flags, rawOptions };
    invokedPath = parts;
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
        resume?.backPaths,
      );
      return interaction;
    };
    const writeSelectedCommand = () => {
      if (!interaction || selectedCommandEmitted) return;
      selectedCommandEmitted = true;
      const configScope =
        parts[0] === "config"
          ? ["local", "project", "global"].find(
              (scope) => commandFlags[scope] === true,
            )
          : undefined;
      const deviceAddOptions =
        parts[0] === "device" &&
        parts[1] === "add" &&
        typeof commandFlags.adapter === "string" &&
        typeof commandFlags.identity === "string"
          ? ` --adapter ${commandFlags.adapter} --identity ${commandFlags.identity}${typeof commandFlags.port === "string" ? ` --port ${commandFlags.port}` : ""}${typeof commandFlags.name === "string" ? ` --name ${commandFlags.name}` : ""}`
          : "";
      writeText(
        `${terminalTheme(colorEnabled(flags, stdout.isTTY)).debug(`$ benchpilot ${parts.join(" ")}${configScope ? ` --${configScope}` : ""}${deviceAddOptions}`)}\n\n`,
      );
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
      const locale = await readGlobalLocale();
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
        versionPage(
          value,
          colorEnabled(flags, stdout.isTTY),
          showWordmark,
          stdout.columns,
        ),
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
      present(
        commandHelpPage(target, locale, colorEnabled(flags, stdout.isTTY)),
        currentPresentationView(true),
      );
      return;
    }
    const target = parts.length ? parts : [];
    if (flags.help && (parts[0] !== "device" || parts.length === 1)) {
      const locale = await loadPresentationLocale();
      present(
        commandHelpPage(target, locale, colorEnabled(flags, stdout.isTTY)),
        currentPresentationView(),
      );
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
    if (parts[0] === "upgrade") {
      const locale = await loadPresentationLocale();
      if (parts.length > 2)
        fail("USAGE_ERROR", 2, "upgrade accepts check, latest, or a version.");
      const info = await checkForUpgrade(process.argv[1] || "");
      if (parts.length === 1) {
        if (!info.updateAvailable) {
          writeDataPage({
            page: upgradeCheckDataPage(info),
            flags,
            locale,
            view: currentPresentationView(),
            color: colorEnabled(flags, stdout.isTTY),
          });
          return;
        }
        const selected = await interactive(locale, ["upgrade"]).choose(
          info.versions
            .filter(
              (candidate) =>
                compareUpgradeVersion(candidate, info.currentVersion) > 0,
            )
            .map((candidate, index) => ({
              value: candidate,
              label: index === 0 ? `${candidate} — 最新` : candidate,
            })),
          { commandPath: ["upgrade"], nextBackPath: ["upgrade"] },
        );
        writeSelectedCommand();
        const result = await upgradeBenchPilot(info, selected);
        writeDataPage({
          page: upgradeResultDataPage(result),
          flags,
          locale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
        return;
      }
      if (parts[1] === "check") {
        writeDataPage({
          page: upgradeCheckDataPage(info),
          flags,
          locale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
        return;
      }
      const requested = parts[1]!;
      const targetVersion =
        requested === "latest" ? info.latestVersion : requested;
      if (!targetVersion)
        fail(
          "UPGRADE_VERSION_NOT_FOUND",
          2,
          "No published version is available.",
        );
      const result = await upgradeBenchPilot(info, targetVersion!);
      writeDataPage({
        page: upgradeResultDataPage(result),
        flags,
        locale,
        view: currentPresentationView(),
        color: colorEnabled(flags, stdout.isTTY),
      });
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
        resume?.backPaths,
      );
      const command = await interaction.choose(
        rootMenuChoices(locale, colorEnabled(flags, stdout.isTTY)),
        {
          pageSize: 100,
          searchable: true,
          commandPath: [],
          ignoreInitialEscape: resume?.ignoreHomeEscape === true,
          nextBackPath: ["home"],
        },
      );
      if (command === "help") {
        writeSelectedCommand();
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
        writeSelectedCommand();
        const value = { cliVersion: version, nodeVersion: process.version };
        write(
          value,
          flags,
          renderVersion(
            value,
            colorEnabled(flags, stdout.isTTY),
            showWordmark,
            stdout.columns,
          ),
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
        versionPage(
          value,
          colorEnabled(flags, stdout.isTTY),
          showWordmark,
          stdout.columns,
        ),
        currentPresentationView(false),
      );
      return;
    }
    if (parts[0] === "init") {
      const suppliedLocale = commandFlags.locale;
      if (commandFlags["project-id"] !== undefined)
        fail(
          "USAGE_ERROR",
          2,
          "init generates the project ID automatically; omit --project-id.",
        );
      const persistedLocale = await readGlobalLocaleSetting();
      const requestedLocale = isLocale(suppliedLocale)
        ? suppliedLocale
        : undefined;
      const initLocale: Locale = persistedLocale ?? requestedLocale ?? "en";
      const projectName =
        typeof commandFlags["project-name"] === "string"
          ? String(commandFlags["project-name"])
          : undefined;
      const app = createApplication([]);
      if (await app.hasProjectConfig(process.cwd())) {
        presentationLocale = initLocale;
        writeSelectedCommand();
        const result = await app.initializeProject({
          cwd: process.cwd(),
          projectName: "",
          enabledAdapters: [],
        });
        writeDataPage({
          page: initDataPage(result),
          flags,
          locale: initLocale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
        return;
      }
      let input =
        projectName && (persistedLocale || requestedLocale)
          ? {
              projectName,
              locale: persistedLocale ?? requestedLocale!,
              enabledAdapters: [] as string[],
            }
          : undefined;
      const decision = interactionDecision({
        agent,
        agentMode: flags.agent === true,
        json: flags.json,
        jsonl: flags.jsonl,
        stdinIsTTY: stdin.isTTY,
        stdoutIsTTY: stdout.isTTY,
      });
      if (!input || decision.allowed) {
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
          const session = interactive(initLocale, ["init"]);
          const available = adapters ?? (await loadBuiltinAdapters());
          const theme = terminalTheme(colorEnabled(flags, stdout.isTTY));
          input = await promptInit({
            locale: initLocale,
            projectName,
            adapters: available.map((adapter) => ({
              value: adapter.id,
              label: `${theme.command(adapter.id)}  ${adapter.summary}`,
            })),
            color: colorEnabled(flags, stdout.isTTY),
            session,
            selectedLocale: persistedLocale ?? requestedLocale,
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
      writeSelectedCommand();
      const result = await app.initializeProject({
        cwd: process.cwd(),
        projectName: input.projectName,
        enabledAdapters: input.enabledAdapters,
      });
      if (!persistedLocale) await writeGlobalLocale({ locale: input.locale });
      writeDataPage({
        page: initDataPage(result),
        flags,
        locale: input.locale,
        view: currentPresentationView(),
        color: colorEnabled(flags, stdout.isTTY),
      });
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
    const globalLayer = config.layers.find((layer) => layer.scope === "global");
    const configuredLocale = (globalLayer?.value.cli as Json | undefined)
      ?.locale;
    const locale = isLocale(configuredLocale) ? configuredLocale : "en";
    presentationLocale = locale;
    const canConfirmOperationInteractively =
      !flags.agent &&
      !agent &&
      !flags.json &&
      !flags.jsonl &&
      stdin.isTTY &&
      stdout.isTTY;
    const commandChoice = (
      command: string,
      summary: string,
      width = command.length,
    ) =>
      `${terminalTheme(colorEnabled(flags, stdout.isTTY)).command(command.padEnd(width))}  ${summary}`;
    const commandChoices = (
      entries: readonly { value: string; summary: string }[],
    ) => {
      const width = Math.max(...entries.map((entry) => entry.value.length));
      return entries.map((entry) => ({
        value: entry.value,
        label: commandChoice(entry.value, entry.summary, width),
      }));
    };
    renderAdapterDoctor = async (adapterId) => {
      writeText(
        `\n${terminalTheme(colorEnabled(flags, stdout.isTTY)).debug(`$ benchpilot adapter ${adapterId} doctor`)}\n\n`,
      );
      writeDataPage({
        page: adapterDoctorDataPage(
          await queries.adapterDoctor(adapterId, presentationLocale),
        ),
        flags,
        locale: presentationLocale,
        view: "normal",
        color: colorEnabled(flags, stdout.isTTY),
      });
    };
    if (parts[0] === "language") {
      const globalLayer = config.layers.find(
        (layer) => layer.scope === "global",
      );
      const globalLocale = (globalLayer?.value.cli as Json | undefined)?.locale;
      const current = isLocale(globalLocale) ? globalLocale : "en";
      if (parts.length === 1) {
        const session = interactive(locale, ["language"]);
        parts.push(
          await session.choose(
            commandChoices([
              { value: "list", summary: t(locale, "menu.action.list") },
              { value: "get", summary: t(locale, "menu.action.get") },
              { value: "set", summary: t(locale, "menu.action.set") },
            ]),
            { commandPath: ["language"], nextBackPath: ["language"] },
          ),
        );
      }
      if (parts[1] === "set" && parts.length === 2)
        parts.push(
          await interactive(locale, ["language", "set"]).choose(
            supportedLanguages,
            { commandPath: ["language", "set"] },
          ),
        );
      const action = parts[1];
      if (!action || !["list", "get", "set"].includes(action))
        fail("USAGE_ERROR", 2, "language expects list, get, or set <locale>.");
      writeSelectedCommand();
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
      add: "menu.action.add",
      remove: "menu.action.remove",
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
      create: "menu.action.create",
      delete: "menu.action.delete",
      member: "menu.action.member",
    } as const satisfies Record<string, MessageKey>;
    const menuChoices = (values: readonly (keyof typeof menuActionKeys)[]) =>
      commandChoices(
        values.map((value) => ({
          value,
          summary: t(locale, menuActionKeys[value]),
        })),
      );
    const chooseConfigurationKey = async (
      session: InteractionSession,
      commandPath: readonly string[],
    ) =>
      session.choose(
        configurationMenuChoices(locale, colorEnabled(flags, stdout.isTTY)),
        { commandPath },
      );
    const configurationScopeMessages = {
      local: {
        name: "configCatalog.scope.local.name",
        description: "configCatalog.scope.local.description",
      },
      project: {
        name: "configCatalog.scope.project.name",
        description: "configCatalog.scope.project.description",
      },
      global: {
        name: "configCatalog.scope.global.name",
        description: "configCatalog.scope.global.description",
      },
    } as const satisfies Record<
      "local" | "project" | "global",
      { name: MessageKey; description: MessageKey }
    >;
    const chooseConfigurationScope = async (
      session: InteractionSession,
      entry: NonNullable<ReturnType<typeof configurationCatalogEntry>>,
    ) => {
      const explicit = ["local", "project", "global"].find(
        (scope) => commandFlags[scope] === true,
      );
      if (explicit) return;
      const scopes = entry.scopes;
      const theme = terminalTheme(colorEnabled(flags, stdout.isTTY));
      const nameWidth = Math.max(
        ...scopes.map((scope) =>
          displayWidth(t(locale, configurationScopeMessages[scope].name)),
        ),
      );
      const scope = await session.choose(
        scopes.map((scope) => ({
          value: scope,
          label: `${theme.command(padDisplay(scope, 7))}  ${padDisplay(t(locale, configurationScopeMessages[scope].name), nameWidth)}  ${theme.muted(t(locale, configurationScopeMessages[scope].description))}`,
        })),
      );
      commandFlags = { ...commandFlags, [scope]: true };
    };
    const completeConfigSet = async (
      session: InteractionSession,
      commandPath: readonly string[],
    ) => {
      const key = await chooseConfigurationKey(session, commandPath);
      const entry = configurationCatalogEntry(key);
      if (!entry) throw new Error(`Unknown configuration key: ${key}`);
      await chooseConfigurationScope(session, entry);
      if (entry.editor === "select") {
        return [
          key,
          await session.choose(
            configurationValueMenuChoices(
              entry,
              locale,
              colorEnabled(flags, stdout.isTTY),
            ),
            { commandPath: [...commandPath, key] },
          ),
        ];
      }
      if (entry.editor === "multi-select") {
        const idWidth = Math.max(
          ...declared.map((adapter) => displayWidth(adapter.id)),
        );
        const theme = terminalTheme(colorEnabled(flags, stdout.isTTY));
        const selected = await session.chooseMany(
          t(locale, "configCatalog.enabledAdapters.prompt"),
          declared.map((adapter) => ({
            value: adapter.id,
            label: `${theme.command(padDisplay(adapter.id, idWidth))}  ${adapter.summary}`,
          })),
        );
        return [key, JSON.stringify(selected)];
      }
      return [key, await session.value(t(locale, "menu.field.value"))];
    };
    const chooseDiscoveredDevice = async (session: InteractionSession) => {
      const discovered = await queries.scanDevices();
      if (!discovered.devices.length)
        fail("DEVICE_NOT_FOUND", 3, "No discoverable devices are available.");
      const candidates = discovered.devices.map((device, index) => {
        const value = device as Record<string, unknown>;
        const fields = value.fields as Record<string, unknown> | undefined;
        const identity = String(value.identity || `device-${index + 1}`);
        const adapter = String(value.adapter || "unknown");
        return {
          index,
          adapter,
          identity,
          port: typeof fields?.port === "string" ? fields.port : "-",
        };
      });
      const adapterWidth = Math.max(
        displayWidth(t(locale, "resourceResult.scan.adapter")),
        ...candidates.map((candidate) => displayWidth(candidate.adapter)),
      );
      const identityWidth = Math.max(
        displayWidth(t(locale, "resourceResult.scan.identity")),
        ...candidates.map((candidate) => displayWidth(candidate.identity)),
      );
      const padColumn = (value: string, width: number) =>
        `${value}${" ".repeat(Math.max(0, width - displayWidth(value)))}`;
      const theme = terminalTheme(colorEnabled(flags, stdout.isTTY));
      const selected = await session.choose(
        candidates.map((candidate) => {
          const { index, adapter, identity, port } = candidate;
          return {
            value: String(index),
            label: `${theme.command(padColumn(adapter, adapterWidth))}  ${theme.argument(padColumn(identity, identityWidth))}  ${port}`,
            description: `${theme.debug(`$ benchpilot device add --adapter ${adapter} --identity ${identity}${port === "-" ? "" : ` --port ${port}`} --name <name>`)}\n`,
          };
        }),
        { commandPath: ["device", "add"] },
      );
      const candidate = discovered.devices[Number(selected)] as Record<
        string,
        unknown
      >;
      const fields = candidate.fields as Record<string, unknown> | undefined;
      const adapter = String(candidate.adapter);
      const identity = String(candidate.identity || `device-${selected}`);
      return {
        identity,
        adapter,
        ...(typeof fields?.port === "string" ? { port: fields.port } : {}),
      };
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
          { commandPath: ["config"], nextBackPath: ["config"] },
        );
        parts.push(sub);
        if (["get", "unset", "explain"].includes(sub)) {
          parts.push(await chooseConfigurationKey(session, parts));
          if (sub === "unset")
            await chooseConfigurationScope(
              session,
              configurationCatalogEntry(parts[2]!)!,
            );
        }
        if (sub === "set")
          parts.push(...(await completeConfigSet(session, parts)));
      } else if (group === "run") {
        const runRecords = await runtime.listRuns();
        const runChoiceWidth = recordChoiceWidth(
          runRecords.runs.map((run) => run.id),
        );
        const selected = await session.choose(
          [
            ...menuChoices(["list", "prune"]),
            ...(runRecords.runs.length
              ? [
                  {
                    separator: menuDivider(colorEnabled(flags, stdout.isTTY)),
                  },
                  ...runRecords.runs.map((run) => ({
                    value: run.id,
                    label: recordChoiceLabel(
                      run.id,
                      runStatusLabel(locale, run.manifest?.status),
                      runChoiceWidth,
                    ),
                  })),
                ]
              : []),
          ],
          {
            commandPath: ["run"],
            nextBackPath: ["run"],
          },
        );
        if (selected !== "list" && selected !== "prune") {
          parts.push(
            selected,
            await session.choose(menuChoices(["show", "logs", "artifacts"]), {
              commandPath: ["run", selected],
            }),
          );
        } else {
          const sub = selected;
          parts.push(sub);
          if (sub === "prune") {
            const mode = await session.choose(
              [
                { value: "keep", label: t(locale, "menu.runs.keep") },
                {
                  value: "older-than",
                  label: t(locale, "menu.runs.older-than"),
                },
                { value: "all", label: t(locale, "menu.runs.all") },
              ],
              { commandPath: ["run", "prune"] },
            );
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
        }
      } else if (group === "adapter") {
        const adapters = queries.listAdapters().adapters;
        const id = await session.choose(
          [
            ...menuChoices(["list"]),
            ...(adapters.length
              ? [
                  { separator: menuDivider(colorEnabled(flags, stdout.isTTY)) },
                  ...adapters.map((adapter) => ({
                    value: adapter.id,
                    label: `${adapter.id} — ${adapter.summary}`,
                  })),
                ]
              : []),
          ],
          { commandPath: ["adapter"], nextBackPath: ["adapter"] },
        );
        parts.push(id);
        if (id !== "list")
          parts.push(
            await session.choose(menuChoices(["show", "doctor"]), {
              commandPath: ["adapter", id],
            }),
          );
      } else if (group === "device") {
        const deviceNodes = await catalog.children(["device"]);
        const id = await session.choose(
          [
            ...menuChoices(["list", "scan", "add", "remove"]),
            ...(deviceNodes.length
              ? [
                  { separator: menuDivider(colorEnabled(flags, stdout.isTTY)) },
                  ...deviceNodes.map((device) => ({
                    value: String(device.path[1]),
                    label: String(device.summaryKey),
                  })),
                ]
              : []),
          ],
          { commandPath: ["device"], nextBackPath: ["device"] },
        );
        if (id === "list" || id === "scan") {
          parts.push(id);
        } else if (id === "add") {
          const device = await chooseDiscoveredDevice(session);
          parts.push(id);
          commandFlags = {
            ...commandFlags,
            adapter: device.adapter,
            identity: device.identity,
            name: await session.value(t(locale, "menu.field.deviceName")),
            ...(device.port !== undefined ? { port: device.port } : {}),
          };
        } else if (id === "remove") {
          const devices = queries.listConfiguredDevices().devices;
          if (!devices.length)
            fail("DEVICE_NOT_FOUND", 3, "No configured devices are available.");
          parts.push(
            id,
            await session.choose(
              devices.map((device) => ({
                value: String((device as Record<string, unknown>).id),
                label: String((device as Record<string, unknown>).id),
              })),
              { commandPath: ["device", "remove"] },
            ),
          );
        } else {
          const capabilities = (await devices.describe(id, locale))
            .capabilities;
          parts.push(
            id,
            await session.choose(
              commandChoices(
                capabilities.map((capability) => ({
                  value: capability.id,
                  summary: capability.summary,
                })),
              ),
              { commandPath: ["device", id] },
            ),
          );
        }
      } else if (group === "system") {
        const systemNodes = await catalog.children(["system"]);
        const id = await session.choose(
          [
            ...menuChoices(["list", "create", "delete"]),
            ...(systemNodes.length
              ? [
                  { separator: menuDivider(colorEnabled(flags, stdout.isTTY)) },
                  ...systemNodes.map((system) => ({
                    value: String(system.path[1]),
                    label: String(system.summaryKey),
                  })),
                ]
              : []),
          ],
          { commandPath: ["system"], nextBackPath: ["system"] },
        );
        if (id === "list") {
          parts.push(id);
        } else if (id === "create") {
          const devices = queries.listConfiguredDevices().devices;
          if (!devices.length)
            fail("DEVICE_NOT_FOUND", 3, "No configured devices are available.");
          const name = await session.value(
            t(locale, "system.detail.id" as never),
          );
          const members = await session.chooseMany(
            t(locale, "system.detail.members" as never),
            devices.map((device) => ({
              value: String((device as Record<string, unknown>).id),
              label: String((device as Record<string, unknown>).id),
            })),
          );
          if (!members.length)
            fail(
              "INVALID_SYSTEM_CONFIG",
              3,
              "A system requires at least one member.",
            );
          parts.push(id, name, ...members);
        } else if (id === "delete") {
          if (!systemNodes.length)
            fail("SYSTEM_NOT_FOUND", 3, "No configured systems are available.");
          parts.push(
            id,
            await session.choose(
              systemNodes.map((system) => ({
                value: String(system.path[1]),
                label: String(system.summaryKey),
              })),
              { commandPath: ["system", "delete"] },
            ),
          );
        } else {
          const capabilities = (await systems.describe(id, locale))
            .capabilities;
          const action = await session.choose(
            [
              ...menuChoices(["show", "member"]),
              ...(capabilities.length
                ? [
                    {
                      separator: menuDivider(colorEnabled(flags, stdout.isTTY)),
                    },
                    ...commandChoices(
                      capabilities.map((capability) => ({
                        value: capability.id,
                        summary: capability.summary,
                      })),
                    ),
                  ]
                : []),
            ],
            { commandPath: ["system", id] },
          );
          if (action === "show") parts.push(id, action);
          else if (action === "member") {
            const operation = await session.choose(
              menuChoices(["add", "remove"]),
              {
                commandPath: ["system", id, "member"],
              },
            );
            const system = await systems.describe(id, locale);
            const candidates =
              operation === "add"
                ? queries
                    .listConfiguredDevices()
                    .devices.filter(
                      (device) =>
                        !system.members.some(
                          (member) =>
                            member.device ===
                            String((device as Record<string, unknown>).id),
                        ),
                    )
                : system.members.map((member) => ({ id: member.device }));
            if (!candidates.length)
              fail(
                "USAGE_ERROR",
                2,
                "No eligible system members are available.",
              );
            parts.push(
              "member",
              operation,
              id,
              await session.choose(
                candidates.map((candidate) => ({
                  value: String((candidate as Record<string, unknown>).id),
                  label: String((candidate as Record<string, unknown>).id),
                })),
                { commandPath: ["system", id, "member", operation] },
              ),
            );
          } else parts.push(id, action);
        }
      } else if (group === "lock") {
        const locks = await runtime.listLocks();
        const lockChoiceWidth = recordChoiceWidth(
          locks.locks.map((lock) => lock.lockId),
        );
        const lockActions = [
          { value: "list", summary: t(locale, "menu.lock.listAll") },
          {
            value: "clear-stale",
            summary: t(locale, "menu.action.clear-stale"),
          },
        ];
        const selected = await session.choose(
          [
            ...commandChoices(lockActions),
            ...(locks.locks.length
              ? [
                  { separator: menuDivider(colorEnabled(flags, stdout.isTTY)) },
                  ...locks.locks.map((lock) => ({
                    value: lock.lockId,
                    label: recordChoiceLabel(
                      lock.lockId,
                      lockStatusLabel(locale, lock.state, lock.liveness),
                      lockChoiceWidth,
                    ),
                  })),
                ]
              : []),
          ],
          { commandPath: ["lock"], nextBackPath: ["lock"] },
        );
        if (selected === "list" || selected === "clear-stale")
          parts.push(selected);
        else
          parts.push(
            selected,
            await session.choose(menuChoices(["show", "clear"]), {
              commandPath: ["lock", selected],
            }),
          );
      } else if (group === "approval") {
        const approvals = await runtime.listApprovals();
        const approvalChoiceWidth = recordChoiceWidth(
          approvals.approvals.map((approval) => approval.id),
        );
        const selected = await session.choose(
          [
            ...commandChoices([
              {
                value: "list",
                summary: t(locale, "menu.approval.listAll"),
              },
            ]),
            ...(approvals.approvals.length
              ? [
                  {
                    separator: menuDivider(colorEnabled(flags, stdout.isTTY)),
                  },
                  ...approvals.approvals.map((approval) => ({
                    value: approval.id,
                    label: recordChoiceLabel(
                      approval.id,
                      approvalStatusLabel(locale, approval.status),
                      approvalChoiceWidth,
                    ),
                  })),
                ]
              : []),
          ],
          { commandPath: ["approval"], nextBackPath: ["approval"] },
        );
        if (selected === "list") parts.push(selected);
        else {
          const approval = approvals.approvals.find(
            (candidate) => candidate.id === selected,
          );
          const pending = approval?.status === "pending";
          const actionEntries = [
            { value: "inspect", summary: t(locale, "menu.action.inspect") },
            { value: "approve", summary: t(locale, "menu.action.approve") },
            { value: "reject", summary: t(locale, "menu.action.reject") },
          ] as const;
          const width = Math.max(
            ...actionEntries.map((entry) => entry.value.length),
          );
          const unavailable = t(locale, "approval.actionUnavailable", {
            status: approval
              ? approvalStatusLabel(locale, approval.status)
              : selected,
          });
          parts.push(
            selected,
            await session.choose(
              actionEntries.map((entry) => ({
                value: entry.value,
                label:
                  !pending && entry.value !== "inspect"
                    ? terminalTheme(colorEnabled(flags, stdout.isTTY)).muted(
                        `${entry.value.padEnd(width)}  ${entry.summary}`,
                      )
                    : commandChoice(entry.value, entry.summary, width),
                ...(!pending && entry.value !== "inspect"
                  ? {
                      description: `${terminalTheme(colorEnabled(flags, stdout.isTTY)).debug(unavailable)}\n`,
                    }
                  : {}),
              })),
              {
                commandPath: ["approval", selected],
              },
            ),
          );
        }
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
      if (["get", "unset", "explain"].includes(parts[1]!)) {
        parts.push(await chooseConfigurationKey(session, parts));
        if (parts[1] === "unset")
          await chooseConfigurationScope(
            session,
            configurationCatalogEntry(parts[2]!)!,
          );
      } else if (parts[1] === "set")
        parts.push(...(await completeConfigSet(session, parts)));
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
          { commandPath: parts },
        ),
      );
    if (
      !flags.help &&
      parts[0] === "device" &&
      parts.length === 2 &&
      !["list", "scan"].includes(parts[1]!) &&
      !(parts[1] === "add" && typeof commandFlags.identity === "string")
    ) {
      const session = interactive(locale, parts);
      if (parts[1] === "add") {
        const device = await chooseDiscoveredDevice(session);
        commandFlags = {
          ...commandFlags,
          adapter: device.adapter,
          identity: device.identity,
          name: await session.value(t(locale, "menu.field.deviceName")),
          ...(device.port !== undefined ? { port: device.port } : {}),
        };
      } else if (parts[1] === "remove") {
        const devices = queries.listConfiguredDevices().devices;
        if (!devices.length)
          fail("DEVICE_NOT_FOUND", 3, "No configured devices are available.");
        parts.push(
          await session.choose(
            devices.map((device) => ({
              value: String((device as Record<string, unknown>).id),
              label: String((device as Record<string, unknown>).id),
            })),
            { commandPath: parts },
          ),
        );
      } else {
        const capabilities = (await devices.describe(parts[1]!, locale))
          .capabilities;
        if (!capabilities.length)
          fail(
            "UNSUPPORTED_CAPABILITY",
            3,
            "No device capabilities are available.",
          );
        parts.push(
          await session.choose(
            commandChoices(
              capabilities.map((capability) => ({
                value: capability.id,
                summary: capability.summary,
              })),
            ),
            { commandPath: parts },
          ),
        );
      }
    }
    if (
      !flags.help &&
      parts[0] === "system" &&
      parts[1] === "create" &&
      parts.length === 2
    ) {
      const session = interactive(locale, parts);
      const devices = queries.listConfiguredDevices().devices;
      if (!devices.length)
        fail("DEVICE_NOT_FOUND", 3, "No configured devices are available.");
      const name = await session.value(t(locale, "system.detail.id" as never));
      const members = await session.chooseMany(
        t(locale, "system.detail.members" as never),
        devices.map((device) => ({
          value: String((device as Record<string, unknown>).id),
          label: String((device as Record<string, unknown>).id),
        })),
      );
      if (!members.length)
        fail(
          "INVALID_SYSTEM_CONFIG",
          3,
          "A system requires at least one member.",
        );
      parts.push(name, ...members);
    }
    if (
      !flags.help &&
      parts[0] === "system" &&
      parts[1] === "delete" &&
      parts.length === 2
    ) {
      const systems = await catalog.children(["system"]);
      if (!systems.length)
        fail("SYSTEM_NOT_FOUND", 3, "No configured systems are available.");
      parts.push(
        await interactive(locale, parts).choose(
          systems.map((system) => ({
            value: String(system.path[1]),
            label: String(system.summaryKey),
          })),
          { commandPath: parts },
        ),
      );
    }
    if (
      !flags.help &&
      parts[0] === "system" &&
      parts.length === 2 &&
      !["list", "create", "delete"].includes(parts[1]!)
    ) {
      const session = interactive(locale, parts);
      const capabilities = (await systems.describe(parts[1]!, locale))
        .capabilities;
      const action = await session.choose(
        [
          ...menuChoices(["show"]),
          ...commandChoices(
            capabilities.map((capability) => ({
              value: capability.id,
              summary: capability.summary,
            })),
          ),
        ],
        { commandPath: parts },
      );
      parts.push(action);
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
          { commandPath: parts },
        ),
      );
    if (
      !flags.help &&
      parts[0] === "lock" &&
      parts.length === 2 &&
      !["list", "clear-stale"].includes(parts[1]!)
    )
      parts.push(
        await interactive(locale, parts).choose(
          menuChoices(["show", "clear"]),
          {
            commandPath: parts,
          },
        ),
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
          { commandPath: parts },
        ),
      );
    writeSelectedCommand();
    if (parts[0] === "config") {
      if (parts.length === 1) {
        write(fullHelp(["config"]), flags, brief("config", locale));
        return;
      }
      const configAction = parts[1]!;
      const configEntry = configurationCatalogEntry(parts[2] ?? "") as
        ConfigurationCatalogEntry | undefined;
      if (["get", "set", "unset", "explain"].includes(configAction)) {
        if (!configEntry)
          fail(
            "CONFIG_KEY_NOT_FOUND",
            3,
            `Configuration key is not managed by config: ${parts[2] ?? ""}.`,
          );
        if (["set", "unset"].includes(configAction)) {
          const mutableEntry = configEntry as ConfigurationCatalogEntry;
          const requestedScopes = ["local", "project", "global"].filter(
            (scope) => commandFlags[scope] === true,
          ) as Array<"local" | "project" | "global">;
          if (
            requestedScopes.some(
              (scope) => !mutableEntry.scopes.includes(scope),
            )
          )
            fail(
              "CONFIG_SCOPE_INVALID",
              2,
              `${mutableEntry.key} cannot be saved in the requested scope.`,
            );
          if (!requestedScopes.length)
            commandFlags = {
              ...commandFlags,
              [mutableEntry.scopes[0]]: true,
            };
        }
      }
      const outcome = await configurationCommands.execute({
        action: parts[1]!,
        key: parts[2],
        value: parts[3],
        scopes: ["local", "project", "global"].filter(
          (scope) => commandFlags[scope],
        ) as Array<"local" | "project" | "global">,
        showOrigin: commandFlags["show-origin"] === true || parts[1] === "get",
      });
      const value = outcome.data as { value?: unknown };
      if (outcome.kind === "config.resolved") {
        writeDataPage({
          page: configResolvedDataPage(
            outcome.data as Parameters<typeof configResolvedDataPage>[0],
          ),
          flags,
          locale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
        return;
      }
      if (outcome.kind === "config.explain") {
        writeDataPage({
          page: configExplainDataPage(
            outcome.data as Parameters<typeof configExplainDataPage>[0],
          ),
          flags,
          locale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
        return;
      }
      if (outcome.kind === "config.validate") {
        writeDataPage({
          page: configValidateDataPage(),
          flags,
          locale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
        return;
      }
      if (outcome.kind === "config.get") {
        writeDataPage({
          page: configGetDataPage(
            outcome.data as Parameters<typeof configGetDataPage>[0],
          ),
          flags,
          locale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
        return;
      }
      if (outcome.kind === "config.set" || outcome.kind === "config.unset") {
        writeDataPage({
          page: configMutationDataPage({
            ...(outcome.data as Omit<
              Parameters<typeof configMutationDataPage>[0],
              "action"
            >),
            action: outcome.kind === "config.set" ? "set" : "unset",
          }),
          flags,
          locale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
        return;
      }
      write(
        outcome.data,
        flags,
        outcome.kind === "config.get" ? String(value.value) : undefined,
      );
      return;
    }
    if (parts[0] === "doctor") {
      if (commandFlags.save) {
        /* doctor is intentionally read-only unless explicit save; its diagnostics are returned */
      }
      const result = await queries.doctor(locale);
      writeDataPage({
        page: doctorDataPage(result),
        flags,
        locale,
        view: currentPresentationView(),
        color: colorEnabled(flags, stdout.isTTY),
      });
      return;
    }
    if (parts[0] === "adapter" && parts[1] === "list") {
      writeDataPage({
        page: adapterListDataPage(queries.listAdapters()),
        flags,
        locale,
        view: currentPresentationView(),
        color: colorEnabled(flags, stdout.isTTY),
      });
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
      if (parts[2] === "show")
        writeDataPage({
          page: adapterInfoDataPage(adapter),
          flags,
          locale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
      else if (parts[2] === "doctor")
        writeDataPage({
          page: adapterDoctorDataPage(
            await queries.adapterDoctor(parts[1], locale),
          ),
          flags,
          locale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
      else fail("USAGE_ERROR", 2, "Unknown adapter command.");
      return;
    }
    if (parts[0] === "device" && ["list", "scan"].includes(parts[1]!)) {
      if (parts.length !== 2)
        fail("USAGE_ERROR", 2, `device ${parts[1]} takes no arguments.`);
      if (parts[1] === "list") {
        writeDataPage({
          page: deviceListDataPage(queries.listConfiguredDevices()),
          flags,
          locale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
        return;
      }
      if (parts[1] === "scan") {
        writeDataPage({
          page: deviceScanDataPage(
            await queries.scanDevices(
              commandFlags.adapter === undefined
                ? undefined
                : String(commandFlags.adapter),
              commandFlags.probe === true ||
                commandFlags["confirm-device-probe"] === true,
            ),
          ),
          flags,
          locale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
        return;
      }
    }
    if (parts[0] === "device" && parts[1] === "add") {
      if (parts.length !== 2 && parts.length !== 3)
        fail("USAGE_ERROR", 2, "device add accepts one optional <instance>.");
      if (commandFlags.adapter === undefined)
        fail("USAGE_ERROR", 2, "device add requires --adapter <adapter-id>.");
      const adapter = String(commandFlags.adapter);
      const identity =
        typeof commandFlags.identity === "string"
          ? commandFlags.identity
          : undefined;
      const instance =
        typeof commandFlags.name === "string" ? commandFlags.name : parts[2];
      if (!instance)
        fail(
          "USAGE_ERROR",
          2,
          "device add requires <instance> or --name <name>.",
        );
      const deviceInstance = instance as string;
      queries.adapterInfo(adapter);
      const outcome = await configurationCommands.execute({
        action: "set",
        key: `devices.${deviceInstance}.adapter`,
        value: adapter,
        scopes: ["project"],
      });
      if (typeof commandFlags.port === "string")
        await configurationCommands.execute({
          action: "set",
          key: `devices.${deviceInstance}.port`,
          value: commandFlags.port,
          scopes: ["project"],
        });
      const result = outcome.data as { path: string };
      writeDataPage({
        page: deviceAddedDataPage({
          instance: deviceInstance,
          adapter,
          ...(identity ? { identity } : {}),
          ...(typeof commandFlags.port === "string"
            ? { port: commandFlags.port }
            : {}),
          path: result.path,
        }),
        flags,
        locale,
        view: currentPresentationView(),
        color: colorEnabled(flags, stdout.isTTY),
      });
      return;
    }
    if (parts[0] === "device" && parts[1] === "remove") {
      if (parts.length !== 3)
        fail("USAGE_ERROR", 2, "device remove requires <instance>.");
      const outcome = await configurationCommands.execute({
        action: "unset",
        key: `devices.${parts[2]}`,
        scopes: ["project"],
      });
      writeDataPage({
        page: deviceRemovedDataPage({
          instance: parts[2]!,
          path: (outcome.data as { path: string }).path,
        }),
        flags,
        locale,
        view: currentPresentationView(),
        color: colorEnabled(flags, stdout.isTTY),
      });
      return;
    }
    if (
      await handleDeviceCommand({
        parts,
        flags,
        rawOptions,
        devices,
        catalog,
        locale,
        ...(canConfirmOperationInteractively
          ? {
              confirmSafety: () =>
                interactive(locale, parts).confirm(
                  t(locale, "approval.safetyConfirm"),
                ),
              confirmApproval: () =>
                interactive(locale, parts).confirm(
                  t(locale, "approval.confirm.operation"),
                ),
              requiresApproval: (mode) =>
                requiresApproval(approvalLevel(config.value), mode),
            }
          : {}),
      })
    )
      return;
    if (parts[0] === "system" && parts[1] === "list") {
      if (parts.length !== 2)
        fail("USAGE_ERROR", 2, "system list takes no arguments.");
      writeDataPage({
        page: systemListDataPage(queries.listSystems()),
        flags,
        locale,
        view: currentPresentationView(),
        color: colorEnabled(flags, stdout.isTTY),
      });
      return;
    }
    if (parts[0] === "system" && parts[1] === "create") {
      if (parts.length < 4)
        fail(
          "USAGE_ERROR",
          2,
          "system create requires <name> and at least one <device>.",
        );
      const name = parts[2]!;
      if ((config.value.systems as Json | undefined)?.[name])
        fail("CONFIG_EXISTS", 3, `System already exists: ${name}`);
      const members = parts.slice(3).map((device) => ({ device }));
      const outcome = await configurationCommands.execute({
        action: "set",
        key: `systems.${name}`,
        value: JSON.stringify({ members }),
        scopes: ["project"],
      });
      writeDataPage({
        page: configMutationDataPage({
          ...(outcome.data as Omit<
            Parameters<typeof configMutationDataPage>[0],
            "action"
          >),
          action: "set",
        }),
        flags,
        locale,
        view: currentPresentationView(),
        color: colorEnabled(flags, stdout.isTTY),
      });
      return;
    }
    if (parts[0] === "system" && parts[1] === "delete") {
      if (parts.length !== 3)
        fail("USAGE_ERROR", 2, "system delete requires <name>.");
      const outcome = await configurationCommands.execute({
        action: "unset",
        key: `systems.${parts[2]}`,
        scopes: ["project"],
      });
      writeDataPage({
        page: configMutationDataPage({
          ...(outcome.data as Omit<
            Parameters<typeof configMutationDataPage>[0],
            "action"
          >),
          action: "unset",
        }),
        flags,
        locale,
        view: currentPresentationView(),
        color: colorEnabled(flags, stdout.isTTY),
      });
      return;
    }
    if (parts[0] === "system" && parts[1] === "member") {
      if (parts.length !== 5 || !["add", "remove"].includes(parts[2]!))
        fail(
          "USAGE_ERROR",
          2,
          "system member requires add/remove <system> <device>.",
        );
      const action = parts[2]!;
      const systemName = parts[3]!;
      const device = parts[4]!;
      const current = await systems.describe(systemName, locale);
      const members =
        action === "add"
          ? [...current.members, { device }]
          : current.members.filter((member) => member.device !== device);
      if (!members.length)
        fail(
          "SYSTEM_MEMBER_REQUIRED",
          3,
          "A system must retain at least one member.",
        );
      if (
        action === "remove" &&
        !current.members.some((member) => member.device === device)
      )
        fail(
          "SYSTEM_MEMBER_NOT_FOUND",
          3,
          `Device is not a system member: ${device}`,
        );
      if (
        action === "add" &&
        current.members.some((member) => member.device === device)
      )
        fail(
          "SYSTEM_MEMBER_EXISTS",
          3,
          `Device is already a member: ${device}`,
        );
      const outcome = await configurationCommands.execute({
        action: "set",
        key: `systems.${systemName}`,
        value: JSON.stringify({
          ...(current.displayName ? { name: current.displayName } : {}),
          ...(current.description ? { description: current.description } : {}),
          ...(current.labels ? { labels: current.labels } : {}),
          members,
        }),
        scopes: ["project"],
      });
      writeDataPage({
        page: configMutationDataPage({
          ...(outcome.data as Omit<
            Parameters<typeof configMutationDataPage>[0],
            "action"
          >),
          action: "set",
        }),
        flags,
        locale,
        view: currentPresentationView(),
        color: colorEnabled(flags, stdout.isTTY),
      });
      return;
    }
    if (parts[0] === "system" && parts[1] && parts[1] !== "list") {
      const system = await systems.describe(parts[1], locale);
      if (parts.length === 2 || parts[2] === "show") {
        if (parts.length > 3)
          fail("USAGE_ERROR", 2, "system show takes no arguments.");
        writeDataPage({
          page: systemDetailDataPage(system),
          flags,
          locale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
        return;
      }
      await catalog.executable(["system", parts[1], parts[2]]);
      const definition = await systems.capability(parts[1], parts[2], locale);
      const input = capabilityInput(
        rawOptions,
        definition.options || [],
        definition.safety.flag,
        parts.slice(3),
      );
      if (definition.safety.mode !== "normal" && definition.safety.flag) {
        if (canConfirmOperationInteractively) {
          if (
            !(await interactive(locale, parts).confirm(
              t(locale, "approval.safetyConfirm"),
            ))
          )
            return;
        } else
          flags[definition.safety.flag] = optionEnabled(
            rawOptions,
            definition.safety.flag,
          );
      }
      if (
        canConfirmOperationInteractively &&
        requiresApproval(approvalLevel(config.value), definition.safety.mode)
      ) {
        if (
          !(await interactive(locale, parts).confirm(
            t(locale, "approval.confirm.operation"),
          ))
        )
          return;
      }
      const result = await systems.execute(parts[1], parts[2], input, {
        ...(canConfirmOperationInteractively &&
        definition.safety.mode !== "normal"
          ? { executionMode: "interactive" as const }
          : {}),
      });
      if (!flags.jsonl)
        writeDataPage({
          page: systemOperationDataPage(
            result as Parameters<typeof systemOperationDataPage>[0],
          ),
          flags,
          locale,
          view: currentPresentationView(),
          color: colorEnabled(flags, stdout.isTTY),
        });
      return;
    }
    // Approval confirmation is intrinsically human-only. Check this before
    // loading a record so an agent cannot use record validity as an oracle.
    if (
      parts[0] === "approval" &&
      parts[1] &&
      (parts[2] === "approve" || parts[2] === "reject")
    )
      interactive(locale, parts);
    if (
      await handleRuntimeCommand({
        parts,
        flags,
        commandFlags,
        locale,
        color: colorEnabled(flags, stdout.isTTY),
        presentationView: currentPresentationView(),
        runtimeCommands,
        approvalPresentation: {
          projectId: (config.value.project as Json | undefined)?.id as
            string | undefined,
          projectName: (config.value.project as Json | undefined)?.name as
            string | undefined,
        },
        confirmApproval: ({ approvalId, action }) =>
          interactive(locale, ["approval", approvalId, action]).confirm(
            t(
              locale,
              action === "approve"
                ? "approval.confirm.approve"
                : "approval.confirm.reject",
            ),
          ),
        confirmLockClear:
          !flags.agent &&
          !flags.json &&
          !flags.jsonl &&
          !agent &&
          stdin.isTTY &&
          stdout.isTTY
            ? ({ state }) =>
                interactive(locale, parts).confirm(
                  t(
                    locale,
                    state === "quarantined" || state === "quarantine-failed"
                      ? "lock.clear.confirmQuarantined"
                      : "lock.clear.confirmActive",
                  ),
                )
            : undefined,
      })
    )
      return;
    fail("UNKNOWN_COMMAND", 2, `Unknown command: ${parts.join(" ")}`);
  } catch (e: unknown) {
    if (e instanceof InteractionExitedError) return;
    if (e instanceof InteractionBackError && replay) {
      return main(adapters, {
        path: e.path,
        backPaths: e.remainingPaths,
        ignoreHomeEscape: e.path.length === 1 && e.path[0] === "home",
        ...replay,
      });
    }
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
    const flags = replay?.flags || {};
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
      isOperation: ["device", "system"].includes(invokedPath[0] || ""),
      terminalEmitted: Boolean(
        (err as BenchPilotError & { jsonlTerminalEmitted?: boolean })
          .jsonlTerminalEmitted,
      ),
      humanMessage: `${terminalTheme(colorEnabled(flags, stdout.isTTY)).danger(` ${err.kind} `)}: ${humanErrorMessage(
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
    const adapterId =
      typeof (err.details as { adapterId?: unknown }).adapterId === "string"
        ? (err.details as { adapterId: string }).adapterId
        : undefined;
    if (
      err.kind.startsWith("ADAPTER_") &&
      adapterId &&
      renderAdapterDoctor &&
      !flags.agent &&
      !flags.json &&
      !flags.jsonl
    )
      await renderAdapterDoctor(adapterId).catch(() => undefined);
    process.exitCode = err.exitCode;
  } finally {
    interaction?.close();
  }
}
if (process.env.BENCHPILOT_NO_AUTORUN !== "1") void main();
