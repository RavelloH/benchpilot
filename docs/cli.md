# CLI 使用说明

本页说明 BenchPilot 命令行界面的命令结构、交互规则、机器可读输出和退出状态。命令、选项和输出版本以当前 CLI 的命令目录为准；设备实际可执行的能力由项目中启用的适配器动态提供，因此应使用 `benchpilot device <device> --help` 或 `benchpilot system <system> --help` 查询当前环境中的最终参数。

BenchPilot 的设备操作不是普通的子进程调用。设备能力会经过 Operation Runner，按能力声明处理输入校验、超时、锁、审批、运行记录和清理。有关这些运行时语义，参见 [安全模型](safety.md)、[锁](locks.md) 和 [日志与运行记录](logging-and-runs.md)。

## 调用形式与帮助

基本形式如下：

```text
benchpilot <命令> [参数] [选项]
```

`benchpilot`（不带参数）始终显示根帮助，不会自行打开交互菜单。以下三种方式可获得帮助：

```sh
benchpilot --help
benchpilot help config set
benchpilot device <device> <capability> --help
```

`help` 可接受任意命令路径。`benchpilot help --all --json` 输出完整的机器可读命令索引；动态设备和系统能力是否在索引中展开，取决于当前项目配置和已启用的适配器。

命令路径中的尖括号表示必填值，例如 `<device>`；方括号表示可选部分，例如 `[<path...>]`。不要在实际命令中输入尖括号。

## 命令目录

下表列出静态命令。适配器、设备、系统和能力名均为运行时数据，表中的占位符不是固定字符串。

| 范围     | 命令                                                                                                                               | 用途                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 项目     | `init`                                                                                                                             | 在当前目录创建或接管 BenchPilot 项目。                 |
| 项目     | `doctor`                                                                                                                           | 检查 Node.js、项目、配置和已启用适配器的诊断状态。     |
| 语言     | `language list`、`language get`、`language set <locale>`                                                                           | 查看或写入全局 CLI 语言；当前支持 `en` 和 `zh-CN`。    |
| 配置     | `config get <key>`、`config set <key> <value>`、`config unset <key>`、`config resolved`、`config explain <key>`、`config validate` | 读取、编辑和审查配置层。详见 [配置](config.md)。       |
| 适配器   | `adapter list`                                                                                                                     | 列出此 CLI 安装中已注册的适配器。                      |
| 适配器   | `adapter <adapter> show`、`doctor`                                                                                                 | 查看适配器元数据或运行适配器诊断。                     |
| 适配器   | `adapter <adapter> discover`、`configure`、`install`                                                                               | 发现、配置或安装适配器工具链；适配器配置写入全局配置。 |
| 适配器   | `adapter <adapter> enable`、`disable`                                                                                              | 在当前项目的 `adapters.enabled` 中启用或禁用适配器。   |
| 设备     | `device list`                                                                                                                      | 列出项目配置中的设备实例。                             |
| 设备     | `device scan [--adapter <adapter>]`                                                                                                | 被动发现候选设备；不会打开串口，也不会运行探测能力。   |
| 设备     | `device add`、`device remove <device>`                                                                                             | 添加或删除项目设备配置。                               |
| 设备     | `device <device> <capability> [能力选项]`                                                                                          | 执行设备能力。能力名称、位置参数和选项均由适配器声明。 |
| 系统     | `system list`、`system create <name> <devices...>`、`system delete <system>`                                                       | 列出、创建或删除多设备系统。                           |
| 系统     | `system member add <system> <device>`、`system member remove <system> <device>`                                                    | 调整系统成员。                                         |
| 系统     | `system <system> show`                                                                                                             | 显示系统、成员和共同能力。                             |
| 系统     | `system <system> <capability> [能力选项]`                                                                                          | 对系统中全部成员执行共同能力。                         |
| 运行记录 | `run list`、`run prune`                                                                                                            | 列出或清理历史 Run。                                   |
| 运行记录 | `run <run> show`、`run <run> logs`、`run <run> artifacts`                                                                          | 查看单个 Run 的记录、日志或产物。                      |
| 锁       | `lock list`、`lock clear-stale`                                                                                                    | 查看锁或清理已过期的锁。                               |
| 锁       | `lock <lock> show`、`lock <lock> inspect`、`lock <lock> clear`                                                                     | 查看、检查或清除指定物理资源锁。                       |
| 审批     | `approval list`                                                                                                                    | 列出项目中的审批请求。                                 |
| 审批     | `approval <approval> inspect`、`approve`、`reject`                                                                                 | 查看并处理审批请求。                                   |
| 辅助     | `home`                                                                                                                             | 打开交互式命令菜单。                                   |
| 辅助     | `version` 或 `--version`                                                                                                           | 输出 BenchPilot 和 Node.js 版本。                      |
| 辅助     | `upgrade check`、`upgrade latest`、`upgrade <version>`                                                                             | 检查或执行 CLI 升级。                                  |

