# BenchPilot contributor rules

- All device operations go through a Capability and the Operation Runner.
- Core code must not branch on board model; adapters are registered explicitly.
- All business logs and captures use `rlog-js`.
- Never bypass LockManager for physical-resource operations.
- Do not add `--force`, `--yes`, or hidden human-confirmed switches.
- JSON stdout must never contain logs.
- Each capability declares its timeout, lock mode and safety policy.
- Changes to configuration, locks, runs, approvals or shutdown lifecycle require regression tests.
- Tests must use injected/temporary paths, never real user directories.
- Runtime support is Node.js >= 22.13. pnpm 11 is a repository development and CI tool;
  do not document it as a requirement for npm package users.
- Preserve the operation cleanup order: capability cleanup, lock lease stop, approval
  finalization, lock release, log close, then Run finalization.

## Commit messages

Use Conventional Commits with a required scope:

```text
<type>(<scope>): <imperative summary>
```

Allowed types are `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`,
`chore`, and `perf`. Keep the summary lowercase, concise, and without a final
period. Examples: `feat(cli): add demo deploy command` and
`build(tooling): migrate to pnpm`.
