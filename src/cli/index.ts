#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import {
  Adapter,
  approvalLevel,
  BenchPilotError,
  fail,
  Json,
  requiresApproval,
} from "../core.js";
import { DeferredOperationReporter } from "./output/deferred-operation-reporter.js";
import { ScreenOperationReporter } from "./output/screen-operation-reporter.js";
import { capabilityResultFromSystem } from "./output/capability-result.js";
import { renderCapabilityResult } from "./output/capability-renderer.js";
import { loadBuiltinAdapters } from "../adapters/runtime/builtin-adapters.js";
import { openApplicationRequest } from "../application/request-scope.js";
import { readGlobalLocale } from "../application/config/locale.js";
import { parse } from "./parser.js";
import { handleDeviceCommand } from "./commands/device.js";
import { handleRuntimeCommand } from "./commands/runtime.js";
import {
  capabilityInput,
  commandOptionFlags,
  optionEnabled,
} from "./option-parser.js";
import { renderDataPage } from "./output/data-page-renderer.js";
import {
  commandFailureResult,
  humanErrorMessage,
  renderFailure,
} from "./output/failure.js";
import { detectAgent } from "./agent/detector.js";
import { interactionDecision } from "./interaction/policy.js";
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
} from "./interaction/prompter.js";
import {
  isLocale,
  resolveMessage,
  t,
  type Locale,
  type MessageKey,
} from "../i18n/index.js";
import { interactionMenuChoices } from "./interaction/menu.js";
import { InteractionEngine } from "./interaction/engine.js";
import { navigateResourceCommand } from "./interaction/resource-navigation.js";
import {
  commandIntentValues,
  parseCommandState,
} from "./commands/command-intent.js";
import { commandContractError } from "./commands/command-errors.js";
import { packageVersion } from "../version.js";
import { localizeAdapterCapabilities } from "./i18n/adapter-messages.js";
import { RLogBusinessLogFactory } from "../infrastructure/rlog-business-log.js";
import { displayWidth, padDisplay } from "./terminal/text.js";
import { detectTerminalCapabilities } from "./terminal/capabilities.js";
import { StreamTerminalSurface } from "./terminal/surface.js";
import { OutputEngine, outputMode } from "./output/engine.js";
import { versionOutputDefinition } from "./definitions/version.js";
import { commandCatalogDefinition } from "../application/commands/definitions.js";
import { HelpDocumentService } from "../application/commands/help.js";
import { CommandResolutionError } from "../application/commands/resolver.js";
import { projectHelpDocument } from "./help/projector.js";
import { helpOutputDefinition } from "./definitions/help.js";
import { handleUpgradeCommand } from "./commands/upgrade.js";
import { handleHomeCommand } from "./commands/home.js";
import { handleVersionCommand } from "./commands/version.js";
import { handleHelpCommand } from "./commands/help.js";
import { handleInitCommand } from "./commands/init.js";
import { doctorDataPage } from "./data/doctor.js";
import { hasOutcomePage, outcomeDataPage } from "./data/outcome-page.js";
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
} from "./data/resource.js";
import {
  configExplainDataPage,
  configGetDataPage,
  configMutationDataPage,
  configResolvedDataPage,
  configValidateDataPage,
} from "./data/config.js";
import {
  configurationCatalogEntry,
  configurationMenuChoices,
  configurationValueMenuChoices,
} from "./config-catalog.js";

const version = packageVersion;
const supportedLanguages = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
] as const;

const commandGroups = new Set(
  commandCatalogDefinition.commands
    .filter((command) => !command.parentId && !command.handler)
    .flatMap((command) => {
      const root = command.path[0];
      return root?.kind === "literal" ? [root.value] : [];
    }),
);

const isCommandGroup = (value: string | undefined): value is string =>
  typeof value === "string" && commandGroups.has(value);

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

const isInteractionFailure = (kind: string) =>
  [
    "AGENT_INTERACTION_UNSUPPORTED",
    "INTERACTIVE_MACHINE_OUTPUT_UNSUPPORTED",
    "INTERACTIVE_TERMINAL_REQUIRED",
    "INTERACTION_CANCELLED",
  ].includes(kind);

interface MainResume {
  readonly path: readonly string[];
  readonly flags: ReturnType<typeof parse>["flags"];
  readonly rawOptions: ReturnType<typeof parse>["rawOptions"];
  readonly backPaths?: readonly (readonly string[])[];
  readonly ignoreHomeEscape?: boolean;
}

