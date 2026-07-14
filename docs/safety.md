# Safety and approvals

Capabilities can be normal, require a named danger flag, or require a danger flag plus a matching local human approval. Approval records bind command, normalized input, device identity, project and configuration digest, expire, and are consumed once.

Approvals are read-only checked before a Run and claimed only after the device lock.
Claims carry a bounded lease. A capability can mark when a dangerous effect starts:
pre-effect failure releases the claim, while failures after that marker consume it to
preserve the audit trail.
