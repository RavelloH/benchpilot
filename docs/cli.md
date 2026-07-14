# CLI

`benchpilot device <instance> <capability> --help` derives its safety and schema
details from the resolved capability. `--jsonl` is an event stream rather than a
mix of logs and result objects; each emitted line uses the `benchpilot.event`
schema.

Every command group prints brief help without a subcommand. Full help is available through `--help` or `help <path>` and has a JSON form. Global options include config path, JSON/JSONL output, quiet/verbose, timeout, dry-run, color and session controls. Exit codes are 0 success, 2 usage, 3 resource/configuration, 4 lock, 5 operation, 6 timeout, 7 safety, 8 internal.
