# 日志、事件与运行记录

## 目的与范围

BenchPilot 将一次可记录的 Capability 调用保存为 Run（运行记录）。Run 用于审计操作输入环境、过程日志、结果和产物；它不是 CLI 标准输出的镜像，也不保证捕获外部工具产生的全部原始字节。

业务日志和审计事件使用 `rlog-js` 写入 Run。CLI 的屏幕输出、`--json` 输出和 `--jsonl` 输出由独立的输出层负责，不能混入业务日志。特别是，JSON stdout 中不得出现日志文本。

## 何时创建 Run

Capability 通过 `createsRun` 声明是否需要 Run。Operation Runner 在完成能力输入校验、审批前置检查后创建 Run；若能力为排他操作，锁仍在实际执行阶段取得。未声明 `createsRun` 的能力可以执行并产生操作结果，但没有 Run 目录，也不能登记 artifact。

`--dry-run` 只生成执行计划：不会创建 Run、锁、审批、日志或任何设备动作。计划包含锁模式、锁 ID、超时、安全分类以及是否需要审批。

所有 Run 位于项目目录的 `.benchpilot/state/runs/<run-id>/`。Run ID 由 UTC 时间戳（保留毫秒）、经过安全化的命令名和随机后缀组成；它用于索引，不应由调用方自行构造。

## Run 目录内容

创建成功的 Run 至少具有 `captures/`、`artifacts/` 和处于 `running` 状态的 `manifest.json`。根据操作及其最终状态，目录可能包含以下文件：

| 路径                   | 用途                                                           |
| ---------------------- | -------------------------------------------------------------- |
| `manifest.json`        | Run 的身份、环境摘要、状态和最终生命周期字段。                 |
| `resolved-config.json` | 经过通用规则和适配器规则脱敏后的配置快照。                     |
| `benchpilot.log`       | `rlog-js` 写入的人类可读业务日志。                             |
| `events.jsonl`         | `rlog-js` 写入的持久化业务事件。                               |
| `captures/`            | Capability 或受管会话写入的采集数据。                          |
| `artifacts/`           | 已登记的操作产物。                                             |
| `result.json`          | 最终的核心操作结果，格式为 `benchpilot.operation-outcome` v1。 |
| `finalizing.json`      | 终结过程中的标记文件；正常完成后会删除。                       |

`manifest.json` 记录设备身份、适配器及版本、Capability、配置摘要、配置来源、BenchPilot 版本、Node.js 版本和运行主机信息。终结时，它还会写入结束时间、耗时、清理错误、取消原因、超时、锁丢失、锁最终状态、审批最终状态及危险效果标记等生命周期数据。

配置快照会按键名脱敏 `password`、`secret`、`token`、`api_key`、`private_key`、`credential`、`authorization` 等敏感字段；适配器还能进一步脱敏自身和设备配置。适配器的 Capability 可以对输入和输出提供专用脱敏逻辑。脱敏降低意外暴露风险，但不应把 Run 目录当作存放秘密的安全边界。

## 结果与终结

Operation Runner 在关闭业务日志后调用 `RunManager.finalize()`。终结先写 `finalizing.json`，再写 `result.json` 和更新后的 `manifest.json`，最后删除标记。因此，`finalizing.json` 仍存在通常表示上次进程在最终写入期间终止，或写入失败；查看该 Run 的其他文件以判断可用程度，不要假定结果完整。

`result.json` 的成功结果包含命令、设备主体、执行时间、可选输出、artifact 列表和生命周期信息。失败或中止结果会改为包含结构化错误。操作状态为 `succeeded`、`failed` 或 `aborted`；超时和信号中止属于 `aborted`，其他执行或关键清理失败属于 `failed`。

Run 可通过以下命令查看：

```powershell
benchpilot run list
benchpilot run <run-id> show
benchpilot run <run-id> logs
benchpilot run <run-id> artifacts
```

这些命令读取持久化状态；它们不会重放设备操作。

## Artifact 约束

Capability 只能通过操作上下文的 `registerArtifact()` 登记 artifact。登记器要求产物路径已经存在，且解析后的路径仍位于当前 Run 的 `artifacts/` 目录内。登记记录包含相对路径、名称、类型、字节数、SHA-256、创建时间和可选元数据。

这项约束防止以 artifact 名义引用项目外任意文件。若 Capability 没有 Run，调用登记会失败；应在 Capability 声明层面使 `createsRun` 与实际产物需求一致。

## 持久化日志与公共输出

`benchpilot.log` 和 `events.jsonl` 是审计日志，使用 `rlog-js` 生成，并带有 Run、命令、设备和适配器上下文。Operation Runner 会将 `operation.started`、锁、审批、阶段和清理等生命周期事实同时写入业务日志和可选报告器。

公共输出有不同的契约：

| 模式         | stdout 内容                                                                            |
| ------------ | -------------------------------------------------------------------------------------- |
| 默认终端模式 | 面向用户的屏幕信息。                                                                   |
| `--json`     | 单个 `benchpilot.result` v3 结果对象。                                                 |
| `--jsonl`    | 一系列 `benchpilot.event` v3 事件，并以 `command.completed` 或 `command.failed` 结束。 |

设备和系统 Capability 的 `--jsonl` 输出可以在终止事件前报告生命周期进度。它与 Run 中的 `events.jsonl` 并非同一协议文件：前者是公开 CLI 协议，后者是业务审计事件。自动化程序应选择一个接口消费，且不要解析 `benchpilot.log` 来替代结构化结果。

## 保留与故障处理

BenchPilot 会创建和终结 Run，但当前 Core 不提供自动保留期限、自动压缩或自动删除策略。项目应根据审计和存储要求自行清理 `.benchpilot/state/runs`，并避免在设备操作仍在运行时删除其目录。

如果日志关闭失败，操作会将该失败记录为关键清理错误；已创建的 Run 仍会尽力终结。因而，Run 存在并不表示其日志或结果必然完整，审计程序应同时检查 `manifest.json` 状态、`finalizing.json` 是否残留及 `result.json` 是否存在。
