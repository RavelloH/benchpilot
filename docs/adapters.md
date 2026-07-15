# Adapters

Adapter registrations are injected into `createBenchPilotApplication`. The CLI then
discovers adapter commands, configured device instances, capabilities, and
capability help dynamically. Capability definitions may expose Runtime Schemas for
input and output validation. External npm adapter installation is not implemented.

Adapters are registered by ID and create a `DeviceRuntime`. They must declare `apiVersion: 1`, a non-empty version and summary, required lifecycle functions, and a `configSchema`; global adapter configuration is validated before discovery, doctor, and device creation. Runtimes publish capabilities with summary, timeout, lock mode, run creation, safety, and execution method. Capability options are parsed dynamically, including booleans, rather than being added to a CLI hard-coded list. Artifacts must be registered through the Core registry, which verifies real path, type, size and SHA-256. The sole adapter is `demo`, an explicitly simulated implementation intended for workflow development and tests.
