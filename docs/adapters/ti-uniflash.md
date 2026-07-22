# TI UniFlash 适配器设计

> 状态：实验性实现。它不授权绕过 Capability、Operation Runner 或 LockManager 直接调用 DSLite。

## 目标与边界

`ti-uniflash` 是 TI UniFlash 的通用烧录适配器。首个可发布范围是通过 UniFlash DSLite 的默认 `flash` 模式，为具有有效目标配置文件（`.ccxml`）的 DebugServer 目标烧录已构建的镜像。

它的目标是覆盖 UniFlash 可处理的目标配置，而不是将 MSPM0、XDS110、GCC 或某个项目目录写死在 Core 或适配器规则中。当前接入的 MSPM0G3507 与 XDS110 仅用作首个硬件验证组合。

UniFlash 本身不是构建系统。适配器只支持经过显式声明的 Make 默认目标或已配置 CMake 构建目录；不会接收 PowerShell、IDE 脚本或任意命令字符串。

## 观察到的 UniFlash 契约

本机安装位于 `D:\ti\uniflash_9.6.0`，其 `dslite.bat --version` 输出 `9.6.0.5764`。包装器列出的模式包括默认 `flash`、`memory`、`load`、设备系列专用解锁模式、SimpleLink 模式、MSPFlasher 与 Processor SDK Serial Flash。适配器不执行这个批处理包装器，而是直接启动其中的 `DSLite.exe`，因为 Operation Runner 强制 `shell: false`。

因此 v1 只覆盖默认 `flash` 模式。它有一条已验证的项目级参数形态：

```text
dslite --config=<target.ccxml> --flash --verify --run -e <firmware.out>
```

这不是所有模式的通用语法。`mspflasher`、`cc31xx`、`cc32xx`、`processors` 以及各种解锁模式必须在将来以独立适配器或经单独验证的能力声明实现，不能由 `ti-uniflash` 拼接用户提供的任意参数来“兼容”。

## 架构决策

### 1. 通用烧录层只使用声明式 DSLite 动作

适配器目录为 `src/adapters/builtin/ti-uniflash`，ID 固定为 `ti-uniflash`。它以一个 `dslite` Tool 和受限的 Process Action 运行，不引入 JavaScript、批处理片段或 shell 字符串。参数通过结构化 argv 传递，且以 `shell: false` 执行。

Windows 发现顺序应为：

1. 全局适配器配置中的 `dslite_path`；
2. `UNIFLASH_ROOT` 环境变量下的 UniFlash DebugServer 路径；
3. PATH 中的 `DSLite.exe`；
4. 已验证的安装路径模式，例如 `D:/ti/uniflash_*/.../DebugServer/bin/DSLite.exe`、`C:/ti/uniflash_*/.../DebugServer/bin/DSLite.exe` 与 CCS DebugServer 入口。

探测只执行 `DSLite.exe flash -h` 并确认其 `flash` 使用说明；它不连接调试探针。显式但无效的路径必须失败，不能回退到其他候选。

Linux 和 macOS 支持要在对应平台实际验证 `dslite.sh`、安装布局和版本输出后才启用。首个 Windows Bundle 必须把其他平台的能力标为不支持并说明原因，不能基于猜测声称跨平台可用。

配置 `monitor_port` 后，`capture` 还要求一个能导入 `pyserial` 的 Python。它由独立的 `python` Tool Discovery 探测，可用 `[adapters.ti-uniflash].python_path` 覆盖自动发现；探针会实际导入模块，缺少依赖时不会把 `capture` 所需环境报告为就绪。

### 2. 用 `.ccxml` 描述目标，不在 Core 中分支

设备配置把项目拥有的 `.ccxml` 作为目标配置来源。该文件可描述目标、调试接口与探针连接方式；适配器不会依据芯片型号、PID 或开发板名称选择不同的 Core 逻辑。

设备还必须提供 `probe_id`：实验室分配的、稳定且唯一的物理探针身份。当前连接的 XDS110 在被动 Windows 枚举中显示为 `USB\\VID_0451&PID_BEF3\\NOSERIAL`，没有可作为稳定序列号的硬件 serial。因此，不能把 COM 口、临时实例名或 `.ccxml` 路径当作 Lock 身份。

