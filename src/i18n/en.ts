import type { MessageCatalog } from "./types.js";

export const en: MessageCatalog = {
  "cli.interaction.agent":
    "This command requires an interactive human session and cannot be run by an agent.",
  "cli.interaction.terminal": "This command requires an interactive terminal.",
  "cli.interaction.machine":
    "This command requires interactive input and cannot be used with machine output.",
  "cli.interaction.cancelled": "Interaction cancelled.",
  "init.language": "Select display language",
  "init.projectId": "Project ID",
  "init.projectName": "Project name",
  "init.locale": "Display language",
  "init.done": "Initialized BenchPilot project.",
  "error.unknown": "Command failed: {message}",
};
