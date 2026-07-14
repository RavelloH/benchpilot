# Configuration

BenchPilot requires Node.js 22.13 or newer. pnpm 11 is used for repository
development and CI; users installing the package with npm do not need pnpm.
Windows machine configuration is stored under `%LOCALAPPDATA%\BenchPilot`.
Unsafe key segments are rejected and credential-like values are redacted from Run
snapshots.

Project discovery walks upwards for `benchpilot.toml`. The local override is `.benchpilot/config.local.toml`; global paths follow the platform conventions and `BENCHPILOT_HOME` creates a portable tree. Objects merge recursively, scalars override, and arrays replace. `config explain` reports the resolved value and source.
