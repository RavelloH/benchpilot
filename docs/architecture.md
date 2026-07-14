# Architecture

The CLI resolves command input and configuration, then selects an adapter through `AdapterRegistry`. A runtime exposes declarative capabilities; `OperationRunner` applies safety, creates the Run, configures RLog, acquires a physical-identity lock, executes with cancellation/timeout, persists a result, and releases resources in `finally`. Demo code is isolated under `src/adapters/demo`.
