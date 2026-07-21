# Adapters

Adapter registrations are injected into `createBenchPilotApplication`. The CLI then
discovers adapter commands, configured device instances, capabilities, and
capability help dynamically. Capability definitions may expose Runtime Schemas for
input and output validation. External npm adapter installation is not implemented.

Adapters are registered by ID and create a `DeviceRuntime`. They must declare `apiVersion: 1`, a non-empty version and summary, required lifecycle functions, and a `configSchema`; global adapter configuration is validated before discovery, doctor, and device creation. `createDevice(instance, deviceConfig, { adapterConfig, paths })` receives both validated scopes explicitly. Device runtimes must not reread raw `[adapters.*]` configuration from the operation context. Runtimes publish capabilities with summary, timeout, lock mode, run creation, safety, and execution method. Capability options are parsed dynamically, including booleans, rather than being added to a CLI hard-coded list. Artifacts must be registered through the Core registry, which verifies real path, type, size and SHA-256. The built-in `esp-idf` adapter is a declarative real-hardware adapter for ESP-IDF projects. See [ESP-IDF](adapters/esp-idf.md) for its safety and hardware-test requirements.

Use `benchpilot adapter <id> enable` and `benchpilot adapter <id> disable` to
add or remove an installed Adapter from the current project's
`[adapters].enabled` list. Both commands are idempotent and modify only the
project configuration; they do not install tools or change global Adapter
configuration.

`benchpilot adapter <id> discover` resolves and validates the Adapter's
declared tools without touching a device. When every required tool is available,
it atomically persists the declared, schema-bound values to the global
`[adapters.<id>]` table. `benchpilot adapter <id> configure --<key> <path>`
validates manually supplied Adapter paths before saving them to the same global
table. Persisted values are preferred by all later Adapter tool resolution,
while device operations remain limited to Adapters enabled by the current
project.

Adapter-provided messages are loaded from optional `i18n/<locale>.toml` catalog
files and resolved by the CLI, with `en` as the fallback. Capability input,
output, safety, and timeout metadata participates in the Command Graph and
dynamic help. An optional `views.toml` can provide a schema-bound, localized
Screen projection for an enabled capability. It uses only the shared Detail or
ObjectTree components and never changes the public Result v3/Event v3 data.
Absent Views use the generic capability screen projection.
