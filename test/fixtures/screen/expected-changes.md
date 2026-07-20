# Approved screen changes

## Root page

The definition-driven root page intentionally omits commands that have no
implementation in this release: `setup`, `alias`, `workflow`, `skill`, and
`docs`. All remaining root-page layout, wording, ordering, spacing, colors,
examples, and footer content stay compatible with the pre-refactor screen.

## Upgrade pages

Upgrade check and result pages now honor the selected locale. The previous
implementation always printed hard-coded Chinese labels; spacing and the
two-column detail structure remain compatible.

## Language pages

Language list/get/set now use the shared Table and Detail components instead
of unlabelled, manually padded text. JSON and JSONL now use the common Result
and Event v3 envelopes with locale-neutral language data.

## Run pruning

Run pruning now uses the shared List component instead of printing its result
DTO as indented JSON on Screen. JSON and JSONL use the common v3 envelopes.

## Command help

Command help now renders declared descriptions, examples, and error kinds.
`help --help` targets the Help command itself, while `help --all` renders a
complete nested-command index. Dynamic resource placeholders are shown as
required path segments, and output schemas match the canonical DTO schemas.
