# 配置

本页说明 BenchPilot 如何发现、合并、校验和修改配置。配置以 TOML 保存，最终配置由默认值、文件层、环境变量和可选显式配置组成。设备操作、适配器选择、审批策略和 CLI 语言都读取同一份已解析配置。

运行 BenchPilot 需要 Node.js 22.13 或更新版本。仓库使用 pnpm 11 进行开发和 CI；通过 npm 安装和使用包的用户不需要安装 pnpm。

## 配置文件与状态位置

BenchPilot 使用三类持久化位置：

| 用途             | 位置                                      | 说明                                                                                                  |
| ---------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 全局配置         | `~/.benchpilot/config.toml`               | 用户级 CLI 设置和适配器工具链配置。                                                                   |
| 项目配置         | `<project>/benchpilot.toml`               | 项目身份、启用适配器、设备和系统定义。项目从当前目录向上查找此文件。                                  |
| 项目本地覆盖     | `<project>/.benchpilot/config.local.toml` | 本机或工作副本专属覆盖。`init` 默认创建该文件，并写入 `approval.level = "default"`。                  |
| 项目状态         | `<project>/.benchpilot/state/`            | Run、审批和审批保护数据。它不是配置层。                                                               |
| 跨项目运行时状态 | 系统临时目录下的 `benchpilot/`            | 物理锁、锁保护、锁恢复记录和受管会话索引。其位置依平台使用 `TEMP`、`XDG_RUNTIME_DIR` 或系统临时目录。 |

项目发现从当前工作目录开始逐级向父目录查找 `benchpilot.toml`，直到文件系统根目录。若找不到项目，依赖项目状态的设备操作、Run、审批和项目级配置修改会失败。全局配置仍可在项目外使用。

`--config <path>` 不只是额外读取一个文件：CLI 将该路径解析为项目配置，并以该文件所在目录作为项目根候选；同一文件还作为最高文件优先级的显式层应用。因此使用该选项时，项目本地覆盖位于 `<path>` 所在目录的 `.benchpilot/config.local.toml`。

## 配置层与优先级

最终配置按下列顺序合并，越靠后优先级越高：

1. 内建默认值：`version = 1`、`defaults.timeout = "30s"`、`adapters.enabled = []`、`approval.level = "default"`。
2. 全局配置：`~/.benchpilot/config.toml`。
3. 项目配置：发现到的 `benchpilot.toml`。
4. 项目本地覆盖：`.benchpilot/config.local.toml`。
5. 显式配置：`--config <path>` 指向的文件。
6. 环境变量：所有以 `BENCHPILOT_` 开头的变量。

对象（TOML table）递归合并；标量和数组由高优先级层整体替换。换言之，较高层的 `adapters.enabled` 会替换整个数组，而不会与较低层数组求并集。

每个叶子值都会记录最后提供它的层及来源路径或环境变量。`config get`、`config resolved` 和 `config explain` 可查看这些信息。

## 环境变量

环境变量名去掉 `BENCHPILOT_` 前缀后转为小写，双下划线 `__` 表示对象层级。例如：

```sh
# 覆盖默认操作超时
BENCHPILOT_DEFAULTS__TIMEOUT=45s

# 定义或覆盖一个设备表项；值会解析为 JSON 对象
BENCHPILOT_DEVICES__BOARD_A='{"adapter":"esp-idf","port":"/dev/ttyUSB0"}'
```

环境变量值按以下顺序转换：精确的 `true` 或 `false` 转为布尔值；符合数字形式的值转为数字；可解析的 JSON 转为 JSON 值；其余保留为字符串。环境变量名称或 TOML 键路径中的 `__proto__`、`prototype`、`constructor` 会被拒绝，以避免原型污染。

环境变量层适合 CI、临时凭据注入或不希望写入磁盘的覆盖。它的优先级高于 `--config`，因此排查“文件已修改但结果未变”时，应首先检查 `BENCHPILOT_` 环境变量。

## 配置结构

以下示例是一个最小但完整的项目配置。设备的具体字段和适配器配置字段由所选适配器定义，本页只说明 Core 负责校验的公共结构。

```toml
version = 1

[project]
id = "project-7a5c2c2e-6e35-4f8c-9a2a-0ec6feee7f1b"
name = "firmware-lab"

[adapters]
enabled = ["esp-idf"]

[defaults]
timeout = "45s"

[devices.board-a]
adapter = "esp-idf"
port = "/dev/ttyUSB0"

[[systems.rack-a.members]]
device = "board-a"
role = "controller"
```

### 公共键

| 键                     | 类型与约束                                  | 含义                                                                                          |
| ---------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `version`              | 整数，当前只能为 `1`                        | 配置格式版本。                                                                                |
| `project.id`           | 字符串                                      | 项目稳定标识。`init` 自动生成；公共 CLI 仅允许写入项目层。                                    |
| `project.name`         | 字符串                                      | 人类可读项目名称；仅允许写入项目层。                                                          |
| `defaults.timeout`     | `250ms`、`10s`、`2m`、`1h` 形式的时长字符串 | 设备能力未被 `--timeout` 覆盖时的默认超时；可写入 local、project 或 global 层。               |
| `adapters.enabled`     | 唯一的适配器 ID 数组                        | 当前项目允许用于设备操作的适配器。ID 必须匹配 `[a-z][a-z0-9-]*`；仅允许写入项目层。           |
| `approval.level`       | `strict`、`default` 或 `bypass`             | Agent 模式下的审批阈值；可写入 local 或 global 层。                                           |
| `cli.locale`           | `en` 或 `zh-CN`                             | CLI 显示语言；仅允许写入全局层。                                                              |
| `devices.<id>`         | table，必须包含字符串 `adapter`             | 项目设备实例。ID 必须以字母开头，其余字符为字母、数字、下划线或连字符。其他字段由适配器解释。 |
| `systems.<id>.members` | 非空数组                                    | 系统成员。每项必须包含存在的 `device`，可选字符串 `role`；同一设备不能重复出现。              |

