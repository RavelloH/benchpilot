# ESP-IDF Adapter

BenchPilot includes the declarative `esp-idf` Adapter for ESP-IDF projects. Its
first formal target is `esp32s3`, but both adapter `target` and device `chip`
are schema fields so the declaration is not board-model-specific.

The Adapter discovers Python from configuration, `IDF_PYTHON_ENV_PATH`, PATH,
or the standard Windows ESP-IDF Python environment. It discovers `idf.py` from
configuration, `IDF_PATH`, PATH, or the standard Windows framework location.
Environment activation prefers an existing ESP-IDF environment and otherwise
captures the explicit `export_script` (or Windows `export_bat_script`) without
exposing full environment values in Doctor output. It then derives the platform
export script from `idf_path` and `IDF_PATH`; the fixed wrapper receives every
script path through argv rather than an interpolated shell command.

## Configuration

On Windows, configure only the paths that discovery cannot find:

```toml
[adapters]
enabled = ["esp-idf"]

[adapters.esp-idf]
idf_path = "C:\\path\\to\\esp-idf"
python_path = "C:\\path\\to\\python.exe"
export_script = "C:\\path\\to\\esp-idf\\export.ps1"
target = "esp32s3"
build_dir = "build"
flash_baud = 460800
monitor_baud = 115200

[devices.esp32s3]
adapter = "esp-idf"
port = "COMx"
chip = "esp32s3"
```

Linux and macOS use the same schema, with POSIX paths and `export.sh`:

```toml
[adapters]
enabled = ["esp-idf"]

[adapters.esp-idf]
idf_path = "/opt/esp-idf"
python_path = "/path/to/python"
export_script = "/opt/esp-idf/export.sh"

[devices.esp32s3]
adapter = "esp-idf"
port = "/dev/ttyACM0"
chip = "esp32s3"
```

Default scanning is passive and does not run esptool or open a serial device.
An Espressif USB VID/PID identity and serial number are preferred for locking;
port identity is a final fallback. `info` deliberately requires
`--dangerously-info`, because connecting with esptool may reset the target.

`flash` and `deploy` hold the Device Lock and require human approval. They use
`idf.py -B <build_dir> -p <port> -b <baud> flash` and never pass `--force` or
an erase option. If automatic download mode does not work, hold BOOT/GPIO0 and
briefly press EN before retrying.

Build artifacts are individual files only: project description, flasher args,
application ELF/BIN, bootloader BIN, partition-table BIN, and sdkconfig. The
artifact collector rejects symlinks, escaping paths, and missing required files
and records hashes through the Runtime.

`size --json` reports `flash_code_bytes`, `flash_data_bytes`, RAM/DIRAM,
IRAM, and `image_bytes` when ESP-IDF emits those rows. ESP-IDF v6 may report
DIRAM rather than separate DRAM, so both `ram_bytes` and `diram_bytes` are
returned in that case.

## Operations and recovery

`status`, `build`, `clean`, and `size` are normal operations. `fullclean`
requires `--dangerously-fullclean`; it deletes only the configured build
directory. `info`, `reset`, and bounded `capture` require their declared danger
flags because connecting with esptool or opening a USB serial port can toggle
reset lines. Capture receives port, baud, duration, and line limits as argv;
it always closes the port and returns `lines` and `marker`. `flash` and `deploy`
require a human approval and never use force, erase, eFuse, JTAG, OpenOCD, or
OTA commands.

For a missing or busy port, close serial monitors, verify the configured port,
reconnect the board, then hold BOOT/GPIO0 and briefly press EN before retrying.
The error result preserves the parser category in `details.parserKind`.

## Hardware E2E

The opt-in command never runs in ordinary tests or CI:

```powershell
$env:BENCHPILOT_ESP_PORT = "COMx"
$env:BENCHPILOT_ESP_PROJECT = "C:\path\to\project"
pnpm run test:hardware:esp-idf
```

It runs Doctor, passive scan, status, info, build, and size. Set
`BENCHPILOT_ESP_ALLOW_FLASH=1` only after deciding to overwrite the existing
application; BenchPilot still creates a human approval request.

Set `BENCHPILOT_ESP_ALLOW_CAPTURE=1` to include the bounded boot-marker
capture. It passes `--dangerously-capture`, because opening USB serial can
reset the board; it asserts `BENCHPILOT_ESP32S3_OK` and Lock release.

See the Adapter [README](../../src/adapters/builtin/esp-idf/README.md) for the
configuration example, safety model, and explicit hardware test entry point.
