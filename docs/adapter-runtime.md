# Declarative Adapter Runtime

BenchPilot executes production adapters from compiled Bundle v2 files in
`dist/adapters/bundles`. The runtime never reads an adapter's TOML files from a user
project and resolves the bundle directory relative to its own module, so npm
installs work from any current directory.

The execution path is Bundle Loader, adapter registry, JSON Schema validation,
tool/environment resolution, action or workflow planning, the Core operation
lifecycle, parsing, artifact registration, and output validation. Locks,
approvals, Runs, cleanup, quarantine and JSON/JSONL terminal events remain
owned by Core.

The public command protocol is rendered by the CLI Output Engine as Result v3
or Event v3. Capability operations emit the same locale-neutral outcome for
Screen, JSON, and JSONL. Compiled Adapter `views.toml` metadata can select a
shared Screen component over validated output fields, but never creates a
second result format or a custom terminal renderer.

Production loading remains limited to the bundles shipped with the package;
test fixtures are compiled and loaded only by the test harness.

Templates are deliberately limited to `${namespace.path}` lookups. Execution
critical templates fail with `ADAPTER_TEMPLATE_VALUE_MISSING` when a value is
absent; they never become an empty executable path, working directory or
argument. Process actions always use an argv array and the shared Process
Runner with `shell: false`. Serial plans are accepted but report
`ADAPTER_EXECUTOR_UNAVAILABLE` until a future runtime version supplies a
serial executor.

Adapter actions use fixed declarations from their shipped Bundle. User input is
passed as data, never inserted into executable source.

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

`benchpilot device scan` is passive. The bundled runtime enumerates available
serial port names on POSIX and Windows and can consume declared static records
or Core-injected passive USB/network providers; it neither opens a serial port
nor changes DTR/RTS. Network sources never scan a LAN. A targeted `command`
source reuses a declared shell-free Tool Action and Parser, with a ten-second
ceiling, rather than accepting a command string from an adapter.
An Adapter Probe is never part of discovery. Probe declarations are not
executed by this Runtime; hardware-affecting identification must be exposed as
a declared Capability so it receives the full Core Run, Lock, approval, and
cleanup lifecycle. Doctor always performs passive discovery only.
There is no serial executor in this release. The bundled ESP-IDF adapter uses
declared process actions and passive discovery. Device identity uses declared
physical fields, then an explicit port fallback; instance fallback is disabled
by default.

Extension capabilities are compiled separately from the standard catalog and
are exposed through the same dynamic `benchpilot device <id> <capability>`
route. Input-schema `x-benchpilot-cli` metadata supplies flags, aliases,
positionals, repeatable values, secrets, and hidden help entries; no CLI command
is hard-coded for a vendor adapter.
