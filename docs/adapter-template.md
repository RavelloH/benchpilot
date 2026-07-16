# Adapter template

Copy `src/adapters/_template` to `src/adapters/builtin/<adapter-id>`, change the
manifest ID to the directory name, and explicitly declare every catalog
capability. Disabled capabilities require a reason and must mark all platforms
unsupported. The four JSON Schema files define configuration, device, input and
output data; inputs and outputs are referenced by `$defs` names.

Definitions may use normal JSON Schema references to other `$defs` in the same
root schema, including escaped JSON Pointer definition names.

The template is intentionally non-executable. It documents the full package
shape without adding a vendor adapter.

Platform overlays may modify tools, discovery, environments, devices, actions,
workflows, parsers and artifacts. They cannot modify the manifest, schemas,
catalog, or capability definitions; platform capability support is declared
only in `capabilities.toml`.

Runtime templates never evaluate expressions or code. In execution-critical
fields such as process arguments, working directories, tool paths, environment
variables and capture scripts, a missing `${namespace.path}` fails with
`ADAPTER_TEMPLATE_VALUE_MISSING`; it is not converted to an empty string.

Use direct tools when the discovered executable is launched directly. For an
interpreter-style tool, use `launch.mode = "via-tool"`, name its parent Tool,
and put the discovered child path in `prefix_args`, usually as
`${discovery.path}`. Runtime resolves the complete parent launch before a
discovery probe runs. Capture scripts use the installed Node executable and
must not embed user-provided command text.

Artifact and copy destinations are constrained to Core-allowed roots. Runtime
rejects destination symlinks, parent-directory escapes and source-tree
symlinks; artifact collection also enforces per-file and per-operation limits.
Mark secret input properties with `x-benchpilot-cli.secret = true`: nested
objects, arrays, `$ref`, and schema-composition branches are redacted before
logs, JSON results, run metadata, and persisted approval bindings are written.
