# CLI

Global color flags use a positive internal value: `--color` enables color and `--no-color` disables it. Lock inspection uses `benchpilot lock <id> show`; clearing a quarantined Lock requires `--dangerously-clear-quarantined-lock`.

`benchpilot device <instance> <capability> --help` derives its safety and schema
details from the resolved capability. `--jsonl` is an event stream rather than a
mix of logs and result objects; each emitted line uses the `benchpilot.event`
schema.

Every command group prints brief help without a subcommand. Full help is available through `--help` or `help <path>` and has a JSON form. Global options include config path, JSON/JSONL output, quiet/verbose, timeout, dry-run, color and session controls. `--jsonl` writes real-time `benchpilot.event` records to stdout; Operation results are represented only by the one terminal event. Capability options are resolved after selecting the Capability, so boolean options such as `--erase`, `--verify=false`, and `--no-verify` do not require CLI parser changes. Exit codes are 0 success, 2 usage, 3 resource/configuration, 4 lock, 5 operation, 6 timeout, 7 safety, 8 internal.

Operation streams include approval, stage, cleanup and lock lifecycle events. Non-operation commands finish with `command.result` or `command.failed`; operations finish exactly once with `operation.completed` or `operation.failed`.

`benchpilot devices scan` is passive and does not open a serial device or run an
Adapter Probe. To request declared probe checks, use `benchpilot devices scan
--probe`. If the Adapter marks that Probe as potentially resetting or
destructive, add `--confirm-device-probe`; otherwise the command fails with a
safety error before any Probe Action starts.
