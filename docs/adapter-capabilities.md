# Capabilities

The v1 catalog is in `src/adapters/catalog/capabilities.toml`. Standard
capabilities are always declared explicitly. An enabled capability has an
`action:<id>` or `workflow:<id>` handler, timeout, lock mode, safety policy and
three explicit platform booleans. `danger-flag` and `human-approval` safety
modes require a flag. Extension capabilities follow the same structure.
