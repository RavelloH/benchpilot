# Logging and runs

RLog owns screen, text log, JSONL event, and capture output. A run stores `manifest.json`, `result.json`, `resolved-config.json`, `benchpilot.log`, `events.jsonl`, captures, and artifacts. `runs list` and `run <id>` inspect this state.

`--json` emits one result object. `--jsonl` emits only `benchpilot.event` objects,
with `operation.completed`, `operation.failed`, or `command.result` as its terminal
event. Run IDs retain milliseconds, resolved configuration is redacted, and
registered artifacts are recorded relative to their Run directory.
