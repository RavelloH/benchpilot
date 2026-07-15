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
