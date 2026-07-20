# Adapters

Adapter registrations are injected into `createBenchPilotApplication`. The CLI then
discovers adapter commands, configured device instances, capabilities, and
capability help dynamically. Capability definitions may expose Runtime Schemas for
input and output validation. External npm adapter installation is not implemented.

Adapters are registered by ID and create a `DeviceRuntime`. They must declare `apiVersion: 1`, a non-empty version and summary, required lifecycle functions, and a `configSchema`; global adapter configuration is validated before discovery, doctor, and device creation. `createDevice(instance, deviceConfig, { adapterConfig, paths })` receives both validated scopes explicitly. Device runtimes must not reread raw `[adapters.*]` configuration from the operation context. Runtimes publish capabilities with summary, timeout, lock mode, run creation, safety, and execution method. Capability options are parsed dynamically, including booleans, rather than being added to a CLI hard-coded list. Artifacts must be registered through the Core registry, which verifies real path, type, size and SHA-256. The built-in `esp-idf` adapter is a declarative real-hardware adapter for ESP-IDF projects. See [ESP-IDF](adapters/esp-idf.md) for its safety and hardware-test requirements.

Adapter-provided messages are loaded from optional `i18n/<locale>.toml` catalog
files and resolved by the CLI, with `en` as the fallback. Capability input,
output, safety, and timeout metadata participates in the Command Graph and
dynamic help. An optional `views.toml` can provide a schema-bound, localized
Screen projection for an enabled capability. It uses only the shared Detail or
ObjectTree components and never changes the public Result v3/Event v3 data.
Absent Views use the generic capability screen projection.
