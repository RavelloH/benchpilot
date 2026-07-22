# 能力声明

能力（Capability）是适配器向 Core 暴露操作的唯一接口。每项已启用能力都必须显式声明处理器、输入输出 Schema、超时、锁模式、安全策略和三平台支持状态。Core 根据这些元数据创建动态 CLI 命令，并始终通过 Operation Runner 执行，不允许适配器直接接触 Lock 或操作生命周期。

标准能力目录位于 `src/adapters/catalog/capabilities.toml`。适配器必须逐项声明标准能力，即使不支持也要写明 `enabled = false`、原因及三个 `false` 的平台标记。`[extensions.<id>]` 可声明目录外的扩展能力，其结构与标准能力相同，但不会覆盖标准能力名称。

## 已启用能力

一个典型声明如下：

```toml
[capabilities.flash]
enabled = true
handler = "action:flash"
input_schema = "empty"
output_schema = "empty"
creates_run = true
timeout = "15m"
lock = "device"

[capabilities.flash.safety]
mode = "destructive"
description = "This will overwrite the current firmware."

[capabilities.flash.platforms]
windows = true
linux = true
macos = true
```

`handler` 可以是 `action:<id>`、`workflow:<id>`，或受管会话的 `session:start`、`session:logs`、`session:stop`、`session:console`、`session:send`、`session:request`。会话处理器还必须声明 `session`。`input_schema` 与 `output_schema` 指向相应根 Schema 的 `$defs`；`empty` 是内置的空定义。

`timeout` 使用正整数加单位 `ms`、`s`、`m` 或 `h`。动作和工作流可设置更短的内部超时，但不能越过能力的剩余期限。`creates_run` 决定 Core 是否为该能力创建 Run。

## 锁与安全策略

`lock = "device"` 会映射为 Core 的独占设备锁；`lock = "none"` 不获取设备锁。会话的 `lock = "session-owned"` 仅适用于 `session:start`，物理端口由受管会话宿主持有。声明锁的能力需要稳定物理身份，不能以不稳定实例名冒充物理资源。

安全模式为 `normal`、`caution`、`destructive` 或 `irreversible`。Core 将它们用于安全提示、审批与操作记录；不可逆模式的审批有效期固定为一小时。声明中的描述会成为效果说明，但不会替代安全策略。能力不得通过隐藏开关跳过这些机制。

`tty_only = true` 仅可用于 `session:console`，表示该命令只能由交互式终端执行。

## CLI 与 Schema

输入 Schema 的属性可以使用 `x-benchpilot-cli` 定义命令行映射：

```json
{
  "type": "string",
  "description": "串口波特率",
  "x-benchpilot-cli": { "flag": "--baud", "aliases": ["-b"] }
}
```

支持的元数据包括 `flag`、`aliases`、`positional`、`secret`、`repeatable` 和 `hidden`。解析后的字段名始终是 Schema 属性名，而非 CLI 别名。数组属性或 `repeatable` 属性接受重复值；`secret` 字段会被脱敏；`hidden` 控制帮助显示。没有硬编码的厂商命令或参数白名单。

## 平台与禁用能力

能力是否可用同时取决于 `enabled` 和当前平台布尔值。平台覆盖文件不能改写能力定义或新增能力 ID；平台支持必须在 `capabilities.toml` 中显式表达。禁用能力不能设置处理器、Schema、超时或安全策略，并必须提供原因。

已启用能力还可声明 `availability_when`。它使用与动作条件相同的受限路径和操作符，在 Runtime 根据当前平台、适配器配置和设备配置构建命令目录时求值；条件不成立时，该设备不会公开该能力。该条件只能收窄已声明的能力，不能绕开平台、安全、锁或输入 Schema 约束。

能力处理器、动作、工作流和 Schema 名称都在编译时进行跨文件验证。关于动作和输出解析，参见 [动作、工作流、解析器与产物](adapter-parsers.md)。
