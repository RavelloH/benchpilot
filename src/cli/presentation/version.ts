import { benchPilotWordmarkLarge as largeWordmark } from "./brand.js";
import { terminalTheme } from "./theme.js";

export function renderVersion(
  input: {
    cliVersion: string;
    nodeVersion: string;
  },
  color = false,
  showWordmark = true,
) {
  const theme = terminalTheme(color);
  const benchPilotWordmarkLarge = showWordmark ? largeWordmark : "";
  return `${theme.brand(benchPilotWordmarkLarge.trimStart())}\n\n${theme.heading(`BenchPilot v${input.cliVersion}`)}\n${theme.muted(`Node.js ${input.nodeVersion}`)}\n`;
}
