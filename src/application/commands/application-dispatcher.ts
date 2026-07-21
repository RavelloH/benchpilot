import { BenchPilotError, type Json } from "../../core.js";
import type { ConfigurationCommandUseCases } from "../config/command-use-case.js";
import type { AdapterManagementUseCases } from "../adapters/management-use-case.js";
import type { AdapterConfigurationUseCases } from "../adapters/configuration-use-case.js";
import type { AdapterInstallationUseCases } from "../adapters/installation-use-case.js";
import type { QueryUseCases } from "../queries/use-case.js";
import type { RuntimeCommandUseCases } from "../runtime/command-use-case.js";
import type { CommandIntent, CommandOutcome } from "./contracts.js";
import { CommandDispatcher } from "./dispatcher.js";

interface ApplicationCommandDispatcherDependencies {
  readonly configuration: ConfigurationCommandUseCases;
  readonly adapterManagement: AdapterManagementUseCases;
  readonly adapterConfiguration: AdapterConfigurationUseCases;
  readonly adapterInstallation: AdapterInstallationUseCases;
  readonly runtime: RuntimeCommandUseCases;
  readonly queries: QueryUseCases;
  readonly resolvedConfig: { readonly value: Json };
}

const cliLanguages = [
  { locale: "en", name: "English" },
  { locale: "zh-CN", name: "简体中文" },
] as const;

const languageData = (locale: string) =>
  cliLanguages.find((language) => language.locale === locale) ?? {
    locale,
    name: locale,
  };

const configuredCliLocale = (config: Json) => {
  const cli =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, Json>).cli
      : undefined;
  const locale =
    cli && typeof cli === "object" && !Array.isArray(cli)
      ? (cli as Record<string, Json>).locale
      : undefined;
  return typeof locale === "string" ? locale : "en";
};

const text = (value: unknown) =>
  value === undefined ? undefined : String(value);

const outcome = (
  intent: CommandIntent,
  kind: string,
  data: Json,
): CommandOutcome => ({ commandId: intent.commandId, kind, data });

