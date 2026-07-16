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
`project`, `home`, `temp`, `env`, optional `run`, and empty `tool`,
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
