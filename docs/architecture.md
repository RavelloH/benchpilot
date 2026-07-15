# Architecture

The CLI resolves command input and configuration, then selects an adapter through `AdapterRegistry`. A runtime exposes declarative capabilities; `OperationRunner` applies safety, creates the Run, configures RLog, acquires a physical-identity lock, executes with cancellation/timeout, persists a result, and releases resources in `finally`. A lock ownership loss aborts the same signal supplied to the Capability. Demo code is isolated under `src/adapters/demo`.

Core operations now run registered cleanup handlers before stopping the `LockLease`
and releasing the physical-resource lock. Runs are finalized only after critical
cleanup completes. Adapters are supplied through `createBenchPilotApplication`, so
the CLI dynamically resolves their devices and capabilities. This repository still
contains no real hardware adapter.

`runProcess` is a shell-free future-adapter helper. It binds a child process to an
operation AbortSignal and waits for it to exit before cleanup can release the
physical lock.
