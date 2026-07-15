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
