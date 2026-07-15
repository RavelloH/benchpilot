# Logging and runs

RLog owns screen, text log, JSONL event, and capture output. Public `--jsonl` uses the separate `benchpilot.event` protocol and is emitted in real time. Its single terminal event is produced from the same OperationOutcome as the final Result and manifest. A run stores `manifest.json`, `result.json`, `resolved-config.json`, `benchpilot.log`, `events.jsonl`, captures, and artifacts. Finalization writes a marker so incomplete result/manifest finalization can be diagnosed. `runs list` and `run <id>` inspect this state.

`--json` emits one result object. `--jsonl` emits only `benchpilot.event` objects,
with `operation.completed`, `operation.failed`, or `command.result` as its terminal
event. System operations instead emit one `system.operation.completed` or
`system.operation.failed` terminal event; child device events use
`device.operation.completed` or `device.operation.failed` and include `system` and
`device` context. Run IDs retain milliseconds, resolved configuration is redacted, and
registered artifacts are recorded relative to their Run directory.
