# BenchPilot Adapter Template

Copy this directory into `src/adapters/builtin/<adapter-id>` and replace all
placeholder metadata. Every standard capability must be declared explicitly.
Rules are data only: actions use structured arguments and never shell strings.

Optional `i18n/<locale>.toml` files provide adapter messages. The runtime uses
`en` as their fallback locale. Capability schemas and metadata are available to
dynamic CLI help; declarative capability output Views are not yet part of this
template because Device/System output migration is tracked separately.
