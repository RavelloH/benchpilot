# Safety and approvals

Capabilities are classified as `normal`, `caution`, `destructive`, or
`irreversible`. The classification drives Help, audit events, and the approval
policy; it does not add a per-command confirmation flag. Approval records bind
command, normalized input, device identity, project and configuration digest,
expire, and are consumed once.

The default policy requires approval only for `irreversible` operations. A
project can opt into broader approval policy without changing command syntax.

Approvals are read-only checked before a Run and claimed only after the device lock. Every transition uses one per-approval guard. A claimed approval has a heartbeat lease; a local live PID remains active even if its original claim expiry elapsed. A demonstrably stale claim is atomically restored and reused by a normal Operation instead of creating an unbounded sequence of pending approvals.

`markDangerousEffectStarted()` is called immediately before the irreversible
effect, not during preflight. A successful human-approved operation always
consumes its claim. Failed, timed-out, or aborted operations release only when
no dangerous effect began; once marked, they consume. A successful operation
that omitted the marker remains successful but emits the structured
`safety.marker-missing` warning with code `DANGEROUS_EFFECT_MARKER_MISSING`
and still consumes its approval.
