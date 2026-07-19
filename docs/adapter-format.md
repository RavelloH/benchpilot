# Declarative adapter format

BenchPilot adapters are rule packages, not Node.js plugins. The Core owns
operation lifecycle, locks, approvals, runs, RLog, process execution, timeout,
abort handling and safe artifact collection. An adapter only declares its rules.

Every adapter has the fixed files in `src/adapters/_template`. Runtime files
outside that list are rejected; only `tests/fixtures/**`, `docs/**`, and
optional `i18n/<locale>.toml` files may be added. Adapter translations are
compiled into the Bundle and are resolved through the Adapter contract, so the
Core does not branch on adapter or vendor. Translation keys are nested TOML
paths such as `doctor.environmentFailed`; `en` is the fallback locale. All
identifiers are lowercase kebab-case. Rules cannot contain shell command
strings or JavaScript expressions.

`adapter:validate` writes diagnostics as JSON to stdout and exits non-zero for
errors. `adapter:compile` emits deterministic Bundle v2 files under
`dist/adapters/bundles`.

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
a builtin adapter and is never published. Test fixtures may exercise simulated
operations without becoming production adapters. The `esp-idf` built-in demonstrates that ESP-IDF can be
declared within Format v1 without Core branches for vendor tools.

`[extensions.<id>]` uses the same capability declaration shape as standard
capabilities but is retained as a separate Bundle field. Extensions are routed
dynamically by the capability catalog; they do not introduce JavaScript plugins
or shell command strings. Input properties can declare `x-benchpilot-cli` with
`flag`, `aliases`, `positional`, `secret`, `repeatable`, and `hidden` metadata.

Physical identities must be explicit. `identity.fields` is preferred, optional
port fallback is next, and `allow_instance_fallback` defaults to `false`.
Capabilities that lock a device fail with `DEVICE_IDENTITY_UNAVAILABLE` when no
stable identity is available.

Device Discovery is passive by default. A `devices.toml` Probe is never run by
ordinary `device scan` or Doctor, and the Runtime does not execute it through
`--probe`. Hardware-affecting checks must instead be declared as Capabilities,
which execute through the Core operation lifecycle. Passive discovery does not
open serial ports, toggle DTR/RTS, or implement a serial executor.

Discovery sources are `serial`, `usb`, `network`, or `command`. `serial` is a
passive port-name listing (including a fixed Windows system query); `usb` may
be supplied by a Core provider without adding a native dependency; and
`network` accepts declared static records but never performs a LAN scan. A
`command` source must name a declared process Action and a Parser result key
containing an array of records. It uses normal Tool and Environment resolution,
has a ten-second maximum, and cannot contain an arbitrary shell command.

Capture-script providers accept a fixed path template, including a safely
composed path such as `${config.sdk_root}/export.sh`. The Runtime resolves that
path and passes it as a separate argument to its fixed shell wrapper; adapter
rules still cannot provide shell source or user-controlled command text.
