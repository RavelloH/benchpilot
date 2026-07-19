import type { UpgradeInfo } from "../upgrade.js";
import { terminalTheme } from "../presentation/theme.js";
import type { CliDataPage } from "./page.js";

export const upgradeCheckDataPage = (
  info: UpgradeInfo,
): CliDataPage<object> => ({
  data: { schema: "benchpilot.upgrade-check", version: 1, ...info },
  screen: ({ color }) => {
    const theme = terminalTheme(color);
    const rows = [
      ["包管理器", info.packageManager],
      ["当前版本", info.currentVersion],
      ["最新版本", info.latestVersion || "—"],
      ["更新状态", info.updateAvailable ? "可更新" : "已是最新"],
    ];
    return [
      {
        text: theme.heading("BenchPilot 更新"),
        children: rows.map(([key, value]) => ({
          text: `${theme.muted(`${key}    `)}${theme.argument(value)}`,
        })),
      },
    ];
  },
});

export const upgradeResultDataPage = (data: object): CliDataPage<object> => ({
  data,
  screen: ({ color }) => {
    const theme = terminalTheme(color);
    const value = data as {
      packageManager: string;
      previousVersion: string;
      installedVersion: string;
    };
    return [
      {
        text: theme.heading("BenchPilot 已升级"),
        children: [
          {
            text: `${theme.muted("包管理器    ")}${theme.argument(value.packageManager)}`,
          },
          {
            text: `${theme.muted("版本        ")}${theme.argument(`${value.previousVersion} → ${value.installedVersion}`)}`,
          },
        ],
      },
    ];
  },
});
