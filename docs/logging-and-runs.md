# Logging and runs

RLog owns business logs, captures, and Run audit files. It does not own public
CLI Screen, JSON, or JSONL output. `--jsonl` output uses the
public `benchpilot.event` v3 protocol and is emitted by the CLI Output Engine;
its terminal frame contains the same `benchpilot.result` v3 object emitted by
`--json`. A run stores `manifest.json`, `result.json`, `resolved-config.json`,
`benchpilot.log`, `events.jsonl`, captures, and artifacts. Finalization writes a
marker so incomplete result/manifest finalization can be diagnosed. `run list`
and `run <id> show` inspect this state.

`--json` emits one Result v3 object. `--jsonl` emits only Event v3
objects with a `command.completed` or `command.failed` terminal event. Device
and system Capability operations stream lifecycle frames before that terminal.
Their persisted `result.json` is a Core `benchpilot.operation-outcome` audit
record, while public stdout remains Result/Event v3. Run IDs retain
milliseconds, resolved configuration is redacted, and registered artifacts are
recorded relative to their Run directory.
