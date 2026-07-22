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
```

Each target supplies its own CCXML and a stable lab identity for the physical
debug probe. `probe_id` is used for the exclusive device Lock and must not be a
temporary COM port or project path.

```toml
[devices.target_a]
adapter = "ti-uniflash"
target_config = "tools/target-a.ccxml"
probe_id = "lab-xds110-01"
```

## Capability

`flash` is destructive, creates a Run, and takes an exclusive device Lock. It
accepts an image path plus optional verify and run-after-flash settings. The
adapter only exposes the cross-target DSLite `flash` mode; erase, debug unlock,
target inspection, reset, and all build capabilities remain disabled until
their target-family-specific contracts are separately validated.

Run `benchpilot adapter ti-uniflash discover` or `doctor` before operating
hardware. Hardware validation must go through the dynamic `flash` capability;
do not invoke DSLite directly to bypass the Operation Runner lifecycle.
