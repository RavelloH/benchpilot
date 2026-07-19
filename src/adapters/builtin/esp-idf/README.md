# Espressif ESP-IDF Adapter

This first-party Adapter uses the frozen declarative Adapter Format v1. It never
opens a port while scanning: passive discovery runs fixed `pyserial`
`list_ports` code through the configured Python Tool and scores Espressif USB
VID `303A` highly. Third-party USB-UART bridges are returned as low-confidence
candidates only.

`status`, `build`, `clean`, `fullclean`, `size`, `info`, `flash`, `reset`,
`capture`, and `deploy` are available. `flash` and `deploy` require a human
approval. `info`, `fullclean`, `reset`, and bounded `capture` require their
declared danger flags: opening a USB serial port may reset the target. Capture
uses fixed Python code with independent argv values and always closes the port.
Interactive logs, run, and stop remain disabled. No action uses `--force`,
erase commands, eFuse operations, JTAG/OpenOCD, OTA, or a shell string.

`idf.py` actions require an activated or resolved ESP-IDF environment.
`esptool` actions use the resolved Python executable directly, so read-only
`info` remains available when a compatible esptool installation is present but
the ESP-IDF export script has not been activated.

Configure paths only when automatic discovery or an already activated ESP-IDF
environment is insufficient:

```toml
[adapters]
enabled = ["esp-idf"]

[adapters.esp-idf]
idf_path = "C:\\path\\to\\esp-idf"
python_path = "C:\\path\\to\\python.exe"
target = "esp32s3"
build_dir = "build"
flash_baud = 460800
monitor_baud = 115200

[devices.esp32s3]
adapter = "esp-idf"
port = "COMx"
chip = "esp32s3"
```

Linux and macOS use the same schema with POSIX paths. Prefer an active ESP-IDF
shell, `IDF_PATH`, or an explicit `export_script = "/opt/esp-idf/export.sh"`.
For a USB CDC/JTAG device, configure a stable `/dev/ttyACM*` or `/dev/ttyUSB*`
port. `build_dir` is always a project-relative path and cannot escape the
project directory.

On Windows the environment resolver first accepts an already active ESP-IDF
environment, then uses an explicit PowerShell `export_script` or cmd
`export_bat_script`, `idf_path/export.ps1`, and `idf_path/export.bat`. Linux
and macOS use an explicit `export_script`, `idf_path/export.sh`, and
`IDF_PATH/export.sh`. All scripts are captured through a fixed wrapper with the
script path passed as an argv value. An explicitly configured invalid tool path
is an error; correct it rather than relying on PATH fallback.

Most boards automatically enter download mode through DTR/RTS. If that fails,
hold BOOT/GPIO0, briefly press EN, then retry. Before approving a flash, verify
that overwriting the board's current application firmware is intended.

Hardware verification is opt-in and never part of normal tests:

```powershell
$env:BENCHPILOT_ESP_PORT = "COMx"
$env:BENCHPILOT_ESP_PROJECT = "C:\path\to\project"
pnpm run test:hardware:esp-idf
```

Set `BENCHPILOT_ESP_ALLOW_FLASH=1` only after deciding to overwrite the target.
BenchPilot will still create a human-approval request; approve it interactively
with the displayed physical device identity before rerunning the flash stage.
Set `BENCHPILOT_ESP_ALLOW_CAPTURE=1` to include the bounded boot-marker capture;
it explicitly supplies `--dangerously-capture` and asserts Lock release.

`size --json` returns available ESP-IDF table values as `flash_code_bytes`,
`flash_data_bytes`, `ram_bytes`, `diram_bytes`, `iram_bytes`, and
`image_bytes`. ESP-IDF v6 can report DIRAM rather than a separate DRAM row.

Common recovery paths are deliberate and machine-readable: a missing port is
reported as `ESP_DEVICE_NOT_FOUND` in `details.parserKind`; a busy port as
`ESP_DEVICE_PORT_BUSY`; and a bad ESP-IDF project, target mismatch, build
failure, or flash verification failure has its own parser category and recovery
guidance. Close monitor applications, reconnect USB, verify the target, and
use BOOT/GPIO0 plus EN when automatic download mode is unavailable.
