# Declarative Adapter Runtime

BenchPilot executes production adapters from compiled Bundle v1 files in
`dist/adapters`. The runtime never reads an adapter's TOML files from a user
project and resolves the bundle directory relative to its own module, so npm
installs work from any current directory.

The execution path is Bundle Loader, adapter registry, JSON Schema validation,
tool/environment resolution, action or workflow planning, the Core operation
lifecycle, parsing, artifact registration, and output validation. Locks,
approvals, Runs, cleanup, quarantine and JSON/JSONL terminal events remain
owned by Core.

The compiled `builtin/demo` bundle is the default Demo implementation. It is
not an adapter extension mechanism: production loading remains limited to the
bundles shipped with the package.

Templates are deliberately limited to `${namespace.path}` lookups. Execution
critical templates fail with `ADAPTER_TEMPLATE_VALUE_MISSING` when a value is
absent; they never become an empty executable path, working directory or
argument. Process actions always use an argv array and the shared Process
Runner with `shell: false`. Serial plans are accepted but report
`ADAPTER_EXECUTOR_UNAVAILABLE` until a future runtime version supplies a
serial executor.

The built-in Demo intentionally invokes only fixed `node -e` scripts declared
in the shipped Bundle. User input is passed as data, never inserted into script
source. Its build action writes only inside the operation Run and registers a
firmware artifact.

## Runtime Context and safety boundary

Every execution starts with `adapter`, `platform`, `config`, `device`, `input`,
`project`, `home`, `temp`, `env`, `run` (when the Core created one), and empty `tool`,
`discovery`, `environment`, and `result` namespaces. Tool resolution and
Parser output update that live Context. Workflow steps are rendered one at a
time, so a following step can use `${result.previous.value}` and
`${step.result.value}` safely.

Process output is mirrored to RLog, while the parser receives the same stream.
The runtime retains a bounded head/tail capture (4 MiB per stream) and records
whether either stream was truncated. It never uses `console.log` for tool
output. Serial execution remains deliberately unavailable.

Dangerous process actions mark the Core effect boundary only after `spawn`;
dangerous copy actions mark it immediately before their first write. Core keeps
approval consumption, cleanup, lock release and quarantine ownership.

## Deadlines, discovery and extensions

An action with an explicit timeout is bounded by that timeout and the remaining
Capability deadline. An action without one inherits the remaining Capability
deadline; a Workflow can additionally establish a shorter Workflow deadline.
Core operation cancellation remains the outer boundary and retains its own
`OPERATION_TIMEOUT` error. Runtime timeout failures are serializable
`ADAPTER_ACTION_TIMEOUT`, `ADAPTER_WORKFLOW_TIMEOUT`, or
`ADAPTER_TOOL_PROBE_TIMEOUT` errors with retry guidance.

`benchpilot devices scan` is passive. The bundled runtime only enumerates
available serial path candidates on POSIX and can consume declared static
records for fixtures; it neither opens a serial port nor changes DTR/RTS.
An Adapter Probe is never part of an ordinary scan. It is requested explicitly
with `benchpilot devices scan --probe`; a Probe marked `may_reset_device` or
`destructive` also requires `--confirm-device-probe`. Probes run without a
Core Run, accept only the shell-free process executor, and return a redacted
structured status for each candidate. Doctor always performs passive discovery
only.
There is no serial executor or ESP-IDF adapter in this release. Device identity
uses declared physical fields, then an explicit port fallback. Instance fallback
is disabled by default and is enabled only by the simulated Demo.

Extension capabilities are compiled separately from the standard catalog and
are exposed through the same dynamic `benchpilot device <id> <capability>`
route. Input-schema `x-benchpilot-cli` metadata supplies flags, aliases,
positionals, repeatable values, secrets, and hidden help entries; no CLI command
is hard-coded for a vendor adapter.
