# BenchPilot Adapter Template

Copy this directory into `src/adapters/builtin/<adapter-id>` and replace all
placeholder metadata. Every standard capability must be declared explicitly.
Rules are data only: actions use structured arguments and never shell strings.

`i18n/en.toml` is the Adapter message baseline. Additional
`i18n/<locale>.toml` files must provide the same message keys; the runtime uses
`en` as their fallback locale. Capability schemas and metadata are available to
dynamic CLI help. `views.toml` optionally gives an enabled capability a
screen-only `detail` or `tree` View. It may select only declared, non-secret
output schema fields and can only use central formatters; it cannot contain
TypeScript, shell commands, or renderer code.
