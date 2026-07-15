# Safety and approvals

Capabilities can be normal, require a named danger flag, or require a danger flag plus a matching local human approval. Approval records bind command, normalized input, device identity, project and configuration digest, expire, and are consumed once.

Approvals are read-only checked before a Run and claimed only after the device lock. Every transition uses one per-approval guard. A claimed approval has a heartbeat lease; a local live PID remains active even if its original claim expiry elapsed. A demonstrably stale claim is atomically restored and reused by a normal Operation instead of creating an unbounded sequence of pending approvals.

`markDangerousEffectStarted()` is called immediately before the irreversible effect, not during preflight. Cleanup releases a claim when no dangerous effect began and consumes it when one did.
Claims carry a bounded lease. A capability can mark when a dangerous effect starts:
pre-effect failure releases the claim, while failures after that marker consume it to
preserve the audit trail.

For the Demo adapter, `[adapters.demo].connected` is the explicit global
override. When it is absent, an individual device's `connected` value is used.
