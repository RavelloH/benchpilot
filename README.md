# BenchPilot

BenchPilot currently ships only the simulated Demo adapter; real hardware adapters are deliberately not included. Runtime requires Node.js >= 22.13. Repository development uses pnpm 11, while package users can install and run the tarball with npm alone.

BenchPilot is an agent-friendly, local-first device lifecycle CLI. Version `0.0.0` is the first usable framework release and deliberately supports only the **software-simulated Demo Adapter**. It does not communicate with hardware, serial ports, probes, SSH, or vendor tools. Running the installed package requires Node.js 22.13 or newer. The repository uses pnpm 11 for development and CI; npm package users do not need pnpm.

## Quick start

```bash
pnpm install
pnpm run build
node dist/cli/index.js init
node dist/cli/index.js device demo deploy --json
node dist/cli/index.js device demo capture
```

The command tree covers configuration, adapters/devices, systems, runs, locks and approvals. Device and adapter commands are resolved from the configured instance and registered adapter: adding an in-process adapter registration does not require a CLI routing change. Use `benchpilot help --all --json` for discoverable machine-readable help. `--json` emits one final result object; `--jsonl` is a real-time `benchpilot.event` stream with exactly one terminal `operation.completed` or `operation.failed` event. RLog remains responsible for run logs, not public JSONL stdout.

Configuration is merged in this order: CLI input, `BENCHPILOT_*`, `--config`, project-local, project `benchpilot.toml`, global config, defaults. Unsafe key segments (`__proto__`, `prototype`, and `constructor`) are rejected; run snapshots redact common credential keys. Global config and persistent state use `~/.benchpilot/` on every platform. `benchpilot init` creates the minimal demo project without placing logs in the project. Locks and Guards live in the system runtime/temp area and use a hashed physical-resource identity rather than raw device IDs in file names.

The bundled Demo Adapter is declarative. It simulates `status`, `info`,
`build`, `flash`, `reset`, `capture`, and `deploy` through fixed Node scripts
with `shell: false`; it never contacts hardware or the network. `build` writes
its simulated firmware only inside the current Run and registers it as an
Artifact.

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
