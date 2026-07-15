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

Device discovery matchers must name a `discovery.sources` entry in the same
`devices.toml`. A device probe names an Action and a Parser; a tool-discovery
probe names a Parser. Duplicate source and matcher IDs are invalid. Adapter
input and output schemas may use JSON Schema `$defs` references to other
definitions in the same root schema.

`adapter:test` runs declaration cases only for adapters that completed format
validation without error diagnostics. Invalid adapters still produce the normal
machine-readable JSON diagnostic result and are not passed to the case runner.

`test/fixtures/adapters/complete` is a separate, executable conformance fixture:
it exercises every v1 declaration category and all case-runner types, but is not
a builtin adapter and is never published. The existing TypeScript Demo remains
the CLI and package-test default until the declarative runtime is implemented.
Neither that runtime nor an ESP-IDF adapter is part of Format v1.
