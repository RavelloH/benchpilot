# Architecture

Core owns physical-resource safety. Capabilities execute through the Operation Runner, which acquires Locks, claims approvals, records cleanup, and finalizes the Run. Cleanup runs before lock-lease stop, approval finalization, Lock release or quarantine, log close, and Run finalization. Adapters are explicit registrations and receive validated configuration services rather than selecting behavior by board model in Core.

The v2 boundary has five layers: CLI Presentation → Application / Use Cases →
Core Safety & Lifecycle → Adapter Runtime → Adapter Definitions / Toolchain.
CLI presentation converts argv and human interaction into Application requests;
it owns no device operation, configuration mutation, Run, Lock, or Approval
business logic. Application owns command semantics and dynamic catalogs; Core
owns safety and lifecycle. Built-in adapters are loaded only from compiled
Bundle v2 files, and the declarative runtime exposes their capabilities.
`OperationRunner` applies safety, creates the Run, configures RLog, acquires a
physical-identity lock, executes with cancellation/timeout, persists a result,
and releases resources in `finally`. A lock ownership loss aborts the same
signal supplied to the Capability.

Core operations now run registered cleanup handlers before stopping the `LockLease`
and releasing the physical-resource lock. Runs are finalized only after critical
cleanup completes. Adapters are supplied through `createBenchPilotApplication`, so
the CLI dynamically resolves their devices and capabilities. This repository still
contains no real hardware adapter.

`runProcess` is a shell-free future-adapter helper. It binds a child process to an
operation AbortSignal and waits for it to exit before cleanup can release the
physical lock.

Declarative adapters are compiled into Bundle v2 before shipping. At runtime,
Tool Discovery, full via-tool launch resolution, environments, actions,
workflows, parsers, artifacts, passive discovery, Doctor checks, and extension
capabilities run from the compiled Bundle only. Adapter TOML is a build-time
input and no arbitrary JavaScript is loaded from an adapter.

`src/core.ts` is a compatibility export surface only. Implementations live in
`core/config`, `core/capabilities`, `core/operations`, `core/process`, and their
resource-specific modules. CLI startup remains in `cli/index.ts`; project
initialization, configuration mutation, and system workflows live under
`application`. `benchpilot setup` is reserved for a future environment
configuration wizard and is intentionally neither registered nor implemented.

Human interaction is provided by `prompts` and starts only at legal incomplete
command nodes. Caller identity is determined solely by the versioned fixed
environment/file marker contract; SSH, TTY, and CI are not identity heuristics.
TTY availability controls whether a human interaction can proceed, while JSON
and JSONL always remain non-interactive machine protocols.
