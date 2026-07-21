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

An optional `[discoveries.<id>.persistence]` declaration makes a resolved
discovery value eligible for `benchpilot adapter <id> discover`. It names a
schema-bound Adapter configuration `key`, selects `path` or `root` as its
source, and may remove a declared `strip_suffix` from a resolved path.
Discover validates every required Tool and writes only these declared values to
global configuration. `configure --<key> <path>` validates manually supplied
paths through the same Tool rules before writing them. Environment values and
raw probe output are never persisted.

Windows environment lookup is case-insensitive. Capture scripts run the current
`process.execPath`, rather than a literal `node`, and script path, executable,
and emit program are passed as separate process arguments.

Device probes use the same resolved Tool and Environment model but are separate
from Tool Discovery probes. They are opt-in scan work, never create a Run, and
are capped at ten seconds. A failed candidate reports only a structured error
kind and retryability; raw process output and resolved environment values are
not emitted by scan output.

## Device Discovery sources

Device discovery remains passive unless an adapter explicitly declares a
`command` source. Static `records` are useful for fixed network endpoints and
test fixtures. Serial discovery lists candidate port names only; on Windows it
uses a fixed PowerShell query that does not open a port. USB discovery has no
bundled native dependency, so Core may inject a passive provider when one is
available. Network discovery never scans a subnet.

A `command` source names a normal process Action plus the Parser result field
that contains its record array. It resolves the Action Tool and Environment,
runs the tool probe, executes through the shared Process Runner with
`shell: false`, and is limited to ten seconds. This is a targeted discovery
command, not an adapter-supplied shell script. Per-source errors are isolated
so another passive source can still produce candidates.

Artifact planning preserves the declaration kind: a path entry produces
`{ "path": "..." }`, while a glob entry produces `{ "glob": "..." }`.
Planning performs no filesystem reads, glob expansion, copying or collection,
but rejects unsafe bases, paths and globs such as parent traversal, absolute
POSIX paths, Windows drive paths and UNC paths.
