# Locks

Exclusive locks use atomic `open(..., "wx")` files keyed by physical adapter identity. Ownership is random-token based and release verifies the token. An active lock requires an explicit dangerous flag to clear; expired locks can be cleared as stale.

Lock IDs contain a safe adapter/kind prefix and a digest, never raw physical IDs.
The serial `LockLease` heartbeat has asynchronous `stop()` semantics: it waits for
an in-flight beat before release, so a released lock cannot reappear. Ownership loss
aborts the operation, while stale cleanup only removes locks confirmed stale.
