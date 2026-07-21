import type {
  CommandIntent,
  CommandOutcome,
} from "../../application/commands/contracts.js";
import type { LockRecord } from "../../core.js";
import {
  adapterDoctorDataPage,
  adapterInfoDataPage,
  adapterListDataPage,
  adapterStateDataPage,
} from "./adapter.js";
import {
  approvalChangeDataPage,
  approvalDetailDataPage,
  approvalListDataPage,
  type ApprovalScreenPresentation,
} from "./approval.js";
import {
  configExplainDataPage,
  configGetDataPage,
  configMutationDataPage,
  configResolvedDataPage,
  configValidateDataPage,
} from "./config.js";
import { doctorDataPage } from "./doctor.js";
import { languageListPage, languagePage } from "./language.js";
import {
  lockClearDataPage,
  lockClearStaleDataPage,
  lockDetailDataPage,
  lockListDataPage,
} from "./lock.js";
import type { CliDataPage } from "./page.js";
import {
  runArtifactsDataPage,
  runDetailDataPage,
  runListDataPage,
  runLogDataPage,
  runPruneDataPage,
} from "./run.js";

export interface OutcomePageContext {
  readonly approvalPresentation?: ApprovalScreenPresentation;
}

type OutcomePageFactory = (
  intent: CommandIntent,
  outcome: CommandOutcome,
  context: OutcomePageContext,
) => CliDataPage<object>;

const factories: Readonly<Record<string, OutcomePageFactory>> = {
  "language.list": (_intent, outcome) =>
    languageListPage(
      outcome.data as unknown as Parameters<typeof languageListPage>[0],
    ),
  "language.get": (_intent, outcome) =>
    languagePage(outcome.data as unknown as Parameters<typeof languagePage>[0]),
  "language.set": (_intent, outcome) =>
    languagePage(outcome.data as unknown as Parameters<typeof languagePage>[0]),
  "config.get": (_intent, outcome) =>
    configGetDataPage(outcome.data as Parameters<typeof configGetDataPage>[0]),
  "config.resolved": (_intent, outcome) =>
    configResolvedDataPage(
      outcome.data as Parameters<typeof configResolvedDataPage>[0],
    ),
  "config.explain": (_intent, outcome) =>
    configExplainDataPage(
      outcome.data as Parameters<typeof configExplainDataPage>[0],
    ),
  "config.validate": () => configValidateDataPage(),
  "config.set": (_intent, outcome) =>
    configMutationDataPage({
      ...(outcome.data as Omit<
        Parameters<typeof configMutationDataPage>[0],
        "action"
      >),
      action: "set",
    }),
  "config.unset": (_intent, outcome) =>
    configMutationDataPage({
      ...(outcome.data as Omit<
        Parameters<typeof configMutationDataPage>[0],
        "action"
      >),
      action: "unset",
    }),
  doctor: (_intent, outcome) =>
    doctorDataPage(outcome.data as Parameters<typeof doctorDataPage>[0]),
  "adapter.list": (_intent, outcome) =>
    adapterListDataPage(
      outcome.data as Parameters<typeof adapterListDataPage>[0],
    ),
  "adapter.show": (_intent, outcome) =>
    adapterInfoDataPage(
      outcome.data as Parameters<typeof adapterInfoDataPage>[0],
    ),
  "adapter.doctor": (intent, outcome) =>
    adapterDoctorDataPage(
      String(intent.input.adapter),
      outcome.data as Parameters<typeof adapterDoctorDataPage>[1],
    ),
  "adapter.enable": (_intent, outcome) =>
    adapterStateDataPage(
      outcome.data as Parameters<typeof adapterStateDataPage>[0],
    ),
  "adapter.disable": (_intent, outcome) =>
    adapterStateDataPage(
      outcome.data as Parameters<typeof adapterStateDataPage>[0],
    ),
  "run.list": (_intent, outcome) =>
    runListDataPage(outcome.data as Parameters<typeof runListDataPage>[0]),
  "run.prune": (_intent, outcome) =>
    runPruneDataPage(outcome.data as Parameters<typeof runPruneDataPage>[0]),
  "run.show": (_intent, outcome) =>
    runDetailDataPage(outcome.data as Parameters<typeof runDetailDataPage>[0]),
  "run.logs": (_intent, outcome) =>
    runLogDataPage(outcome.data as Parameters<typeof runLogDataPage>[0]),
  "run.artifacts": (_intent, outcome) =>
    runArtifactsDataPage(
      outcome.data as Parameters<typeof runArtifactsDataPage>[0],
    ),
  "lock.list": (_intent, outcome) =>
    lockListDataPage(outcome.data as Parameters<typeof lockListDataPage>[0]),
  "lock.clear-stale": (_intent, outcome) =>
    lockClearStaleDataPage(
      (outcome.data as { cleared: readonly string[] }).cleared,
    ),
  "lock.show": (_intent, outcome) =>
    lockDetailDataPage(
      outcome.data as unknown as Parameters<typeof lockDetailDataPage>[0],
    ),
  "lock.inspect": (_intent, outcome) =>
    lockDetailDataPage(
      outcome.data as unknown as Parameters<typeof lockDetailDataPage>[0],
    ),
  "lock.clear": (_intent, outcome) =>
    lockClearDataPage((outcome.data as { cleared: LockRecord }).cleared),
  "approval.list": (_intent, outcome) =>
    approvalListDataPage(
      (
        outcome.data as {
          approvals: Parameters<typeof approvalListDataPage>[0];
        }
      ).approvals,
    ),
  "approval.inspect": (_intent, outcome, context) =>
    approvalDetailDataPage(
      outcome.data as unknown as Parameters<typeof approvalDetailDataPage>[0],
      context.approvalPresentation,
    ),
  "approval.approve": (_intent, outcome) =>
    approvalChangeDataPage(
      outcome.data as Parameters<typeof approvalChangeDataPage>[0],
    ),
  "approval.reject": (_intent, outcome) =>
    approvalChangeDataPage(
      outcome.data as Parameters<typeof approvalChangeDataPage>[0],
    ),
};

export const hasOutcomePage = (commandId: string) => commandId in factories;

export const outcomeDataPage = (
  intent: CommandIntent,
  outcome: CommandOutcome,
  context: OutcomePageContext = {},
) => {
  const factory = factories[intent.commandId];
  if (!factory) throw new Error(`No outcome page for ${intent.commandId}.`);
  return factory(intent, outcome, context);
};