export async function main(adapters?: Adapter[], resume?: MainResume) {
  const commandStartedAt = new Date();
  let interaction: InteractionSession | undefined;
  let terminal: StreamTerminalSurface | undefined;
  let presentationLocale: Locale = "en";
  let replay: Omit<MainResume, "path"> | undefined;
  let invokedPath: readonly string[] = [];
  let selectedCommandEmitted = false;
  let resolvedCommandId: string | undefined;
  let renderAdapterDoctor: ((adapterId: string) => Promise<void>) | undefined;
  let renderFailureHelp:
    ((target: readonly string[]) => Promise<string>) | undefined;
  try {
    const parsed = resume ?? parse(process.argv.slice(2));
    let parts = [...parsed.path];
    const { flags, rawOptions } = parsed;
    replay = { flags, rawOptions };
    invokedPath = parts;
    let commandFlags = { ...flags, ...commandOptionFlags(rawOptions) };
    const terminalSurface = new StreamTerminalSurface(
      stdout,
      detectTerminalCapabilities({
        stdin: { isTTY: stdin.isTTY === true },
        stdout: {
          isTTY: stdout.isTTY === true,
          ...(stdout.columns ? { columns: stdout.columns } : {}),
          ...(stdout.rows ? { rows: stdout.rows } : {}),
        },
        stderr: { isTTY: process.stderr.isTTY === true },
        env: process.env,
        color: colorEnabled(flags, stdout.isTTY),
      }),
    );
    terminal = terminalSurface;
    const agent = detectAgent();
    const screenOperationReporter =
      !flags.json && !flags.jsonl && !flags.agent && !agent && stdout.isTTY
        ? new ScreenOperationReporter(
            terminalSurface,
            undefined,
            undefined,
            undefined,
            terminalTheme(colorEnabled(flags, stdout.isTTY)),
          )
        : undefined;
    const showWordmark = shouldShowWordmark(stdout.isTTY);
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
          { helpPath },
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
      terminalSurface.write(
        `${terminalTheme(colorEnabled(flags, stdout.isTTY)).debug(`$ benchpilot ${parts.join(" ")}${configScope ? ` --${configScope}` : ""}${deviceAddOptions}`)}\n\n`,
      );
    };
    const loadPresentationLocale = async () => {
      const locale = await readGlobalLocale();
      presentationLocale = locale;
      return locale;
    };
    const renderVersionOutput = (locale: Locale) =>
      new OutputEngine({
        mode: outputMode(flags),
        locale,
        color: colorEnabled(flags, stdout.isTTY),
        columns: stdout.columns ?? 80,
        output: stdout,
      }).render(
        versionOutputDefinition({
          cliVersion: version,
          nodeVersion: process.version,
          showWordmark,
        }),
      );
    const loadDefinitionHelp = async (
      target: readonly string[],
      includeAll = false,
    ) => {
      const locale = await loadPresentationLocale();
      const emptyProvider = { values: async () => [] };
      const helpFieldChoices = {
        "available-adapters": async () =>
          [
            ...new Set(
              (adapters ?? (await loadBuiltinAdapters())).map(
                (adapter) => adapter.id,
              ),
            ),
          ].sort((left, right) => left.localeCompare(right)),
      } as const;
      const staticHelp = new HelpDocumentService(
        commandCatalogDefinition,
        emptyProvider,
        {
          values: async ({ provider }) =>
            provider in helpFieldChoices
              ? helpFieldChoices[provider as keyof typeof helpFieldChoices]()
              : [],
        },
      );
      let document;
      let adapterHelpMessages:
        import("./help/projector.js").AdapterHelpMessageResolver | undefined;
      try {
        document = await staticHelp.document(target, {
          includeDynamicValues: includeAll,
        });
      } catch (error) {
        if (!(error instanceof CommandResolutionError)) throw error;
        const declared = adapters ?? (await loadBuiltinAdapters());
        const helpScope = await openApplicationRequest({
          cwd: process.cwd(),
          configPath: flags.config as string | undefined,
          operation: { benchpilotVersion: version },
          adapters: declared,
          nodeVersion: process.versions.node,
          businessLogs: new RLogBusinessLogFactory(),
        });
        try {
          document = await helpScope.commandGraph.help.document(target, {
            includeDynamicValues: includeAll,
          });
          adapterHelpMessages = (adapter, key, fallback) =>
            helpScope.application.registry
              .get(adapter)
              .translate?.(locale, key) ?? fallback;
        } catch (dynamicError) {
          if (dynamicError instanceof CommandResolutionError)
            throw new BenchPilotError(
              dynamicError.code === "COMMAND_UNAVAILABLE"
                ? "COMMAND_UNAVAILABLE"
                : "UNKNOWN_COMMAND",
              dynamicError.code === "COMMAND_UNAVAILABLE" ? 3 : 2,
              `Command not found: ${target.join(" ")}`,
              false,
              undefined,
              [],
              { path: target, resolution: dynamicError.code },
            );
          throw dynamicError;
        }
      }
      return {
        data: projectHelpDocument(document, locale, adapterHelpMessages),
        locale,
      };
    };
    const renderDefinitionHelp = async (
      target: readonly string[],
      includeAll = false,
    ) => {
      const { data, locale } = await loadDefinitionHelp(target, includeAll);
      new OutputEngine({
        mode: outputMode(flags),
        locale,
        color: colorEnabled(flags, stdout.isTTY),
        columns: stdout.columns ?? 80,
        output: stdout,
      }).render(helpOutputDefinition(data, showWordmark));
    };
    renderFailureHelp = async (target) => {
      const { data, locale } = await loadDefinitionHelp(target);
      const output: string[] = [];
      new OutputEngine({
        mode: "screen",
        locale,
        color: colorEnabled(flags, stdout.isTTY),
        columns: stdout.columns ?? 80,
        output: { write: (value) => output.push(value) },
      }).render(helpOutputDefinition(data, false));
      return output.join("");
    };
    if (
      await handleVersionCommand({
        path: parts,
        forceVersion: flags.version === true,
        helpRequested: flags.help === true,
        loadLocale: loadPresentationLocale,
        renderHelp: renderDefinitionHelp,
        renderVersion: renderVersionOutput,
      })
    )
      return;
    if (
      await handleHelpCommand({
        path: parts,
        helpRequested: flags.help === true,
        includeAll: commandFlags.all === true,
        render: renderDefinitionHelp,
      })
    )
      return;
    const home = await handleHomeCommand({
      path: parts,
      loadLocale: loadPresentationLocale,
      color: colorEnabled(flags, stdout.isTTY),
      showWordmark,
      interactionAllowed: interactionDecision({
        agent,
        agentMode: flags.agent === true,
        json: flags.json,
        jsonl: flags.jsonl,
        stdinIsTTY: stdin.isTTY,
        stdoutIsTTY: stdout.isTTY,
      }).allowed,
      interaction: () => interactive(presentationLocale, ["home"]),
      rootHelp: async () => (await loadDefinitionHelp([])).data,
      write: (value) => terminalSurface.write(value),
      selected: writeSelectedCommand,
      renderRootHelp: () => renderDefinitionHelp([]),
      renderVersion: renderVersionOutput,
      ignoreInitialEscape: resume?.ignoreHomeEscape === true,
    });
    if (home.handled) {
      if (!home.nextPath) return;
      parts = [...home.nextPath];
    }
    if (
      await handleUpgradeCommand({
        path: parts,
        loadLocale: loadPresentationLocale,
        executable: process.argv[1] || "",
        interaction: () => interactive(presentationLocale, ["upgrade"]),
        selected: writeSelectedCommand,
        render: ({ command, page }) =>
          renderDataPage({
            command,
            page,
            flags,
            locale: presentationLocale,
            color: colorEnabled(flags, stdout.isTTY),
          }),
      })
    )
      return;
    if (
      await handleInitCommand({
        path: parts,
        values: commandFlags,
        cwd: process.cwd(),
        color: colorEnabled(flags, stdout.isTTY),
        canInteract: interactionDecision({
          agent,
          agentMode: flags.agent === true,
          json: flags.json,
          jsonl: flags.jsonl,
          stdinIsTTY: stdin.isTTY,
          stdoutIsTTY: stdout.isTTY,
        }).allowed,
        interaction: (locale) => interactive(locale, ["init"]),
        loadAdapters: async () => adapters ?? (await loadBuiltinAdapters()),
        setPresentationLocale: (locale) => (presentationLocale = locale),
        selected: writeSelectedCommand,
        render: ({ page, locale }) =>
          renderDataPage({
            command: { id: "init", path: ["init"] },
            page,
            flags,
            locale,
            color: colorEnabled(flags, stdout.isTTY),
          }),
      })
    )
      return;
    const declared = adapters ?? (await loadBuiltinAdapters());
    const operationReporter =
      flags.jsonl && (parts[0] === "device" || parts[0] === "system")
        ? new DeferredOperationReporter(stdout)
        : undefined;
    const scope = await openApplicationRequest({
      cwd: process.cwd(),
      configPath: flags.config as string | undefined,
      operation: {
        timeout: flags.timeout,
        dryRun: flags["dry-run"] === true,
        session: typeof flags.session === "string" ? flags.session : undefined,
        benchpilotVersion: version,
      },
      adapters: declared,
      nodeVersion: process.versions.node,
      reporter: operationReporter ?? screenOperationReporter,
      businessLogs: new RLogBusinessLogFactory(),
    });
    const {
      application,
      config,
      runtime,
      runtimeCommands,
      queries,
      devices,
      systems,
      configurationCommands,
      catalog,
    } = scope;
    const operationOutputDeferred =
      parts[0] === "device" || parts[0] === "system";
    const interactionResolutionDeferred =
      parts[0] === "approval" &&
      (parts[2] === "approve" || parts[2] === "reject");
    const parseCurrentCommand = async () => {
      try {
        return await parseCommandState({
          graph: scope.commandGraph,
          path: parts,
          values: commandFlags,
        });
      } catch (error) {
        throw commandContractError(error, parts);
      }
    };
    let definedCommand;
    if (!operationOutputDeferred && !interactionResolutionDeferred) {
      try {
        const directPathUnchanged =
          !resume &&
          parsed.path.length === parts.length &&
          parsed.path.every((value, index) => value === parts[index]);
        definedCommand = directPathUnchanged
          ? await scope.commandGraph.parser.parse(process.argv.slice(2))
          : await parseCurrentCommand();
        commandFlags = {
          ...commandFlags,
          ...commandIntentValues(definedCommand.intent),
        };
        resolvedCommandId = definedCommand.intent.commandId;
      } catch (error) {
        throw commandContractError(error, parts);
      }
    }
    const translateAdapterMessage = (
      adapterId: string,
      selectedLocale: Locale,
      key: string,
      values: Readonly<Record<string, string | number | boolean>>,
    ) => {
      const adapter = declared.find((candidate) => candidate.id === adapterId);
      return adapter?.translate?.(
        selectedLocale,
        key,
        Object.fromEntries(
          Object.entries(values).map(([name, value]) => [name, String(value)]),
        ),
      );
    };
    const adapterMessageResolver =
      (selectedLocale: Locale) =>
      ({
        adapter,
        key,
        values,
        fallback,
      }: {
        adapter?: string;
        key: string;
        values: Readonly<Record<string, string | number | boolean>>;
        fallback: string;
      }) =>
        adapter
          ? (translateAdapterMessage(adapter, selectedLocale, key, values) ??
            fallback)
          : undefined;
    const describeDeviceForDisplay = async (
      id: string,
      selectedLocale: Locale,
    ) => {
      const description = await devices.describe(id);
      return {
        ...description,
        capabilities: localizeAdapterCapabilities(
          application.registry.get(description.adapter.id),
          selectedLocale,
          description.capabilities,
        ),
      };
    };
    const describeSystemForDisplay = async (
      id: string,
      selectedLocale: Locale,
    ) => {
      const description = await systems.describe(id);
      const first = [...description.devices].sort()[0];
      if (!first) return description;
      const source = await devices.describe(first);
      return {
        ...description,
        capabilities: localizeAdapterCapabilities(
          application.registry.get(source.adapter.id),
          selectedLocale,
          description.capabilities,
        ),
      };
    };
    const globalLayer = config.layers.find((layer) => layer.scope === "global");
    const configuredLocale = (globalLayer?.value.cli as Json | undefined)
      ?.locale;
    const locale = isLocale(configuredLocale) ? configuredLocale : "en";
    presentationLocale = locale;
    screenOperationReporter?.configure(
      {
        preparing: t(locale, "operationProgress.preparing"),
        running: t(locale, "operationProgress.running"),
        cleaning: t(locale, "operationProgress.cleaning"),
        completing: t(locale, "operationProgress.completing"),
      },
      (adapterId, key, fallback, values) =>
        application.registry
          .get(adapterId)
          .translate?.(
            locale,
            key,
            Object.fromEntries(
              Object.entries(values).map(([name, value]) => [
                name,
                String(value),
              ]),
            ),
          ) ?? fallback,
    );
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
    const graphMenuChoices = (
      parentId: string,
      commandIds?: readonly string[],
    ) =>
      interactionMenuChoices(
        scope.commandGraph.interaction.children(parentId, commandIds),
        locale,
        colorEnabled(flags, stdout.isTTY),
      );
    const resourceNavigation = {
      adapter: () =>
        navigateResourceCommand({
          path: parts,
          root: "adapter",
          rootChoices: graphMenuChoices("adapter"),
          resources: async () =>
            queries.listAdapters().adapters.map((adapter) => ({
              value: adapter.id,
              label: `${adapter.id} — ${adapter.summary}`,
            })),
          actionChoices: async (adapterId) =>
            graphMenuChoices("adapter.resource", [
              "adapter.show",
              "adapter.doctor",
              "adapter.discover",
              "adapter.configure",
              ...(queries.adapterInstallation(adapterId)
                ? ["adapter.install"]
                : []),
              "adapter.enable",
              "adapter.disable",
            ]),
          interaction: () => interactive(locale, parts),
          color: colorEnabled(flags, stdout.isTTY),
        }),
      run: () =>
        navigateResourceCommand({
          path: parts,
          root: "run",
          rootChoices: graphMenuChoices("run"),
          resources: async () => {
            const records = await runtime.listRuns();
            const width = recordChoiceWidth(records.runs.map((run) => run.id));
            return records.runs.map((run) => ({
              value: run.id,
              label: recordChoiceLabel(
                run.id,
                runStatusLabel(locale, run.manifest?.status),
                width,
              ),
            }));
          },
          actionChoices: async () => graphMenuChoices("run.resource"),
          onStaticAction: async (action) => {
            if (action !== "prune") return ["run", action];
            const parsedPrune = await parseCommandState({
              graph: scope.commandGraph,
              path: ["run", "prune"],
              values: commandFlags,
            });
            const completion = await new InteractionEngine(
              interactive(locale, ["run", "prune"]),
              locale,
              {
                "run-prune-mode": () => [
                  { value: "keep", label: t(locale, "menu.runs.keep") },
                  {
                    value: "older-than",
                    label: t(locale, "menu.runs.older-than"),
                  },
                  {
                    value: "dangerously-remove-all-runs",
                    label: t(locale, "menu.runs.all"),
                  },
                ],
              },
            ).complete(parsedPrune);
            commandFlags = { ...commandFlags, ...completion.values };
            return completion.path;
          },
          interaction: () => interactive(locale, parts),
          color: colorEnabled(flags, stdout.isTTY),
        }),
      lock: () =>
        navigateResourceCommand({
          path: parts,
          root: "lock",
          rootChoices: graphMenuChoices("lock"),
          resources: async () => {
            const records = await runtime.listLocks();
            const width = recordChoiceWidth(
              records.locks.map((lock) => lock.lockId),
            );
            return records.locks.map((lock) => ({
              value: lock.lockId,
              label: recordChoiceLabel(
                lock.lockId,
                lockStatusLabel(locale, lock.state, lock.liveness),
                width,
              ),
            }));
          },
          actionChoices: async () =>
            graphMenuChoices("lock.resource", ["lock.show", "lock.clear"]),
          interaction: () => interactive(locale, parts),
          color: colorEnabled(flags, stdout.isTTY),
        }),
      approval: () =>
        navigateResourceCommand({
          path: parts,
          root: "approval",
          rootChoices: graphMenuChoices("approval"),
          resources: async () => {
            const approvals = await runtime.listApprovals();
            const width = recordChoiceWidth(
              approvals.approvals.map((approval) => approval.id),
            );
            return approvals.approvals.map((approval) => ({
              value: approval.id,
              label: recordChoiceLabel(
                approval.id,
                approvalStatusLabel(locale, approval.status),
                width,
              ),
            }));
          },
          actionChoices: async (approvalId) => {
            const approval = (await runtime.listApprovals()).approvals.find(
              (candidate) => candidate.id === approvalId,
            );
            const pending = approval?.status === "pending";
            const entries =
              scope.commandGraph.interaction.children("approval.resource");
            const width = Math.max(
              ...entries.map((entry) => entry.value.length),
            );
            const unavailable = t(locale, "approval.actionUnavailable", {
              status: approval
                ? approvalStatusLabel(locale, approval.status)
                : approvalId,
            });
            const theme = terminalTheme(colorEnabled(flags, stdout.isTTY));
            return entries.map((entry) => {
              const summary = resolveMessage(locale, entry.summary);
              const unavailableAction = !pending && entry.value !== "inspect";
              return {
                value: entry.value,
                label: unavailableAction
                  ? theme.muted(`${entry.value.padEnd(width)}  ${summary}`)
                  : commandChoice(entry.value, summary, width),
                ...(unavailableAction
                  ? { description: `${theme.debug(unavailable)}\n` }
                  : {}),
              };
            });
          },
          interaction: () => interactive(locale, parts),
          color: colorEnabled(flags, stdout.isTTY),
        }),
    } as const;
    const navigateDynamicRecord = async () => {
      if (flags.help) return false;
      const navigate =
        resourceNavigation[parts[0] as keyof typeof resourceNavigation];
      if (!navigate) return false;
      const result = await navigate();
      if (!result) return false;
      parts = [...result];
      return true;
    };
    renderAdapterDoctor = async (adapterId) => {
      terminalSurface.write(
        `\n${terminalTheme(colorEnabled(flags, stdout.isTTY)).debug(`$ benchpilot adapter ${adapterId} doctor`)}\n\n`,
      );
      renderDataPage({
        command: {
          id: "adapter.doctor",
          path: ["adapter", adapterId, "doctor"],
        },
        page: adapterDoctorDataPage(
          adapterId,
          await queries.adapterDoctor(adapterId),
        ),
        flags,
        locale: presentationLocale,
        color: colorEnabled(flags, stdout.isTTY),
        messageResolver: adapterMessageResolver(presentationLocale),
      });
    };
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
    const configurationInteractionProviders = {
      "configuration-keys": () =>
        configurationMenuChoices(locale, colorEnabled(flags, stdout.isTTY)),
      "configuration-scopes": ({
        values,
      }: {
        values: Readonly<Record<string, unknown>>;
      }) => {
        const entry = configurationCatalogEntry(String(values.key ?? ""));
        if (!entry) return [];
        const theme = terminalTheme(colorEnabled(flags, stdout.isTTY));
        const nameWidth = Math.max(
          ...entry.scopes.map((scope) =>
            displayWidth(t(locale, configurationScopeMessages[scope].name)),
          ),
        );
        return entry.scopes.map((scope) => ({
          value: scope,
          label: `${theme.command(padDisplay(scope, 7))}  ${padDisplay(t(locale, configurationScopeMessages[scope].name), nameWidth)}  ${theme.muted(t(locale, configurationScopeMessages[scope].description))}`,
        }));
      },
      "configuration-values": ({
        values,
      }: {
        values: Readonly<Record<string, unknown>>;
      }) => {
        const entry = configurationCatalogEntry(String(values.key ?? ""));
        if (!entry || entry.editor === "text") return undefined;
        if (entry.editor === "select")
          return configurationValueMenuChoices(
            entry,
            locale,
            colorEnabled(flags, stdout.isTTY),
          );
        const idWidth = Math.max(
          ...declared.map((adapter) => displayWidth(adapter.id)),
        );
        const theme = terminalTheme(colorEnabled(flags, stdout.isTTY));
        return {
          choices: declared.map((adapter) => ({
            value: adapter.id,
            label: `${theme.command(padDisplay(adapter.id, idWidth))}  ${adapter.summary}`,
          })),
          multiple: true,
          prompt: t(locale, "configCatalog.enabledAdapters.prompt"),
          serialize: "json" as const,
        };
      },
    };
    const completeDeclaredRecipe = async () => {
      const candidate = await parseCurrentCommand();
      if (
        candidate.resolved.definition.interaction === "never" ||
        !candidate.missingFields.length
      )
        return false;
      const completion = await new InteractionEngine(
        interactive(locale, parts),
        locale,
        {
          "supported-locales": () => supportedLanguages,
          ...configurationInteractionProviders,
        },
      ).complete(candidate);
      parts = [...completion.path];
      commandFlags = { ...commandFlags, ...completion.values };
      return true;
    };
    const chooseDiscoveredDevice = async (session: InteractionSession) => {
      const discovered = await queries.scanDevices();
      if (!discovered.devices.length) return undefined;
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
    const completeDeviceAdd = async (
      session: InteractionSession,
    ): Promise<{
      readonly adapter: string;
      readonly name: string;
      readonly identity?: string;
      readonly port?: string;
    }> => {
      const discovered = await chooseDiscoveredDevice(session);
      if (discovered)
        return {
          ...discovered,
          name: await session.value(t(locale, "menu.field.deviceName")),
        };
      const adapters = queries.listAdapters().adapters;
      if (!adapters.length)
        fail("UNKNOWN_ADAPTER", 3, "No enabled adapters are available.");
      terminalSurface.write(
        `${terminalTheme(colorEnabled(flags, stdout.isTTY)).warning(t(locale, "menu.device.addDiscoveryEmpty"))}\n\n`,
      );
      const width = Math.max(
        ...adapters.map((adapter) => displayWidth(adapter.id)),
      );
      const adapter = await session.choose(
        adapters.map((candidate) => ({
          value: candidate.id,
          label: commandChoice(candidate.id, candidate.summary, width),
        })),
        { commandPath: ["device", "add"] },
      );
      return {
        adapter,
        name: await session.value(t(locale, "menu.field.deviceName")),
      };
    };
    await navigateDynamicRecord();
    const staticGroupNavigation = {
      language: async (session: InteractionSession) => {
        parts.push(
          await session.choose(graphMenuChoices("language"), {
            commandPath: ["language"],
            nextBackPath: ["language"],
          }),
        );
      },
      config: async (session: InteractionSession) => {
        parts.push(
          await session.choose(graphMenuChoices("config"), {
            commandPath: ["config"],
            nextBackPath: ["config"],
          }),
        );
      },
    } as const;
    if (isCommandGroup(parts[0]) && parts.length === 1) {
      const session = interactive(locale, parts);
      const group = parts[0];
      const navigate =
        staticGroupNavigation[group as keyof typeof staticGroupNavigation];
      if (navigate) await navigate(session);
      else if (group === "device") {
        const deviceNodes = await catalog.children(["device"]);
        const id = await session.choose(
          [
            ...graphMenuChoices("device"),
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
          const device = await completeDeviceAdd(session);
          parts.push(id);
          commandFlags = {
            ...commandFlags,
            adapter: device.adapter,
            ...(device.identity ? { identity: device.identity } : {}),
            name: device.name,
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
          const capabilities = (await describeDeviceForDisplay(id, locale))
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
            ...graphMenuChoices("system", [
              "system.list",
              "system.create",
              "system.delete",
            ]),
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
          const name = await session.value(t(locale, "system.detail.id"));
          const members = await session.chooseMany(
            t(locale, "system.detail.members"),
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
          const capabilities = (await describeSystemForDisplay(id, locale))
            .capabilities;
          const action = await session.choose(
            [
              ...graphMenuChoices("system.resource"),
              ...graphMenuChoices("system", ["system.member"]),
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
              graphMenuChoices("system.member"),
              {
                commandPath: ["system", id, "member"],
              },
            );
            const system = await systems.describe(id);
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
      }
    }
    if (
      !flags.help &&
      !operationOutputDeferred &&
      !interactionResolutionDeferred
    ) {
      if (
        parts[0] === "adapter" &&
        typeof parts[1] === "string" &&
        parts[2] === "install" &&
        !flags.json &&
        !flags.jsonl &&
        !flags.quiet
      ) {
        const installation = queries.adapterInstallation(parts[1]);
        if (installation) {
          const gigabytes = (bytes: number) =>
            `${(bytes / 1_000_000_000).toLocaleString(locale, {
              maximumFractionDigits: 1,
            })} GB`;
          terminalSurface.write(
            `${t(locale, "adapterResult.installation.estimate", {
              minimum: gigabytes(installation.estimate.minimumBytes),
              maximum: gigabytes(installation.estimate.maximumBytes),
            })}\n\n`,
          );
        }
      }
      await completeDeclaredRecipe();
    }
    if (
      !flags.help &&
      parts[0] === "device" &&
      parts.length === 2 &&
      !["list", "scan"].includes(parts[1]!) &&
      !(
        parts[1] === "add" &&
        typeof commandFlags.adapter === "string" &&
        typeof commandFlags.name === "string"
      )
    ) {
      const session = interactive(locale, parts);
      if (parts[1] === "add") {
        const device = await completeDeviceAdd(session);
        commandFlags = {
          ...commandFlags,
          adapter: device.adapter,
          ...(device.identity ? { identity: device.identity } : {}),
          name: device.name,
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
        const capabilities = (await describeDeviceForDisplay(parts[1]!, locale))
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
      const name = await session.value(t(locale, "system.detail.id"));
      const members = await session.chooseMany(
        t(locale, "system.detail.members"),
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
      const capabilities = (await describeSystemForDisplay(parts[1]!, locale))
        .capabilities;
      const action = await session.choose(
        [
          ...graphMenuChoices("system.resource"),
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
    // Reject human-only approval actions before resolving their dynamic ID.
    if (
      parts[0] === "approval" &&
      (parts[2] === "approve" || parts[2] === "reject")
    )
      interactive(locale, parts);
    if (!operationOutputDeferred) {
      definedCommand = await parseCurrentCommand();
      commandFlags = {
        ...commandFlags,
        ...commandIntentValues(definedCommand.intent),
      };
      resolvedCommandId = definedCommand.intent.commandId;
      if (definedCommand.missingFields.length)
        throw new BenchPilotError(
          "USAGE_ERROR",
          2,
          `Missing required fields: ${definedCommand.missingFields.join(", ")}.`,
          false,
          undefined,
          [],
          { helpPath: parts, fields: definedCommand.missingFields },
        );
    }
    writeSelectedCommand();
    const deferredConfirmation =
      definedCommand?.intent.commandId === "lock.clear" ||
      definedCommand?.intent.commandId === "approval.approve" ||
      definedCommand?.intent.commandId === "approval.reject";
    if (
      definedCommand?.intent.handlerId &&
      hasOutcomePage(definedCommand.intent.commandId) &&
      !deferredConfirmation
    ) {
      const outcome = await scope.commandGraph.dispatcher.dispatch(
        definedCommand.intent,
      );
      if (definedCommand.intent.commandId === "adapter.install")
        screenOperationReporter?.complete();
      renderDataPage({
        command: {
          id: definedCommand.intent.commandId,
          path: [...definedCommand.intent.path],
        },
        page: outcomeDataPage(definedCommand.intent, outcome, {
          approvalPresentation: {
            projectId: (config.value.project as Json | undefined)?.id as
              string | undefined,
            projectName: (config.value.project as Json | undefined)?.name as
              string | undefined,
          },
        }),
        flags,
        locale:
          definedCommand.intent.commandId === "language.set" &&
          isLocale(definedCommand.intent.input.locale)
            ? definedCommand.intent.input.locale
            : locale,
        color: colorEnabled(flags, stdout.isTTY),
        ...(["doctor", "adapter.doctor"].includes(
          definedCommand.intent.commandId,
        )
          ? { messageResolver: adapterMessageResolver(locale) }
          : {}),
      });
      return;
    }
    if (parts[0] === "device" && ["list", "scan"].includes(parts[1]!)) {
      if (parts.length !== 2)
        fail("USAGE_ERROR", 2, `device ${parts[1]} takes no arguments.`);
      if (parts[1] === "list") {
        renderDataPage({
          command: { id: "device.list", path: ["device", "list"] },
          page: deviceListDataPage(queries.listConfiguredDevices()),
          flags,
          locale,
          color: colorEnabled(flags, stdout.isTTY),
        });
        return;
      }
      if (parts[1] === "scan") {
        renderDataPage({
          command: { id: "device.scan", path: ["device", "scan"] },
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
      renderDataPage({
        command: { id: "device.add", path: ["device", "add"] },
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
      renderDataPage({
        command: { id: "device.remove", path: [...parts] },
        page: deviceRemovedDataPage({
          instance: parts[2]!,
          path: (outcome.data as { path: string }).path,
        }),
        flags,
        locale,
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
        renderHelp: renderDefinitionHelp,
        localizeCapabilities: (adapterId, capabilities) =>
          localizeAdapterCapabilities(
            application.registry.get(adapterId),
            locale,
            capabilities,
          ),
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
        ...(operationReporter ? { reporter: operationReporter } : {}),
        output: stdout,
        locale,
        color: colorEnabled(flags, stdout.isTTY),
        columns: stdout.columns ?? 80,
      })
    )
      return;
    if (parts[0] === "system" && parts[1] === "list") {
      if (parts.length !== 2)
        fail("USAGE_ERROR", 2, "system list takes no arguments.");
      renderDataPage({
        command: { id: "system.list", path: ["system", "list"] },
        page: systemListDataPage(queries.listSystems()),
        flags,
        locale,
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
      renderDataPage({
        command: { id: "system.create", path: [...parts] },
        page: configMutationDataPage({
          ...(outcome.data as Omit<
            Parameters<typeof configMutationDataPage>[0],
            "action"
          >),
          action: "set",
        }),
        flags,
        locale,
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
      renderDataPage({
        command: { id: "system.delete", path: [...parts] },
        page: configMutationDataPage({
          ...(outcome.data as Omit<
            Parameters<typeof configMutationDataPage>[0],
            "action"
          >),
          action: "unset",
        }),
        flags,
        locale,
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
      const current = await systems.describe(systemName);
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
      renderDataPage({
        command: { id: `system.member.${action}`, path: [...parts] },
        page: configMutationDataPage({
          ...(outcome.data as Omit<
            Parameters<typeof configMutationDataPage>[0],
            "action"
          >),
          action: "set",
        }),
        flags,
        locale,
        color: colorEnabled(flags, stdout.isTTY),
      });
      return;
    }
    if (parts[0] === "system" && parts[1] && parts[1] !== "list") {
      const system = await describeSystemForDisplay(parts[1], locale);
      if (parts.length === 2 || parts[2] === "show") {
        if (parts.length > 3)
          fail("USAGE_ERROR", 2, "system show takes no arguments.");
        renderDataPage({
          command: { id: "system.show", path: [...parts] },
          page: systemDetailDataPage(system),
          flags,
          locale,
          color: colorEnabled(flags, stdout.isTTY),
        });
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
      let safetyConfirmed = definition.safety.mode === "normal";
      if (definition.safety.mode !== "normal" && definition.safety.flag) {
        if (canConfirmOperationInteractively) {
          if (
            !(await interactive(locale, parts).confirm(
              t(locale, "approval.safetyConfirm"),
            ))
          )
            return;
          safetyConfirmed = true;
        } else
          safetyConfirmed = optionEnabled(rawOptions, definition.safety.flag);
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
      const command = {
        id: "system.execute",
        path: parts.slice(0, 3),
      };
      operationReporter?.configure(command);
      const outcome = await systems.executeDetailed(parts[1], parts[2], input, {
        ...(canConfirmOperationInteractively &&
        definition.safety.mode !== "normal"
          ? { executionMode: "interactive" as const }
          : {}),
        safetyConfirmed,
      });
      const result = capabilityResultFromSystem({ command, result: outcome });
      renderCapabilityResult({
        result,
        flags,
        output: stdout,
        reporter: operationReporter,
        locale,
        color: colorEnabled(flags, stdout.isTTY),
        columns: stdout.columns ?? 80,
      });
      screenOperationReporter?.complete();
      if (!result.ok)
        process.exitCode =
          outcome.results.find((member) => member.outcome?.primaryError)
            ?.outcome?.primaryError?.exitCode ?? 5;
      return;
    }
    if (
      await handleRuntimeCommand({
        flags,
        intent: definedCommand!.intent,
        dispatcher: scope.commandGraph.dispatcher,
        locale,
        color: colorEnabled(flags, stdout.isTTY),
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
    const command = {
      id:
        resolvedCommandId ??
        (invokedPath.length ? invokedPath.join(".") : "root"),
      path: [...invokedPath],
    };
    const result = commandFailureResult({
      command,
      error: err,
      kind: isInteractionFailure(err.kind) ? "interaction" : "data",
      startedAt: commandStartedAt,
    });
    const needsHelp = [
      "AGENT_INTERACTION_UNSUPPORTED",
      "INTERACTIVE_MACHINE_OUTPUT_UNSUPPORTED",
      "INTERACTIVE_TERMINAL_REQUIRED",
    ].includes(err.kind);
    const failureHelpPath = (
      err.details as { helpPath?: readonly string[] } | undefined
    )?.helpPath;
    const failureHelp =
      needsHelp && renderFailureHelp
        ? await renderFailureHelp(failureHelpPath ?? []).catch(() => undefined)
        : undefined;
    renderFailure({
      result,
      command,
      flags,
      terminalEmitted: Boolean(
        (err as BenchPilotError & { operationTerminalReported?: boolean })
          .operationTerminalReported,
      ),
      humanMessage: `${terminalTheme(colorEnabled(flags, stdout.isTTY)).danger(` ${err.kind} `)}: ${humanErrorMessage(
        presentationLocale,
        err.kind,
        err.message,
        typeof (err.details as { adapter?: unknown }).adapter === "string"
          ? { adapter: String((err.details as { adapter: unknown }).adapter) }
          : undefined,
      )}`,
      ...(failureHelp ? { help: failureHelp.trimEnd() } : {}),
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
    terminal?.close();
  }
}
if (process.env.BENCHPILOT_NO_AUTORUN !== "1") void main();
