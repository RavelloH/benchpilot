import type { UpgradeInfo } from "../upgrade.js";
import type { CliDataPage } from "./page.js";

export const upgradeCheckDataPage = (
  info: UpgradeInfo,
): CliDataPage<object> => ({
  data: { schema: "benchpilot.upgrade-check", version: 1, ...info },
});

export const upgradeResultDataPage = (data: object): CliDataPage<object> => ({
  data,
});
