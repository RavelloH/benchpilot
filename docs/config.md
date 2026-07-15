# Configuration

BenchPilot requires Node.js 22.13 or newer. pnpm 11 is used for repository
development and CI; users installing the package with npm do not need pnpm.
Global configuration is stored at `~/.benchpilot/config.toml` on Windows, macOS, and Linux. Persistent state lives below `~/.benchpilot/state/`; project Runs are isolated at `state/projects/<project-key>/runs`, including when `BENCHPILOT_HOME` is set. Approval data and its guards share this persistent root. Physical Locks and their guards remain in the system runtime/temp area.
Unsafe key segments are rejected and credential-like values are redacted from Run
snapshots.

Project discovery walks upwards for `benchpilot.toml`. The local override is `.benchpilot/config.local.toml`; `BENCHPILOT_HOME` only changes the persistent root (for example, its Runs live at `$BENCHPILOT_HOME/state/projects/<project-key>/runs`) and is useful for isolated tests and automation. Objects merge recursively, scalars override, and arrays replace. `config explain` reports the resolved value and source.