适配器的工具链配置使用 `adapters.<adapter-id>` 形式，通常由 `benchpilot adapter <adapter> discover`、`configure` 或 `install` 写入全局配置。该部分的字段和校验规则由适配器的 `configSchema` 定义，不应假定不同适配器具有相同字段。

### 审批级别

能力自身声明安全模式：`normal`、`caution`、`destructive` 或 `irreversible`。`approval.level` 只决定已在 Agent 模式下执行时，哪些非普通能力进入人工审批生命周期：

| 级别      | 审批规则                         |
| --------- | -------------------------------- |
| `bypass`  | 不因安全模式请求审批。           |
| `default` | 仅 `irreversible` 能力需要审批。 |
| `strict`  | 所有非 `normal` 能力均需要审批。 |

该设置不能改变能力的锁模式、清理要求或安全声明。人工终端模式不会因为该设置自动创建 Agent 审批；是否需要交互确认由具体命令的安全语义决定。

## 使用 `config` 命令

公共 CLI 对 `config get`、`set`、`unset` 和 `explain` 使用受控键目录，不支持任意键路径。当前公开目录中的键为：`project.id`、`project.name`、`defaults.timeout`、`adapters.enabled`、`approval.level` 和 `cli.locale`。设备和系统配置应通过 `device`、`system` 命令或项目 TOML 管理；适配器专属配置应通过 `adapter` 命令管理。

```sh
# 获取键及其最终来源
benchpilot config get defaults.timeout --show-origin

# 显示最终配置及每个叶子的来源
benchpilot config resolved --json

# 显示某个键在每一层中的值；键不存在时 value/origin 可以为空
benchpilot config explain approval.level --json

# 写入项目本地覆盖；未指定作用域时 defaults.timeout 默认写入 local
benchpilot config set defaults.timeout 45s

# 显式写入全局 CLI 语言
benchpilot config set cli.locale zh-CN --global

# 数组值作为 JSON 传入
benchpilot config set adapters.enabled '["esp-idf"]' --project

# 删除当前 local 层中的默认超时，让较低层或内建默认值生效
benchpilot config unset defaults.timeout --local

# 仅校验已解析的最终配置
benchpilot config validate
```

`set` 的 `<value>` 转换规则与环境变量相同：`true`、`false` 转为布尔值；数字文本转为数字；有效 JSON 转为对应值；否则作为字符串。写入前会验证完整目标文件，写入时先生成同目录临时文件再原子重命名。

`set` 和 `unset` 最多指定一个作用域：`--local`、`--project` 或 `--global`。未指定时，CLI 选择该键允许的第一个作用域：`project.*` 与 `adapters.enabled` 为 project，`defaults.timeout` 与 `approval.level` 为 local，`cli.locale` 为 global。若指定不允许的作用域，命令以 `CONFIG_SCOPE_INVALID` 和退出码 2 失败；项目作用域但未发现项目时，以 `PROJECT_NOT_FOUND` 和退出码 3 失败。

`config get` 总是返回来源信息；`--show-origin` 是明确的同义请求。`config explain` 返回最终值、最终来源和所有配置层中的该键值，因此即使一个键当前未定义，也可用于判断它在哪一层缺失。`config validate` 只表示当前已加载、已合并的配置通过校验，并不检查设备是否已连接或外部工具是否可用；这些检查由 `doctor` 和适配器诊断负责。

## 初始化与本地覆盖

推荐从空目录执行：

```sh
benchpilot init --project-name firmware-lab --locale zh-CN --adapter esp-idf
```

首次初始化会创建：

```text
benchpilot.toml
.benchpilot/config.local.toml
.benchpilot/.gitignore
```

其中 `.benchpilot/.gitignore` 忽略同目录下的其他本地文件，仅保留自身。若当前目录已有 `benchpilot.toml`，`init` 不会覆盖它；它会验证现有文件，并在缺失时补建本地覆盖和 `.gitignore`。若 `.benchpilot` 已含初始化文件但项目配置不存在，初始化会拒绝覆盖并返回 `INIT_TARGET_EXISTS`。

通常应提交 `benchpilot.toml`，不要提交包含本机端口、路径、令牌或审批偏好的 `config.local.toml`。实际策略取决于团队的密钥与设备管理方式，但项目配置与本机覆盖应保持职责分离。

## 校验、来源和敏感数据

加载阶段会校验 TOML 语法、配置版本、公共设备与系统结构、适配器选择和审批级别。解析失败会产生 `INVALID_TOML`，结构错误通常产生 `INVALID_CONFIG`、`INVALID_DEVICE_CONFIG`、`INVALID_SYSTEM_CONFIG`、`INVALID_ADAPTER_SELECTION` 或 `INVALID_APPROVAL_LEVEL`，退出码均为 3。

配置快照写入 Run 前，字段名匹配 `password`、`passwd`、`secret`、`token`、`api_key`、`private_key`、`credential` 或 `authorization` 的值会被替换为 `[REDACTED]`。这项脱敏保护只适用于 Run 快照；它不替代访问控制，也不保证任何自定义字段名都不会出现在其他适配器输出中。敏感值应优先通过受控环境变量或适配器专用配置流程提供，并避免将其直接提交到项目配置。
