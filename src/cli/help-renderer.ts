const globalOptions = [
  "--config <path>",
  "--json",
  "--jsonl",
  "--quiet",
  "--verbose",
  "--timeout <duration>",
  "--dry-run",
  "--no-color",
  "--session <name>",
  "--help",
  "--version",
];

const groups: Record<string, { summary: string; children: string[] }> = {
  root: {
    summary: "Agent-first device lifecycle CLI.",
    children: [
      "init",
      "doctor",
      "config",
      "adapters",
      "adapter",
      "devices",
      "device",
      "systems",
      "system",
      "runs",
      "run",
      "locks",
      "lock",
      "approvals",
      "approval",
      "help",
    ],
  },
  config: {
    summary: "Read, explain, validate and safely edit configuration.",
    children: ["get", "set", "unset", "resolved", "explain", "validate"],
  },
  adapters: {
    summary: "List installed adapter definitions.",
    children: ["list"],
  },
  adapter: { summary: "Inspect an adapter.", children: ["<adapter-id>"] },
  devices: {
    summary: "List configured or discovered devices.",
    children: ["list", "scan"],
  },
  device: {
    summary: "Operate a configured device through its capabilities.",
    children: ["<device-instance>"],
  },
  systems: { summary: "List configured systems.", children: ["list"] },
  system: {
    summary: "Orchestrate a configured system.",
    children: ["<system-instance>"],
  },
  runs: {
    summary: "List and prune immutable operation records.",
    children: ["list", "prune"],
  },
  run: { summary: "Inspect a recorded operation.", children: ["<run-id>"] },
  locks: {
    summary: "Inspect physical-resource locks.",
    children: ["list", "clear-stale"],
  },
  lock: { summary: "Inspect or clear one lock.", children: ["<lock-id>"] },
  approvals: { summary: "List local human approval requests.", children: [] },
  approval: {
    summary: "Inspect or resolve one human approval request.",
    children: ["<approval-id>"],
  },
};

function summary(child: string) {
  return (
    (
      {
        get: "Get a resolved configuration value",
        set: "Set a configuration value",
        unset: "Unset a configuration value",
        resolved: "Show resolved configuration",
        explain: "Explain value provenance",
        validate: "Validate configuration",
        list: "List resources",
        scan: "Discover registered adapter devices",
        init: "Create a demo project",
        doctor: "Check local environment",
        prune: "Remove old run records",
        "clear-stale": "Remove stale locks",
      } as Record<string, string>
    )[child] || "Inspect or operate resource"
  );
}

export function brief(name: string) {
  const group = groups[name] || groups.root;
  return `${name === "root" ? "benchpilot" : `benchpilot ${name}`} — ${group.summary}\n\nUsage: benchpilot${name === "root" ? "" : ` ${name}`} <command>\n\nCommands:\n${group.children.map((child) => `  ${child.padEnd(17)} ${summary(child)}`).join("\n")}\n\nGlobal options: ${globalOptions.slice(0, 5).join("  ")}\nRun 'benchpilot${name === "root" ? "" : ` ${name}`} --help' for complete help.\n`;
}

export function fullHelp(parts: string[]) {
  const pathName = parts.join(" ") || "benchpilot";
  return {
    schema: "benchpilot.help",
    version: 1,
    path: parts,
    summary: groups[parts.at(-1) || "root"]?.summary || "BenchPilot command",
    description:
      "Command definitions drive parsing, help, validation, safety and execution.",
    arguments: [],
    options: globalOptions,
    safety: { mode: "normal" },
    errors: ["USAGE_ERROR", "CONFIG_ERROR", "DEVICE_BUSY", "OPERATION_TIMEOUT"],
    examples: [`benchpilot ${pathName} --json`],
  };
}

export function humanFull(parts: string[]) {
  const help = fullHelp(parts);
  return `NAME\n  benchpilot ${parts.join(" ")} — ${help.summary}\n\nSYNOPSIS\n  benchpilot ${parts.join(" ")} [OPTIONS]\n\nDESCRIPTION\n  ${help.description}\n\nWORKFLOW\n  Configuration → adapter → capability → operation runner → run record.\n\nARGUMENTS\n  See command path.\n\nOPTIONS\n  ${globalOptions.join("\n  ")}\n\nCONFIGURATION\n  global, project, local, explicit file and BENCHPILOT_* variables are merged.\n\nOUTPUT\n  Human summary by default; --json result or --jsonl structured events.\n\nSAFETY\n  ${JSON.stringify(help.safety)}\n\nEXIT CODES\n  0 success; 2 usage; 3 configuration/resource; 4 lock; 5 operation; 6 timeout; 7 safety; 8 internal.\n\nERROR KINDS\n  ${help.errors.join(", ")}\n\nEXAMPLES\n  ${help.examples.join("\n  ")}\n\nSEE ALSO\n  benchpilot help --all\n`;
}

export const systemCapabilities = [
  "info",
  "status",
  "deploy",
  "smoke",
  "collect",
  "emergency-stop",
];
export const commandGroups = Object.keys(groups);
export const isCommandGroup = (name: string | undefined) =>
  Boolean(name && groups[name]);
