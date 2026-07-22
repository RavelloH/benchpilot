# BenchPilot

BenchPilot 是一个面向本地开发环境、自动化系统和 Agent 的设备生命周期命令行工具。它将嵌入式设备的发现、构建、烧录、串口会话、运行记录和人工审批组织为可声明、可审计的能力（Capability），并将实际的物理资源访问置于统一的安全生命周期之下。

当前发行包内置用于 Espressif ESP-IDF 项目的 `esp-idf` 适配器。适配器的规则以声明式文件提供；BenchPilot 的核心负责超时、锁、审批、运行记录、日志、产物登记和清理，而不是由每个板卡或工具链各自实现一套流程。

## 适用场景

BenchPilot 适合需要在本地或受控自动化环境中操作真实硬件的场景，例如：

- 构建并烧录 ESP-IDF 固件；
- 以被动方式发现串口设备，并将设备加入项目配置；
- 查询设备状态、读取芯片信息、执行受控复位或有界串口采集；
- 启动受管串口会话、读取会话日志，并由人或 Agent 以受控方式发送数据；
- 将多台设备组合为系统，在统一的安全策略下执行共同能力；
- 保存可复查的 Run、业务日志和构建产物。

它不将未知硬件操作包装成“自动确认”的快捷开关。烧录等破坏性操作会遵循能力声明的锁和审批策略；若关键清理无法确认已释放物理访问，相关锁会被隔离，而不会直接释放。

## 安装与运行

运行 BenchPilot 需要 Node.js 22.13 或更高版本。

```bash
npm install --global benchpilot
benchpilot --version
```

也可以将包安装到项目中，再通过包管理器的命令入口运行。首次在一个固件项目中使用时，初始化项目配置：

```bash
benchpilot init --project-name firmware-lab --adapter esp-idf
benchpilot adapter list
benchpilot device scan
```

`init` 会在当前目录创建 `benchpilot.toml`，并创建只供本地使用的 `.benchpilot/config.local.toml`。它不会自动添加设备，也不会触碰硬件。后续请根据发现结果和适配器要求配置设备，然后通过动态能力命令操作它：

```bash
benchpilot device list
benchpilot device <设备实例> status
benchpilot device <设备实例> build
benchpilot device <设备实例> flash
```

命令和可用能力取决于当前项目的配置与已启用适配器。使用以下命令获取当前安装版本的完整、机器可读命令目录：

```bash
benchpilot help --all --json
```

## 输出与自动化

默认输出面向终端使用者。`--json` 输出一个最终结果对象；`--jsonl` 输出结构化事件流，并以一个终止事件结束。业务日志、工具输出捕获和 Run 审计文件不会混入这两种标准输出协议。

```bash
benchpilot device <设备实例> status --json
benchpilot device <设备实例> build --jsonl
```

Agent 或其他非交互式调用方应提供完整参数，并使用 `--agent`、`--json` 或 `--jsonl`。需要选择菜单或人工确认的交互式流程不会在机器输出模式中隐式执行，而会返回结构化错误或审批请求。

## 安全模型

设备操作必须通过能力和 Operation Runner 执行。每项能力都声明自己的超时、锁模式与安全策略。涉及独占物理资源的能力使用稳定的物理身份获取锁；需要人工确认的操作会创建并核验审批记录。

一次操作结束时，BenchPilot 固定按以下顺序处理资源：能力清理、停止锁租约、结束审批状态、释放或隔离锁、关闭日志、结束 Run。该顺序确保可能仍持有硬件访问的失败不会被误判为安全完成。

详细约束见[安全模型](docs/safety.md)、[锁](docs/locks.md)和[运行记录与日志](docs/logging-and-runs.md)。

## 内置 ESP-IDF 适配器

`esp-idf` 适配器提供被动串口发现、ESP-IDF 项目构建与清理、镜像大小查询、设备信息读取、受保护的烧录，以及受管串口会话。默认扫描不会打开串口，也不会探测或重置设备。

适配器不会提供擦除、eFuse、JTAG/OpenOCD、OTA 等高风险能力。烧录前请确认目标端口与待覆盖的固件。具体配置、可用能力、恢复方式和显式硬件验证入口见[ESP-IDF 适配器说明](docs/adapters/esp-idf.md)。

## 使用文档

- [CLI 使用说明](docs/cli.md)：命令、交互和机器输出协议。
- [配置](docs/config.md)：配置文件、优先级和初始化。
- [ESP-IDF 适配器](docs/adapters/esp-idf.md)：前提条件、能力、恢复与硬件验证。
- [安全模型](docs/safety.md)：审批、危险效果与操作边界。

## 许可

[MIT](LICENSE)
