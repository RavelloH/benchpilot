# Declarative adapter format

BenchPilot adapters are rule packages, not Node.js plugins. The Core owns
operation lifecycle, locks, approvals, runs, RLog, process execution, timeout,
abort handling and safe artifact collection. An adapter only declares its rules.

Every adapter has the fixed files in `src/adapters/_template`. Runtime files
outside that list are rejected; only `tests/fixtures/**` and `docs/**` may be
added. All identifiers are lowercase kebab-case. Rules cannot contain shell
command strings or JavaScript expressions.

`adapter:validate` writes diagnostics as JSON to stdout and exits non-zero for
errors. `adapter:compile` emits deterministic bundles under `dist/adapters`.

Format v1 is schema-closed: JSON Schema checks fixed structure and primitive
types, while semantic validation checks cross-file references, tool cycles,
capability safety and template paths. `_template` is validated as documentation,
but is never compiled or published as an adapter bundle.