`devices.toml` 应以 `device.probe_id` 作为唯一 identity 字段，关闭端口和实例回退。普通 `device scan` 首版关闭；没有已验证的纯被动 Debug Probe 枚举器时，扫描不能借 DSLite 连接硬件。

预期的项目配置形态如下：

```toml
[adapters]
enabled = ["ti-uniflash"]

[devices.target_a]
adapter = "ti-uniflash"
target_config = "tools/target-a.ccxml"
probe_id = "lab-xds110-01"
# Optional; defaults to "unknown".
target_name = "MSPM0G3507"
# Optional. Enables managed UART capabilities when supplied.
monitor_port = "COM4"
```

`dslite_path` 属于全局 `[adapters.ti-uniflash]` 配置；目标配置和探针身份属于项目设备配置。`target_name` 与 `target_revision` 只用于 `status` 投影，未提供时都为 `unknown`。运行前应验证执行所需值为非空字符串；缺失的模板值必须在规划阶段失败，不能传入空参数。

如果项目已维护可审计的板卡库存，可设置 `device.inventory`（型号、修订、板卡/资产 ID 与 Flash 厂商、型号、容量）。这会公开 `info`：它先通过 Debug Server 验证连接，再返回该声明的库存。UniFlash DSLite 没有已验证的跨目标 UID 或 Flash-ID 查询，因此这些值不是自动检测结果，也不会从 `probe_id` 推断。

如果在受锁硬件验证中通过 `DSLite flash --config <ccxml> --list-resets` 确认了 reset 槽位，可设置 `device.reset_index`。这会公开 `reset`，它只运行 `DSLite flash --config <ccxml> --reset <index>`；索引绝不由芯片名称、探针型号或 Core 分支推断。当前 MSPM0G3507 + XDS110 验证到 `0` 为 CPU Subsystem Reset、`1` 为 System Reset。

设置 `device.image_path` 后会公开 `size`。它通过标准 Python 文件 API 报告这个预构建镜像的精确字节数，不执行构建、不读取目标 Flash，也不改变 `flash` 所需的显式 `image` 输入。

如果项目使用标准构建入口，可添加 `device.build`：`system` 只能是 `make` 或 `cmake`，`directory` 是包含 Makefile 或已配置 CMake 构建树的项目目录；同时必须给出产物 `device.image_path`。这会公开 `build`、`clean` 与 `deploy`。Make 只执行默认目标，CMake 只执行 `cmake --build .`；两者都会在构建后检查声明的镜像文件。`deploy` 在该检查成功后使用固定的 `DSLite flash --flash --verify --run` 参数烧录并运行该镜像；若项目明确要求保持暂停，可设置 `device.build.run_after_deploy = false`。全程不接受自由命令或 DSLite 参数。

`clean` 只使用固定的 `clean` 目标。若项目维护安全边界已审计的完整清理目标，可添加 `device.build.fullclean_target`（受限目标标识符），才会公开破坏性的 `fullclean`；该能力需要正常的 destructive 审批。项目必须自行保证其清理目标不会触及源文件或项目目录之外的路径。

### 3. v1 启用通用且已验证的 `status` 与 `flash`

`status` 通过 `DSLite.exe flash --config <ccxml> --list-cores` 查询目标配置的核心列表。它会初始化 Debug Server，故声明为 `caution`、创建 Run 并取得设备锁；结果中的目标型号和修订来自经过 Schema 校验的设备配置，而不根据 Core 中的型号分支推断。

`flash` 是唯一首发启用的破坏性硬件 Capability：

| 声明项      | 值                      |
| ----------- | ----------------------- |
| handler     | `action:flash`          |
| creates_run | `true`                  |
| timeout     | `15m`（待硬件矩阵校准） |
| lock        | `device`                |
| safety      | `destructive`           |
| Windows     | `true`                  |

输入 Schema 至少应包含：镜像路径、`verify`（默认 `true`）和 `run_after_flash`（默认 `false`）。这些布尔量只决定预先声明的 `--verify` 与 `--run` 参数是否出现；它们不能接受自由 DSLite 参数。镜像路径作为单独 argv 值传入 `-e`，不会成为 shell 源码。

通用 `erase`、内存读写与解锁仍保持禁用。它们在不同 DSLite mode、目标系列和安全影响之间没有统一的已验证语义。`info`、`reset` 与 `size` 已以显式设备配置作为条件化能力开放：前者投影已验证连接上的项目库存，后者分别只使用已经按 CCXML 验证的 reset 索引和预构建镜像的文件元数据。特别是 mass erase 与 debug unlock 不能被实现为隐藏在 `flash` 输入中的快捷选项。

