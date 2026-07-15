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

At runtime probes use the resolved executable, the shared Process Runner and
`shell: false`. A successful probe is parsed and cached for the current
process. A failed probe rejects that candidate; if no candidate succeeds the
runtime returns `ADAPTER_TOOL_PROBE_FAILED`. An explicitly configured invalid
path still returns `ADAPTER_TOOL_CONFIG_INVALID` and never silently falls back
to PATH.

Artifact planning preserves the declaration kind: a path entry produces
`{ "path": "..." }`, while a glob entry produces `{ "glob": "..." }`.
Planning performs no filesystem reads, glob expansion, copying or collection,
but rejects unsafe bases, paths and globs such as parent traversal, absolute
POSIX paths, Windows drive paths and UNC paths.
