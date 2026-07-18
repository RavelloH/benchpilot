import { benchPilotWordmarkLarge as largeWordmark } from "./brand.js";
import { screenPresentation, type CliNode } from "./page.js";
import { terminalTheme } from "./theme.js";

const visibleEverywhere = ["screen", "json", "jsonl"] as const;

export type VersionPresentation = {
  readonly cliVersion: string;
  readonly nodeVersion: string;
};

/** Structured version page for screen, JSON, and JSONL projection. */
export function versionPage(
  input: VersionPresentation,
  color = false,
  showWordmark = true,
): readonly CliNode[] {
  const theme = terminalTheme(color);
  return [
    ...(showWordmark
      ? [
          {
            name: "logo",
            visibility: ["screen"] as const,
            text: theme.brand(largeWordmark.trimStart()),
          },
        ]
      : []),
    {
      name: "version",
      visibility: visibleEverywhere,
      children: [
        {
          name: "cli",
          visibility: visibleEverywhere,
          text: theme.heading(`BenchPilot v${input.cliVersion}`),
        },
        {
          name: "node",
          visibility: visibleEverywhere,
          text: theme.muted(`Node.js ${input.nodeVersion}`),
        },
      ],
    },
  ];
}

export function renderVersion(
  input: VersionPresentation,
  color = false,
  showWordmark = true,
) {
  return screenPresentation(versionPage(input, color, showWordmark));
}
