# 动作、工作流、解析器与产物

动作（Action）描述一次受限执行，工作流（Workflow）描述多个动作的顺序，解析器（Parser）把退出状态与输出转成结构化结果，产物集（Artifact Set）定义可从项目输出中安全登记的文件。它们都只是能力处理器的内部规则；真正的进程运行、超时、日志、取消、Run 和锁仍由共享运行时与 Operation Runner 负责。

## 动作与工作流

当前可执行的动作类型是 `process` 和 `copy`。`process` 必须引用已声明 Tool，使用 `cwd`、参数数组、可选环境、超时、Parser 和产物集；进程始终以 `shell: false` 运行。参数条目以 `literal`、`value`、`option` 等结构表达，并可带条件。不要拼接命令行字符串或假定 shell 负责转义。

`copy` 只能向 Core 允许的根目录写入。运行时检查目标路径、父目录和符号链接，拒绝逃逸与不安全复制；危险 copy 在首次写入前标记效果边界。格式可声明 serial 动作，但当前没有串口 Action 执行器，执行会返回 `ADAPTER_EXECUTOR_UNAVAILABLE`。

工作流按声明顺序串行执行 Action 步骤。v1 不支持嵌套工作流、循环或任意并行。后续步骤可读取前序的结构化结果，例如 `${result.previous.value}` 或步骤结果命名空间。工作流可设定比能力更短的期限，任何动作仍受能力的剩余期限约束。

## 解析器

Parser 定义成功退出码、行模式、文本编码、ANSI 去除规则、字段提取、进度事件与错误分类。提取可基于正则或 JSON Pointer；正则在编译时验证，命名捕获组必须存在。源可选择 stdout、stderr 或二者。`integer` 与 `number` 拒绝无效及非有限值，布尔字符串只能是 `true` 或 `false`；必填提取失败使解析失败，可选提取失败则省略字段。

进度在输出到达时增量匹配，而非只在进程退出后解析。每一完整行只扫描一次，末尾未换行行也会在结束时扫描；`TextDecoder` 会保留未完成的 UTF-8 序列。事件按 Parser 中规则声明顺序、再按文本匹配顺序发出：

```json
{ "event": "build.progress", "data": { "current": 2, "total": 10 } }
```

最终解析使用有界的 stdout 与 stderr 保留缓冲区。每个流最多 4 MiB（1 MiB 开头加 3 MiB 结尾）；截断的 JSON 不会被当作完整 JSON Pointer 输入。进程输出同时通过 `rlog-js` 写入业务日志：stdout 为 info，stderr 为 warn；不会直接写到终端或 `console.log`。

错误规则有优先级、错误类别、可重试标记和恢复建议。运行时将它们转换为序列化错误，外层能力超时仍由 Core 报告为 `OPERATION_TIMEOUT`；动作、工作流及工具探测的内部期限分别形成 `ADAPTER_ACTION_TIMEOUT`、`ADAPTER_WORKFLOW_TIMEOUT`、`ADAPTER_TOOL_PROBE_TIMEOUT`。

## 产物

产物规则可规划单一路径或 glob；规划阶段不读取文件、不展开 glob、不复制。规则不得使用绝对路径、Windows 盘符、UNC 路径、父目录逃逸或不安全基路径。

执行阶段只接受允许根目录中的普通文件，拒绝源符号链接与逃逸路径。必需产物缺失、单数规则匹配多个文件、目标名称冲突或路径不安全都会失败。单文件上限为 512 MiB，单次收集总上限为 1 GiB。文件复制到 Run 的 `artifacts` 目录后由 Core 注册，记录 SHA-256、大小和源相对路径。

## 声明测试

`tests/cases.toml` 可验证参数与环境渲染、stdout/stderr fixture 解析、所有进度匹配、工作流规划及产物规划。测试不会启动厂商工具、打开设备、展开生产产物或执行 copy。解析器、动作、工作流和产物引用会在格式验证中先行检查。