### 动态能力

设备命令先解析 `<device>`，再由该设备所属适配器提供可用能力和输入 schema。系统能力是所有成员设备能力的交集：只有每个成员都声明了同名且锁模式、安全策略、输入输出 schema、选项、默认超时和 Run 语义一致的能力，才会出现在系统命令中。

因此，下面的写法只是形式示例：

```sh
benchpilot device board-a status
benchpilot device board-a flash --image build/app.bin --verify=false
benchpilot system rack-a status
```

能力布尔选项可写为 `--verify`、`--verify=true`、`--verify=false` 或 `--no-verify`。数值型能力选项会按该能力的 schema 转换；未知选项、缺失必填选项或不符合 schema 的值会导致 `INVALID_CAPABILITY_INPUT`。

`device scan` 仅收集适配器的发现结果。`--probe` 和 `--confirm-device-probe` 不被支持；任何会接触设备的探测都必须声明为 Capability 并由 Operation Runner 执行。

## 全局选项

除根帮助中展示的精简选项外，解析后的命令均支持下列全局选项。选项可放在命令路径前后；`--json` 与 `--jsonl` 不能同时使用。

| 选项                     | 行为                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--json`                 | 向标准输出写入一个 `benchpilot.result` v3 JSON 对象。标准输出不混入日志或屏幕文本。                                                   |
| `--jsonl`                | 向标准输出持续写入 `benchpilot.event` v3 JSON Lines 事件流。最后恰有一个终止事件，其 `result` 与 `--json` 的结果对象一致。            |
| `--quiet`                | 在屏幕模式隐藏非必要的屏幕输出。它不改变 JSON/JSONL 契约。                                                                            |
| `--verbose`              | 请求显示公共诊断信息。不要依赖它输出稳定的机器协议；自动化应使用 `--json` 或 `--jsonl`。                                              |
| `--timeout <duration>`   | 覆盖设备能力的默认超时。格式为非负数字加单位：`250ms`、`10s`、`2m` 或 `1h`。                                                          |
| `--dry-run`              | 对设备操作只生成执行计划，不创建 Run、锁或审批，不调用能力实现，也不改变物理或持久化状态。结果包含锁模式、锁 ID、超时和是否需要审批。 |
| `--agent`                | 强制进入 Agent 模式，禁用所有需要终端交互的补全、确认和菜单。                                                                         |
| `--color` / `--no-color` | 强制启用或禁用屏幕颜色。机器输出不含颜色控制序列。                                                                                    |
| `--config <path>`        | 使用指定 TOML 文件作为显式配置；该文件所在目录同时成为项目根候选。详见 [配置层](config.md#配置层与优先级)。                           |
| `--session <id>`         | 向操作运行时传递调用方会话标识。它不同于适配器声明的受管会话 `session_id` 能力输入。                                                  |
| `--help`                 | 显示当前解析后命令的帮助。                                                                                                            |
| `--version`              | 显示版本信息；未提供命令路径时等价于 `benchpilot version`。                                                                           |

`--dry-run` 仍会解析项目、适配器、设备和能力，并校验能力输入。它不是对配置编辑命令的通用“试运行”开关；配置、适配器管理和运行记录管理命令应按各自的命令语义处理。

## 交互与 Agent 模式

对于标记为“输入不完整时可交互”的命令，交互终端会以选择菜单或输入提示补足缺失字段。例如，`init` 会在未通过选项提供项目名时询问项目名；`config set` 可引导选择键、作用域和值。

交互仅在同时满足以下条件时可用：不是已识别的 Agent 环境、未指定 `--agent`、未使用 `--json` 或 `--jsonl`，且标准输入和标准输出均为 TTY。检测到的 Agent 包括 Codex、Claude Code、Gemini CLI、Cursor、GitHub Copilot CLI 等固定标记环境。

自动化调用必须显式提供全部必填参数。若命令需要交互而当前环境不允许，CLI 返回结构化错误，例如 `AGENT_INTERACTION_UNSUPPORTED`、`INTERACTIVE_MACHINE_OUTPUT_UNSUPPORTED` 或 `INTERACTIVE_TERMINAL_REQUIRED`，退出码为 2。

审批和危险锁清除也不会在 Agent 模式中进行隐式确认。审批应通过 `approval` 命令处理；锁清除应使用命令要求的危险选项或在人工终端完成确认。

## 机器可读输出

### 单结果 JSON

`--json` 的标准输出始终是一行 `benchpilot.result` v3 对象：

```json
{
  "schema": "benchpilot.result",
  "version": 3,
  "ok": true,
  "command": { "id": "config.validate", "path": ["config", "validate"] },
  "kind": "data",
  "data": {
    "schema": "benchpilot.config-validate",
    "version": 1,
    "valid": true
  },
  "meta": {
    "startedAt": "2026-07-22T00:00:00.000Z",
    "endedAt": "2026-07-22T00:00:00.010Z",
    "durationMs": 10
  }
}
```

`kind` 为 `data`、`help`、`operation` 或 `interaction`。成功结果包含 `data`；非操作失败包含 `error`；操作失败同时保留 `data`（操作结果）和 `error`。`meta` 总是包含起止时间和耗时，操作结果还可能包含 `runId` 与 `dryRun`。

### JSON Lines 事件流

`--jsonl` 中每行是独立 JSON 对象，基本结构如下：

```json
{
  "schema": "benchpilot.event",
  "version": 3,
  "sequence": 0,
  "timestamp": "2026-07-22T00:00:00.000Z",
  "command": { "id": "device.execute", "path": ["device", "board-a", "flash"] },
  "context": { "adapter": "example" },
  "event": { "type": "command.started" }
}
```

静态数据命令按顺序输出 `command.started`、一个或多个 `snapshot`，然后输出 `command.completed`。操作命令会在终止前额外输出 `operation.*`、进度、通知或会话日志事件；系统操作的子设备事件在 `context.system` 和 `context.device` 中标明来源。每个流最终只能有一个 `command.completed` 或 `command.failed` 事件，终止事件中的 `result` 是规范结果。

业务日志、适配器子进程输出和人类可读进度不会写入 JSON 标准输出。消费者应按 `schema`、`version`、`event.type` 和结果中的 `kind` 分派数据，而不是解析显示文本。

## 退出状态

命令成功时退出码为 0。主要失败类别如下；具体 `error.kind` 才是自动化决策的首选依据。

| 退出码 | 含义                                             |
| ------ | ------------------------------------------------ |
| 2      | 用法、命令路径、选项、输入值或交互前提错误。     |
| 3      | 项目、配置、适配器、设备、系统或其他资源不可用。 |
| 4      | 锁、并发或受管会话资源冲突。                     |
| 5      | 操作、清理、适配器安装或其他执行失败。           |
| 6      | 操作或中止流程超时。                             |
| 7      | 审批或安全策略拒绝。                             |
| 8      | 内部错误。                                       |
| 130    | 用户取消交互。                                   |

在屏幕模式，错误信息写入标准错误；在 `--json` 和 `--jsonl` 模式，错误以结果对象或终止事件写入标准输出。不要将退出码 0 以外的情况视为可安全重试：只有结果中 `error.retryable: true` 的错误才明确标记为可重试。

## 常用操作示例

```sh
# 初始化项目；在非交互环境中提供全部必填输入
benchpilot init --project-name firmware-lab --locale zh-CN --adapter esp-idf

# 查看项目设备和某个设备真正支持的能力
benchpilot device list
benchpilot device board-a --help

# 输出可供脚本消费的最终结果
benchpilot device board-a status --json

# 只检查一次烧录将使用的锁、超时和审批要求
benchpilot device board-a flash --image build/app.bin --dry-run --json

# 查询完整配置及一个键的逐层来源
benchpilot config resolved --json
benchpilot config explain defaults.timeout --json

# 在持续集成或 Agent 中消费事件流
benchpilot device board-a flash --image build/app.bin --agent --jsonl
```

设备能力的示例名称和选项取决于适配器；在将示例用于真实设备前，应先运行目标能力的 `--help` 并确认其安全策略与输入定义。
