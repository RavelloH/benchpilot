# BenchPilot

BenchPilot ships a simulated Demo adapter and a declarative ESP-IDF adapter for real Espressif hardware. Runtime requires Node.js >= 22.13. Repository development uses pnpm 11, while package users can install and run the tarball with npm alone.

BenchPilot is an agent-friendly, local-first device lifecycle CLI. Version `0.0.0` ships the **software-simulated Demo Adapter** and an opt-in ESP-IDF hardware Adapter. The ESP-IDF Adapter only performs hardware operations through declared capabilities, the Operation Runner, Device Locks, and human approval where required. Running the installed package requires Node.js 22.13 or newer. The repository uses pnpm 11 for development and CI; npm package users do not need pnpm.

## Quick start

```bash
pnpm install
pnpm run build
node dist/cli/index.js init
node dist/cli/index.js device demo deploy --json
node dist/cli/index.js device demo capture
```

The command tree covers configuration, adapters/devices, systems, runs, locks and approvals. Device and adapter commands are resolved from the configured instance and registered adapter: adding an in-process adapter registration does not require a CLI routing change. Use `benchpilot help --all --json` for discoverable machine-readable help. `--json` emits one final result object; `--jsonl` is a real-time v2 `benchpilot.event` stream with exactly one terminal `operation.completed` or `operation.failed` event. RLog remains responsible for run logs, not public JSONL stdout.

Configuration is merged in this order: CLI input, `BENCHPILOT_*`, `--config`, project-local, project `benchpilot.toml`, global config, defaults. Unsafe key segments (`__proto__`, `prototype`, and `constructor`) are rejected; run snapshots redact common credential keys. Global config uses `~/.benchpilot/config.toml`; persistent project state uses `<project>/.benchpilot/state/`. `benchpilot init --project-id <id> --project-name <name> --locale <en|zh-CN>` creates a minimal project and a project-local display-language setting; it deliberately does not create a device configuration. Locks and Guards live in the system runtime/temp area and use a hashed physical-resource identity rather than raw device IDs in file names.

Interactive command nodes use menu selections where a value can be discovered.
They are for humans only: agent identity uses a fixed environment/file marker
contract, not SSH, TTY, or CI heuristics. Agents should provide complete flags;
an interactive request returns a structured error in `--json`/`--jsonl` mode.
The future `benchpilot setup` environment wizard is intentionally not exposed in
this release.

The bundled Demo Adapter is declarative. It simulates `status`, `info`,
`build`, `flash`, `reset`, `capture`, and `deploy` through fixed Node scripts
with `shell: false`; it never contacts hardware or the network. `build` writes
its simulated firmware only inside the current Run and registers it as an
Artifact.

The bundled `esp-idf` Adapter provides passive ESP serial discovery, ESP-IDF
project lifecycle actions, esptool information and reset operations, and
approval-protected flashing. It does not implement erase/eFuse/JTAG/OTA or an
interactive serial monitor. See [ESP-IDF](docs/adapters/esp-idf.md) for setup
and its opt-in hardware test procedure.

See [architecture](docs/architecture.md), [CLI](docs/cli.md), [configuration](docs/config.md), [adapters](docs/adapters.md), [declarative adapter format](docs/adapter-format.md), [runs](docs/logging-and-runs.md), [locks](docs/locks.md), [safety](docs/safety.md), and [process runner](docs/process-runner.md).

## Development

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm pack --dry-run
```

Suggested first release after expanding tests and hardening the TOML editor: `0.1.0`.

## Commit convention

Use Conventional Commits with a mandatory scope:
`<type>(<scope>): <imperative summary>`. Valid types are `feat`, `fix`,
`docs`, `refactor`, `test`, `build`, `ci`, `chore`, and `perf`; for example,
`feat(cli): add demo deploy command`.
