# Espressif ESP-IDF 适配器

这是 BenchPilot 随包发布的 `esp-idf` 声明式适配器。它面向 ESP-IDF 项目，当前首先验证 ESP32-S3，但目标和芯片均由配置决定。该目录只包含规则、Schema、本地化、fixture 与声明测试；执行、锁、审批、Run、日志与清理由 BenchPilot Core 统一处理。

适配器需要 Python 和 `idf.py`，并在需要设备诊断时使用 `python -m esptool`。它会从配置、ESP-IDF 环境变量、PATH 与平台安装位置发现工具。`idf.py` 操作使用已激活的 ESP-IDF 环境或安全捕获的导出脚本环境；路径和脚本均作为独立参数处理。

## 配置示例

```toml
[adapters]
enabled = ["esp-idf"]

[adapters.esp-idf]
idf_path = "/opt/esp-idf"
python_path = "/opt/esp/python_env/bin/python"
export_script = "/opt/esp-idf/export.sh"
target = "esp32s3"
build_dir = "build"
flash_baud = 460800
monitor_baud = 115200

[devices.demo]
adapter = "esp-idf"
port = "/dev/ttyACM0"
chip = "esp32s3"
```

Windows 可改用 `export_script`（PowerShell）或 `export_bat_script`（cmd），并使用 `COM<n>` 端口。`build_dir` 只能是项目内的相对目录。

## 已提供的能力

构建生命周期包括 `build`、`clean`、`fullclean`、`size`、`flash`、`deploy` 和 `reset`；设备诊断包括 `status` 与 `info`；`capture` 只进行有明确时间、行数和字节上限的串口读取，可选 `--marker` 在捕获到指定文本时提前结束。`flash` 和 `deploy` 会覆盖固件，`fullclean` 删除构建状态；它们的安全信息和设备锁均由能力声明交给 Core。

`run`、`logs`、`stop`、`console` 和 `send` 使用受管串口会话。普通扫描不打开端口；`console` 仅允许 TTY，`send` 的载荷会脱敏。`request`、`sync`、`test`、`selftest` 与 `erase` 明确未启用。

详细配置、能力表、错误恢复及选择加入的硬件测试请见 [ESP-IDF 适配器文档](../../../../docs/adapters/esp-idf.md)。
