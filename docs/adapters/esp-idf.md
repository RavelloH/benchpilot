# ESP-IDF 适配器

`esp-idf` 是 BenchPilot 内置的 Espressif ESP-IDF 适配器。它以声明式格式运行，并已首先针对 ESP32-S3 验证；`target` 和设备 `chip` 是配置字段，不会令 Core 按具体板型分支。适配器提供构建、清理、大小分析、esptool 诊断、烧录、复位、受限串口捕获与受管串口会话。

设备扫描通过 Runtime 的共享串口 binding 列出端口及其可用元数据，不打开串口。扫描结果按 Espressif VID `303A`、描述、序列号及常见 USB-UART 桥接器评分；锁身份优先使用序列号、USB 位置，再回退到端口。`status`、`info`、`reset`、`capture`、`run`、`console` 与 `send` 都可能影响设备：打开 USB 串口或 esptool 连接可能改变 DTR/RTS 或重置目标。

## 前提条件与配置

适配器需要 Python 与 `idf.py`；`esptool` 是可选 Tool，但 `status`、`info` 与 `reset` 依赖它。优先级依次包含明确配置、`IDF_PYTHON_ENV_PATH` / `IDF_PATH`、PATH 和平台相关安装位置。Windows 还会检查用户 `.espressif` 目录及 `idf-env.json`。已提供但无效的显式路径会失败，应更正配置。

在项目中启用适配器，并提供无法自动发现的路径：

```toml
[adapters]
enabled = ["esp-idf"]

[adapters.esp-idf]
idf_path = "C:\\Espressif\\frameworks\\esp-idf-v5.3"
python_path = "C:\\Espressif\\python_env\\idf5.3_py3.11_env\\Scripts\\python.exe"
target = "esp32s3"
build_dir = "build"
flash_baud = 460800
monitor_baud = 115200

[devices.esp32s3]
adapter = "esp-idf"
port = "COM5"
chip = "esp32s3"
```

Linux 与 macOS 使用等价的 POSIX 路径，例如 `port = "/dev/ttyACM0"`。`build_dir` 必须是项目内相对路径，不能包含父目录逃逸。波特率范围是 1200 至 2,000,000。

`idf.py` 使用名为 `idf` 的环境：优先捕获显式 `export_script`，其次捕获 `idf_path/export.sh`，再使用已激活的 `IDF_PATH` 和 `IDF_PYTHON_ENV_PATH` 环境。Windows 还依次支持 `export_bat_script`、`export.ps1`、`export.bat`、环境变量路径与已注册安装路径。激活脚本由固定包装器处理，适配器不会拼接 shell 命令。

## 能力与影响范围

| 能力        | 超时    | 锁       | 安全模式    | 行为                                            |
| ----------- | ------- | -------- | ----------- | ----------------------------------------------- |
| `status`    | 2 分钟  | 设备     | caution     | 探测 esptool 并读取 Flash 状态。                |
| `info`      | 2 分钟  | 设备     | caution     | 读取芯片、MAC 与 Flash 标识。                   |
| `build`     | 30 分钟 | 无       | normal      | 运行 `idf.py build`，并读取构建元数据。         |
| `clean`     | 10 分钟 | 无       | normal      | 运行 `idf.py clean`。                           |
| `fullclean` | 10 分钟 | 无       | destructive | 运行 `idf.py fullclean`，删除配置的构建状态。   |
| `size`      | 5 分钟  | 无       | normal      | 运行 `idf.py size` 并解析可用的内存数值。       |
| `flash`     | 15 分钟 | 设备     | destructive | 运行带构建目录、端口和波特率的 `idf.py flash`。 |
| `reset`     | 2 分钟  | 设备     | caution     | 通过 esptool 硬复位。                           |
| `deploy`    | 45 分钟 | 设备     | destructive | 先构建再烧录。                                  |
| `capture`   | 30 秒   | 设备     | caution     | 在固定时限与行/字节上限内读取串口。             |
| `run`       | 30 秒   | 会话拥有 | caution     | 创建受管串口读取会话。                          |

`flash` 与 `deploy` 会覆盖当前应用固件，必须确认设备与目标固件正确。声明中没有 `--force`、擦除、eFuse、安全启动、加密、JTAG、OpenOCD 或 OTA 操作。自动下载模式失败时，可在人工确认后按板卡说明保持 BOOT/GPIO0 并短按 EN 后重试。

`size` 在工具输出存在相应行时返回 `flash_code_bytes`、`flash_data_bytes`、`ram_bytes`、`diram_bytes`、`dram_bytes`、`iram_bytes` 与 `image_bytes`。ESP-IDF v6 可能报告 DIRAM；此时 `ram_bytes` 与 `diram_bytes` 均可能存在。

`capture` 接受时长、波特率、最大行数、最大字节数和可选 UTC 时间戳。还可提供最长 256 个字符的 `--marker`；捕获到包含该文本的行时会提前停止，并在结果中标记停止原因。无论成功、达到上限、超时还是出错，串口都会在操作清理阶段关闭。

构建会登记项目描述、烧录参数、应用 ELF/BIN、bootloader、分区表和 sdkconfig 等声明产物。收集器只接受允许根目录下的常规文件，并登记哈希。

## 受管串口会话

`run` 使用设备端口与 `monitor_baud`（可覆盖）创建会话。默认 UTF-8、按行分帧，DTR/RTS 保持原状态；记录至多 10,000 条，日志 spool 与原始捕获各限制为 16 MiB，单次写入限制为 4096 字节。

`logs` 从已有会话读取记录，支持 `tail`、`cursor` 和 `follow`，不会重新打开端口。`stop` 停止会话并释放资源。`console` 仅供人类 TTY 双向连接；`send` 在单写入租约下发送 text、hex 或 base64（三者互斥，内容会脱敏）。`request` 尚未启用，因为适配器没有声明固件协议；`sync`、`test`、`selftest` 和 `erase` 也明确未支持。

## 错误恢复与硬件验证

解析器会将常见错误归类为 `ESP_DEVICE_NOT_FOUND`、`ESP_DEVICE_PORT_BUSY`、`ESP_DEVICE_PERMISSION_DENIED`、`ESP_TARGET_MISMATCH`、`ESP_IDF_BUILD_FAILED`、`ESP_FLASH_VERIFICATION_FAILED` 等，并携带恢复建议。遇到缺失或占用端口时，关闭监视器程序，确认端口和 USB 连接，再按需要使用 BOOT/EN 操作。

硬件端到端测试是显式选择加入，普通测试和 CI 不会执行：

```powershell
$env:BENCHPILOT_ESP_PORT = "COM5"
$env:BENCHPILOT_ESP_PROJECT = "C:\\work\\esp-project"
pnpm run test:hardware:esp-idf
```

该测试默认执行 Doctor、被动扫描、`status`、`info`、`build` 与 `size`。设置 `BENCHPILOT_ESP_ALLOW_FLASH=1` 才会烧录；`BENCHPILOT_ESP_ALLOW_CAPTURE=1` 才会执行受限捕获；`BENCHPILOT_ESP_ALLOW_SESSION=1` 才会覆盖 `run`、`logs`、`stop` 会话流程；`BENCHPILOT_ESP_ALLOW_SESSION_WRITE=1` 还会发送固定硬件检查文本。请只在已确认可被覆盖或接收该输入的设备上启用这些开关。

适配器包内的简要说明见 [ESP-IDF Adapter README](../../src/adapters/builtin/esp-idf/README.md)。