/** Registers transport-neutral handlers for every non-operation Application command. */
export const createApplicationCommandDispatcher = (
  dependencies: ApplicationCommandDispatcherDependencies,
) => {
  const dispatcher = new CommandDispatcher();
  dispatcher.register("language.list", (intent) =>
    outcome(intent, "language.list", {
      schema: "benchpilot.language-list",
      version: 1,
      languages: cliLanguages,
    }),
  );
  dispatcher.register("language.get", (intent) =>
    outcome(intent, "language.get", {
      schema: "benchpilot.language",
      version: 1,
      language: languageData(
        configuredCliLocale(dependencies.resolvedConfig.value),
      ),
    }),
  );
  dispatcher.register("language.set", async (intent) => {
    const locale = String(intent.input.locale ?? "");
    if (!cliLanguages.some((language) => language.locale === locale))
      throw new BenchPilotError(
        "USAGE_ERROR",
        2,
        `Unsupported CLI language: ${locale}`,
      );
    await dependencies.configuration.execute({
      action: "set",
      key: "cli.locale",
      value: locale,
      scopes: ["global"],
      showOrigin: false,
    });
    return outcome(intent, "language.set", {
      schema: "benchpilot.language",
      version: 1,
      language: languageData(locale),
    });
  });
  for (const action of [
    "get",
    "set",
    "unset",
    "resolved",
    "explain",
    "validate",
  ] as const)
    dispatcher.register(`config.${action}`, async (intent) => {
      const result = await dependencies.configuration.execute({
        action,
        key: text(intent.input.key),
        value: text(intent.input.value),
        scopes: (["local", "project", "global"] as const).filter(
          (scope) => intent.options[scope] === true,
        ),
        showOrigin: intent.options["show-origin"] === true || action === "get",
        enforceCatalog: true,
      });
      return outcome(intent, result.kind, result.data);
    });

  dispatcher.register("doctor.execute", async (intent) =>
    outcome(intent, "doctor", (await dependencies.queries.doctor()) as Json),
  );
  dispatcher.register("adapter.list", (intent) =>
    outcome(
      intent,
      "adapter.list",
      dependencies.queries.listAdapters() as Json,
    ),
  );
  dispatcher.register("adapter.show", (intent) =>
    outcome(
      intent,
      "adapter.show",
      dependencies.queries.adapterInfo(String(intent.input.adapter)) as Json,
    ),
  );
  dispatcher.register("adapter.doctor", async (intent) =>
    outcome(
      intent,
      "adapter.doctor",
      (await dependencies.queries.adapterDoctor(
        String(intent.input.adapter),
      )) as Json,
    ),
  );
  for (const action of ["enable", "disable"] as const)
    dispatcher.register(`adapter.${action}`, async (intent) =>
      outcome(
        intent,
        `adapter.${action}`,
        (await dependencies.adapterManagement.setEnabled(
          String(intent.input.adapter),
          action === "enable",
        )) as unknown as Json,
      ),
    );
  dispatcher.register("adapter.discover", async (intent) =>
    outcome(
      intent,
      "adapter.discover",
      (await dependencies.adapterConfiguration.discover(
        String(intent.input.adapter),
      )) as unknown as Json,
    ),
  );
  dispatcher.register("adapter.configure", async (intent) =>
    outcome(
      intent,
      "adapter.configure",
      (await dependencies.adapterConfiguration.configure(
        String(intent.input.adapter),
        Object.entries(intent.options).flatMap(([key, value]) =>
          typeof value === "string" ? [`${key}=${value}`] : [],
        ),
      )) as unknown as Json,
    ),
  );
  dispatcher.register("adapter.install", async (intent) => {
    const root =
      typeof intent.options.root === "string" ? intent.options.root : undefined;
    return outcome(
      intent,
      "adapter.install",
      (await dependencies.adapterInstallation.install(
        String(intent.input.adapter),
        Object.fromEntries(
          Object.entries(intent.options).filter(
            ([key, value]) => key !== "root" && typeof value === "string",
          ),
        ) as Json,
        root,
      )) as Json,
    );
  });

  const runtime = async (
    intent: CommandIntent,
    action: Parameters<RuntimeCommandUseCases["execute"]>[0]["action"],
    input: Omit<
      Parameters<RuntimeCommandUseCases["execute"]>[0],
      "action"
    > = {},
  ) => {
    const result = await dependencies.runtime.execute({ action, ...input });
    return outcome(intent, result.kind, result.data);
  };
  dispatcher.register("run.list", (intent) =>
    runtime(intent, "runs.list", {
      status: intent.options.status as Json | undefined,
      limit: intent.options.limit as Json | undefined,
    }),
  );
  dispatcher.register("run.prune", (intent) =>
    runtime(intent, "runs.prune", {
      olderThan: intent.options["older-than"] as Json | undefined,
      keep: intent.options.keep as Json | undefined,
      dangerouslyRemoveAllRuns:
        intent.options["dangerously-remove-all-runs"] === true,
    }),
  );
  for (const action of ["show", "logs", "artifacts"] as const)
    dispatcher.register(`run.${action}`, (intent) =>
      runtime(intent, `run.${action}`, { id: text(intent.input.run) }),
    );

  dispatcher.register("lock.list", (intent) => runtime(intent, "locks.list"));
  dispatcher.register("lock.clear-stale", (intent) =>
    runtime(intent, "locks.clear-stale"),
  );
  for (const action of ["show", "inspect"] as const)
    dispatcher.register(`lock.${action}`, (intent) =>
      runtime(intent, "lock.show", { id: text(intent.input.lock) }),
    );
  dispatcher.register("lock.clear", (intent) =>
    runtime(intent, "lock.clear", {
      id: text(intent.input.lock),
      dangerouslyClearActiveLock:
        intent.options["dangerously-clear-active-lock"] === true,
      dangerouslyClearQuarantinedLock:
        intent.options["dangerously-clear-quarantined-lock"] === true,
    }),
  );

  dispatcher.register("approval.list", (intent) =>
    runtime(intent, "approvals.list"),
  );
  dispatcher.register("approval.inspect", (intent) =>
    runtime(intent, "approval.inspect", { id: text(intent.input.approval) }),
  );
  dispatcher.register("approval.approve", (intent) =>
    runtime(intent, "approval.approve", { id: text(intent.input.approval) }),
  );
  dispatcher.register("approval.reject", (intent) =>
    runtime(intent, "approval.reject", { id: text(intent.input.approval) }),
  );
  return dispatcher;
};