DSLite 成功和失败输出需要通过 Parser 映射为稳定结果与错误类别。首发应先覆盖：目标配置无效、调试探针不可用、目标连接失败、镜像不存在/不兼容、擦写或校验失败和超时。实际文案来自带版本的 fixture，不以模糊子串认定成功。

### 4. 受限构建入口与未来生态

构建适配器按确定的工具链与项目格式扩展，而不是按板卡名称扩展。候选包括：

- `ti-mspm0-gcc`：MSPM0 SDK、SysConfig、Arm GNU Toolchain 与 GNU Make；
- `tiarmclang`：TI Arm Clang 及其被验证的项目入口；
- `ti-c2000-cgt`：C2000 编译器与构建入口；
- `ti-msp430-gcc` 或经验证的 TI MSP430 工具链。

当前格式中每个设备只选择一个 `adapter`，并没有“一个构建适配器 + 一个烧录适配器”的组合或依赖模型。因此为了覆盖常见项目结构而不引入任意命令，`ti-uniflash` 仅声明 `make` 默认目标和已配置 CMake 构建目录这两个受限入口；它不试图包装 SDK、IDE 或厂商专用构建脚本。更专用的工具链适配器仍应独立建模其 SDK、环境和产物契约，直到未来引入有明确生命周期规则的适配器组合机制。

这项限制是显式设计结论，不应通过 Core 依据 adapter ID、芯片型号或项目目录增加分支来绕开。

## ESP-IDF 能力对齐

`status` 与 `flash` 现在已由通用 DSLite 语义实现并经过 XDS110 硬件验证。Format v1 现支持 Capability 的 `availability_when` 声明：Runtime 在构建设备命令目录时使用设备配置判断该条件。因而 `capture`、`run`、`stop`、`logs`、`console` 与 `send` 只会在配置 `monitor_port` 时出现；没有用户 UART 的纯 JTAG/SWD 目标不会暴露必然失败的串口命令。`capture` 使用与 ESP-IDF 相同的有界串口捕获契约和输出 Schema，并以设备 Lock 执行。MSPM0G3507 + XDS110 已完成 `status`、1 秒 `capture`、受管 UART 会话和 flash dry-run 的硬件回归。

串口会话保留 DTR/RTS 并使用标准的 BenchPilot 会话锁、Run、日志和停止生命周期。`info`、`reset` 与 `size` 已分别完成连接投影、System Reset 和预构建镜像字节数回归；`erase` 仍需要按 DSLite target-family 验证。`build`、`clean` 与 `deploy` 对显式 Make/CMake 配置开放，`fullclean` 仅在项目显式提供安全的完整清理目标时开放。

## 实现文件与声明测试

`ti-uniflash` 必须从 `_template` 复制全部固定文件，补齐每一个标准 Capability 的启用或禁用决定，并提供：

- manifest、Windows Tool Discovery、继承环境和 `dslite-version` Parser；
- 配置、设备、输入和输出 Schema；
- `flash` Action 和其 Screen view、本地化消息；
- 三个平台覆盖；
- 至少包含工具版本解析、Windows 参数规划、`verify`/`run_after_flash` 条件、成功输出、已知失败输出的声明测试。

声明测试不得启动 DSLite、访问探针或写入设备。它们只使用 fixtures 验证 argv、模板、Parser 和工作流规划。

## 硬件验证顺序

硬件验证只能在编译 Bundle 后通过 BenchPilot 的动态 Capability 执行：

1. 运行 `adapter doctor`，确认 DSLite 版本与配置路径；
2. 用被动系统枚举确认调试探针存在，并在设备配置中填写稳定 `probe_id`；
3. 在严格审批策略下，使用可恢复的、专用于目标板的测试镜像执行 `flash --verify`；
4. 检查 Run 的结果、审计日志、锁生命周期和 DSLite 错误映射；
5. 仅在明确需要且验证过目标特定语义后，扩展其他 Capability。

当前 MSPM0G3507 + XDS110 组合适合执行第 1–4 步，但它不是该适配器支持范围的唯一目标，也不能替代其他系列的硬件矩阵。
