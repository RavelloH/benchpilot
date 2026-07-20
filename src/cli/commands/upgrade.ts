import type { CommandReference } from "../../contracts/index.js";
import { t, type Locale } from "../../i18n/index.js";
import {
  upgradeCheckDataPage,
  upgradeResultDataPage,
} from "../data/upgrade.js";
import type { CliDataPage } from "../data/page.js";
import type { InteractionSession } from "../interaction/prompter.js";
import {
  checkForUpgrade,
  compareUpgradeVersion,
  upgradeBenchPilot,
} from "../upgrade.js";
import { fail } from "../../core.js";

export interface UpgradeCommandHandlerInput {
  readonly path: readonly string[];
  readonly loadLocale: () => Promise<Locale>;
  readonly executable: string;
  readonly interaction: () => InteractionSession;
  readonly selected: () => void;
  readonly render: (input: {
    readonly command: CommandReference;
    readonly page: CliDataPage<object>;
  }) => void;
}

/** CLI-local upgrade workflow with all rendering delegated to the caller. */
export const handleUpgradeCommand = async (
  input: UpgradeCommandHandlerInput,
) => {
  if (input.path[0] !== "upgrade") return false;
  const locale = await input.loadLocale();
  if (input.path.length > 2)
    fail("USAGE_ERROR", 2, "upgrade accepts check, latest, or a version.");
  const info = await checkForUpgrade(input.executable);
  const renderCheck = () =>
    input.render({
      command: { id: "upgrade.check", path: [...input.path] },
      page: upgradeCheckDataPage(info),
    });
  if (input.path.length === 1) {
    if (!info.updateAvailable) {
      renderCheck();
      return true;
    }
    const selected = await input.interaction().choose(
      info.versions
        .filter(
          (candidate) =>
            compareUpgradeVersion(candidate, info.currentVersion) > 0,
        )
        .map((candidate, index) => ({
          value: candidate,
          label:
            index === 0
              ? t(locale, "upgradeResult.recommendedVersion", {
                  version: candidate,
                })
              : candidate,
        })),
      { commandPath: ["upgrade"], nextBackPath: ["upgrade"] },
    );
    input.selected();
    input.render({
      command: { id: "upgrade.version", path: ["upgrade", selected] },
      page: upgradeResultDataPage(await upgradeBenchPilot(info, selected)),
    });
    return true;
  }
  if (input.path[1] === "check") {
    renderCheck();
    return true;
  }
  const requested = input.path[1]!;
  const targetVersion = requested === "latest" ? info.latestVersion : requested;
  if (!targetVersion)
    fail("UPGRADE_VERSION_NOT_FOUND", 2, "No published version is available.");
  input.render({
    command: {
      id: requested === "latest" ? "upgrade.latest" : "upgrade.version",
      path: [...input.path],
    },
    page: upgradeResultDataPage(await upgradeBenchPilot(info, targetVersion!)),
  });
  return true;
};
