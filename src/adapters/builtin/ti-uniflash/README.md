# TI UniFlash Adapter

This experimental adapter programs a prebuilt firmware image through the TI
UniFlash Debug Server Scripting executable (`DSLite.exe`) and a project-owned
CCXML target configuration. It does not build firmware and does not invoke the
`dslite.bat` wrapper, because BenchPilot launches tools without a shell.

## Configuration

Configure the full path to `DSLite.exe` when automatic discovery cannot find
UniFlash or Code Composer Studio. The configured path must name the executable,
not `dslite.bat`.

```toml
[adapters.ti-uniflash]
dslite_path = "D:/ti/uniflash_9.6.0/deskdb/content/TICloudAgent/win/ccs_base/DebugServer/bin/DSLite.exe"
# Required only when using `capture`; it must be able to import `pyserial`.
python_path = "C:/Python310/python.exe"
```

Each target supplies its own CCXML and a stable lab identity for the physical
debug probe. `probe_id` is used for the exclusive device Lock and must not be a
temporary COM port or project path.

```toml
[devices.target_a]
adapter = "ti-uniflash"
target_config = "tools/target-a.ccxml"
probe_id = "lab-xds110-01"
# Optional; defaults to "unknown".
target_name = "MSPM0G3507"
# Optional; defaults to "unknown".
target_revision = "A"
# Optional. Enables `reset`; obtain the index from a locked `--list-resets` validation.
reset_index = 1
# Optional. Its presence enables managed UART session capabilities.
monitor_port = "COM4"
monitor_baud = 115200
# Optional. Enables `info` and is returned only after the debug connection is verified.
[devices.target_a.inventory]
model = "MSPM0G3507"
revision = "A"
hardware_id = "lab-board-17"
[devices.target_a.inventory.flash]
manufacturer = "Texas Instruments"
device = "MSPM0G3507 internal flash"
size = "128 KiB"
```

## Capability

`status` queries the target's configured Debug Server core list. It is a
caution-level, locked operation because it initializes the configured debug
connection. When an `inventory` is configured, `info` verifies that same
connection and returns the project-declared board identity and flash inventory;
DSLite does not provide a target-family-independent UID or flash-ID query, so
these fields are never claimed to be automatically detected. `flash` is
destructive, creates a Run, and takes an exclusive device Lock. It accepts an
image path plus optional verify and run-after-flash settings. A configured
`reset_index` enables `reset`; it must be a value verified for this exact CCXML
with DSLite's `--list-resets` query. Erase, debug unlock, and all build
capabilities remain disabled until their target-family-specific contracts are
separately validated.

When `monitor_port` is configured, the adapter additionally provides the
bounded `capture` operation and managed UART capabilities `run`, `stop`,
`logs`, `console`, and `send`. They use the same serial safety and session
lifecycle as other BenchPilot adapters. Capture disables DTR and RTS after
opening the port, while managed sessions preserve their existing line states.
These commands are not exposed for devices without `monitor_port`.

Run `benchpilot adapter ti-uniflash discover` or `doctor` before operating
hardware. Hardware validation must go through the dynamic `flash` capability;
do not invoke DSLite directly to bypass the Operation Runner lifecycle.
