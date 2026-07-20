import {
  benchPilotWordmark as smallWordmark,
  benchPilotWordmarkLarge as largeWordmark,
} from "./brand.js";
import { renderScreenNodes, type CliScreenNode } from "./page.js";
import { terminalTheme } from "./theme.js";

const LARGE_WORDMARK_COLUMNS = Math.max(
  ...largeWordmark
    .trim()
    .split("\n")
    .map((line) => line.length),
);

export type VersionPresentation = {
  readonly cliVersion: string;
  readonly nodeVersion: string;
};

/** Structured version page for screen, JSON, and JSONL projection. */
export function versionPage(
  input: VersionPresentation,
  color = false,
  showWordmark = true,
  columns?: number,
): readonly CliScreenNode[] {
  const theme = terminalTheme(color);
  const wordmark =
    columns === undefined || columns >= LARGE_WORDMARK_COLUMNS
      ? largeWordmark
      : smallWordmark;
  return [
    ...(showWordmark
      ? [
          {
            // Keep the source wordmark intact: its leading newline and spaces
            // are part of the alignment shared with the interactive home.
            text: theme.brand(wordmark),
          },
        ]
      : []),
    {
      children: [
        {
          text: theme.heading(`BenchPilot v${input.cliVersion}`),
        },
        {
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
  columns?: number,
) {
  return renderScreenNodes(versionPage(input, color, showWordmark, columns));
}
