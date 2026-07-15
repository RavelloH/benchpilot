# Locks

Exclusive locks use a directory per hashed physical identity: `owner.json` contains the v2 owner record and `update.lock` is acquired with `open(..., "wx")` for every heartbeat, release, and clear read-check-write transition. Ownership is random-token based and release verifies the token. An active lock requires an explicit dangerous flag to clear; expired locks can be cleared as stale.

Lock IDs contain a safe adapter/kind prefix and a digest, never raw physical IDs.
The serial `LockLease` heartbeat has asynchronous `stop()` semantics: it waits for
an in-flight beat before release, so a released lock cannot reappear. Ownership loss
aborts the operation through its `AbortSignal`; the old owner cannot overwrite or remove a replacement lock. Stale cleanup only removes locks confirmed stale. Acquire never silently takes over a stale directory: operators must explicitly clear it.
