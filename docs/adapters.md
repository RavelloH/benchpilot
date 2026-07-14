# Adapters

Adapter registrations are injected into `createBenchPilotApplication`. The CLI then
discovers adapter commands, configured device instances, capabilities, and
capability help dynamically. Capability definitions may expose Runtime Schemas for
input and output validation. External npm adapter installation is not implemented.

Adapters are registered by ID and create a `DeviceRuntime`. Runtimes publish capabilities with summary, timeout, lock mode, run creation, safety, and execution method. The sole adapter is `demo`, an explicitly simulated implementation intended for workflow development and tests.
