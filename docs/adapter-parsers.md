# Actions, workflows, parsers and artifacts

Actions are structured process, serial or copy operations. Process arguments
are array entries, not shell fragments. Workflows execute ordered action steps;
v1 does not permit nested workflows, loops or arbitrary parallel execution.

Parsers declare exit codes, regular-expression or JSON Pointer extraction,
progress and errors. Regular expressions are compiled during validation, and a
named regex extract must reference a declared capture group. Artifact rules
select a path or glob; Core verifies real paths, prevents escapes, hashes copies
and registers artifacts. Templates use only approved `${namespace.path}`
variables.
Platform files recursively merge objects, replace arrays, and cannot introduce
new rule IDs.

Declaration cases can render structured process arguments and environments,
parse separate stdout/stderr fixtures (including JSON Pointer and every progress
match), plan workflows, and plan artifact resolution. They do not execute vendor
tools or copy artifacts.

Both regex and JSON Pointer extracts use the same casts. Integer and number
casts reject invalid or non-finite values; boolean strings must be exactly
`"true"` or `"false"`; and JSON values may be parsed from strings or retained
when already structured. A failed required cast is a case error, while an
optional failed cast is omitted from the result.

Every progress match retains its declared event and puts captured fields in
`data`:

```json
{ "event": "build.progress", "data": { "current": 2, "total": 10 } }
```

Matches are ordered by parser declaration order, then by text match order for
each rule.
