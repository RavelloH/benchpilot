# BenchPilot

BenchPilot is an agent-friendly, local-first device lifecycle CLI. Version `0.0.0` is the first usable framework release and deliberately supports only the **software-simulated Demo Adapter**. It does not communicate with hardware, serial ports, probes, SSH, or vendor tools. BenchPilot requires Node.js 22.13 or newer and pnpm 11.

## Quick start

```bash
pnpm install
pnpm run build
node dist/cli/index.js init
node dist/cli/index.js device demo deploy --json
node dist/cli/index.js device demo capture
```

The command tree covers configuration, adapters/devices, systems, runs, locks and approvals. Device and adapter commands are resolved from the configured instance and registered adapter: adding an in-process adapter registration does not require a CLI routing change. Use `benchpilot help --all --json` for discoverable machine-readable help. `--json` emits one final result object; `--jsonl` streams RLog structured events to stdout and terminates failures with an `operation.failed` event.

Configuration is merged in this order: CLI input, `BENCHPILOT_*`, `--config`, project-local, project `benchpilot.toml`, global config, defaults. Unsafe key segments (`__proto__`, `prototype`, and `constructor`) are rejected; run snapshots redact common credential keys. On Windows global configuration uses `%LOCALAPPDATA%\BenchPilot\config.toml`. `benchpilot init` creates the minimal demo project without placing logs in the project. Runs live in OS state paths (or under `BENCHPILOT_HOME`); locks live in the runtime/temp area and use a hashed physical-resource identity rather than raw device IDs in file names.

Dangerous demo reset requires `--dangerously-reset-demo-state`. The simulated `burn-fuse` operation additionally creates a local approval request and can only consume a matching interactive approval. This is a local workflow guard, not a defense against an attacker with filesystem control.

See [architecture](docs/architecture.md), [CLI](docs/cli.md), [configuration](docs/config.md), [adapters](docs/adapters.md), [runs](docs/logging-and-runs.md), [locks](docs/locks.md), and [safety](docs/safety.md).

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
