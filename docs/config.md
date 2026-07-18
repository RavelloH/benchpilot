# Configuration

BenchPilot requires Node.js 22.13 or newer. pnpm 11 is used for repository
development and CI; users installing the package with npm do not need pnpm.
Global configuration is stored at `~/.benchpilot/config.toml` on Windows, macOS, and Linux. Persistent state belongs to the discovered project at `<project>/.benchpilot/state/`: Runs live in `runs/`, and approval data and its guards share that project state root. Physical Locks, lock guards, and lock recovery records remain in the system runtime/temp area because they protect physical resources across projects.
Unsafe key segments are rejected and credential-like values are redacted from Run
snapshots.

Project discovery walks upwards for `benchpilot.toml`. The local override is `.benchpilot/config.local.toml`. Objects merge recursively, scalars override, and arrays replace. `config explain` reports the resolved value and source.
