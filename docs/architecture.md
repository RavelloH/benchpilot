# Architecture

Core owns physical-resource safety. Capabilities execute through the Operation Runner, which acquires Locks, claims approvals, records cleanup, and finalizes the Run. Cleanup runs before lock-lease stop, approval finalization, Lock release or quarantine, log close, and Run finalization. Adapters are explicit registrations and receive validated configuration services rather than selecting behavior by board model in Core.

The CLI boundary has five layers: CLI Interface → Application / Use Cases →
Core Safety & Lifecycle → Adapter Runtime → Adapter Definitions / Toolchain.
The Command Graph is the source of command paths, fields, help, dynamic child
catalogs, and interaction metadata. CLI presentation converts resolved command
intents into Application requests; it owns no device operation, configuration
mutation, Run, Lock, or Approval business logic. Application owns command
semantics and dynamic catalogs; Core owns safety and lifecycle. Built-in
adapters are loaded only from compiled Bundle v2 files, and the declarative
runtime exposes their capabilities.

The Output Engine consumes one locale-neutral
semantic data object and renders Screen, `benchpilot.result` v3 JSON, or
`benchpilot.event` v3 JSONL frames. `MessageRef` keeps user-facing text typed
and resolved in the CLI, while Application and Core return locale-neutral data.
RLog is an infrastructure sink for business logs, captures, and Run audit; it
is deliberately separate from public JSONL. Device and system Capability
operations project Core lifecycle facts into the same Result v3 and Event v3
protocol as all other commands.
`OperationRunner` applies safety, creates the Run, configures RLog, acquires a
physical-identity lock, executes with cancellation/timeout, persists a result,
and releases resources in `finally`. A lock ownership loss aborts the same
signal supplied to the Capability.

Core operations now run registered cleanup handlers before stopping the `LockLease`
and releasing the physical-resource lock. Runs are finalized only after critical
cleanup completes. Adapters are supplied through `createBenchPilotApplication`, so
the CLI dynamically resolves their devices and capabilities. The bundled ESP-IDF
Adapter is declarative and hardware-capable, while ordinary tests use fixtures
and never access hardware.

`runProcess` is a shell-free future-adapter helper. It binds a child process to an
operation AbortSignal and waits for it to exit before cleanup can release the
physical lock.

Declarative adapters are compiled into Bundle v2 before shipping. At runtime,
Tool Discovery, full via-tool launch resolution, environments, actions,
workflows, parsers, artifacts, passive discovery, Doctor checks, and extension
capabilities run from the compiled Bundle only. Adapter TOML is a build-time
input and no arbitrary JavaScript is loaded from an adapter.

`src/core.ts` is the public Core export surface. Implementations live in
`core/config`, `core/capabilities`, `core/operations`, `core/process`, and their
resource-specific modules. CLI startup remains in `cli/index.ts`; project
initialization, configuration mutation, and system workflows live under
`application`. `benchpilot setup` is reserved for a future environment
configuration wizard and is intentionally neither registered nor implemented.

Human interaction is provided by Inquirer and starts only at legal incomplete
command nodes. Caller identity is determined solely by the versioned fixed
environment/file marker contract; SSH, TTY, and CI are not identity heuristics.
TTY availability controls whether a human interaction can proceed, while JSON
and JSONL always remain non-interactive machine protocols.
