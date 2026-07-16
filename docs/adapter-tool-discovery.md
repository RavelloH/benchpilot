# Tools, discovery and environments

Tools are logical programs. Discovery finds a path using ordered candidates;
the candidate order is priority descending and declaration order as a tie
breaker. A tool launches directly from its discovered path or via another tool.
Tool dependency cycles are invalid. Environments separately describe inherited,
static, active and reserved capture-script providers. Adapter rules may provide
a script path but never an arbitrary shell command.

A discovery probe declares fixture-safe arguments, a timeout and a Parser ID;
that parser must exist in `parsers.toml`. Likewise, a tool launch environment
must name a declared environment provider set.

At runtime a resolved Tool is a complete Launch: `executable`, `argsPrefix`,
its own discovery result and its environment ID. For `via-tool`, the executable
comes from the parent Tool and `argsPrefix` is the parent prefix followed by the
child prefix. A probe runs only after that full launch and its environment have
been resolved, through the shared Process Runner with `shell: false`. Probe
caches include adapter/platform, executable realpath, prefix, environment and
probe arguments. Probe output is debug-only and never exposes the resolved
environment.

Windows environment lookup is case-insensitive. Capture scripts run the current
`process.execPath`, rather than a literal `node`, and script path, executable,
and emit program are passed as separate process arguments.

Device probes use the same resolved Tool and Environment model but are separate
from Tool Discovery probes. They are opt-in scan work, never create a Run, and
are capped at ten seconds. A failed candidate reports only a structured error
kind and retryability; raw process output and resolved environment values are
not emitted by scan output.

Artifact planning preserves the declaration kind: a path entry produces
`{ "path": "..." }`, while a glob entry produces `{ "glob": "..." }`.
Planning performs no filesystem reads, glob expansion, copying or collection,
but rejects unsafe bases, paths and globs such as parent traversal, absolute
POSIX paths, Windows drive paths and UNC paths.
