# Locks

Exclusive locks use a directory per hashed physical identity. Acquisition writes `owner.json` in a `<lock>.creating-<token>` staging directory and atomically publishes it with rename, so a crash cannot leave a newly-created empty lock directory. Release atomically renames the directory to a short-lived tombstone before removal.

`owner.json` contains a v2 record with `state: active | quarantined`. Any failed cleanup that still holds a physical resource quarantines the lock; a non-physical critical cleanup fails the Operation but releases the Lock. A quarantined lock is never stale-cleared or automatically reclaimed: inspect it with `benchpilot lock <id> show`, confirm that hardware and prior tools are stopped, then use `benchpilot lock <id> clear --dangerously-clear-quarantined-lock`. Active and unknown locks require `--dangerously-clear-active-lock`; `locks clear-stale` only removes stale active locks. A non-empty lock directory without a valid `owner.json` is reported as `LOCK_CORRUPT`, with its path and entries for operator recovery; it is never deleted automatically.

Lock updates and recovery records use the runtime/temp area, while Approval updates use the project-local `.benchpilot/state/approval-guards` so they coordinate even when processes use different temporary directories. Each guard contains a random token, PID, hostname and short lease; stale guards (including recovery guards) are recovered under a separate recovery guard after token revalidation. An old holder cannot delete a replacement guard.

Lock IDs contain a safe adapter/kind prefix and a digest, never raw physical IDs.
The serial `LockLease` heartbeat has asynchronous `stop()` semantics: it waits for
an in-flight beat before release, so a released lock cannot reappear. Ownership loss
aborts the operation through its `AbortSignal`; the old owner cannot overwrite or remove a replacement lock. Stale cleanup only removes locks confirmed stale. Acquire never silently takes over a stale directory: operators must explicitly clear it.
