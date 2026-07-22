# 创建适配器

`src/adapters/_template` 是声明式适配器格式 v1 的完整、非可执行骨架。创建内置适配器时复制该目录到 `src/adapters/builtin/<adapter-id>`，修改 manifest，并逐步替换空声明。模板自身会被校验，以防其与格式脱节，但不会被编译或发布。

## 最小创建流程

1. 复制目录，并将 `manifest.toml` 的 `id` 改为目录名；填写显示名称、版本、说明、状态和标签。
2. 在四个 Schema 中定义配置、设备、输入和输出；把密钥字段标为 `x-benchpilot-secret: true` 或 `x-benchpilot-cli.secret: true`。
3. 在 `capabilities.toml` 对目录中的每项标准能力给出明确决定。未实现时保留 `enabled = false`、原因及三平台 `false`。
4. 为已启用能力添加动作或工作流、解析器、工具与环境声明；引用名称必须在对应文件中存在。
5. 根据需要定义被动设备发现、物理身份、产物、会话、平台覆盖、本地化和声明测试。
6. 运行 `pnpm run adapter:validate`、`pnpm run adapter:compile` 与 `pnpm run adapter:test`。

不要先为某一块开发板在 Core 增加分支。硬件差异应通过适配器注册、设备 Schema、工具规则和能力声明表达。

## 能力与安全

每一项已启用能力必须声明 `handler`、输入输出定义、`timeout`、`lock`、`creates_run`、`safety` 与平台支持。硬件相关操作应选择 `lock = "device"` 并保证 `devices.toml` 能产生稳定身份。能力的 `action:` 或 `workflow:` 处理器会经过 Operation Runner，因此 Run、审批、锁、日志、取消和清理由 Core 统一处理。

不能通过 Action、脚本或 CLI 隐藏参数绕开这一边界。没有串口 Action 执行器；需要端口生命周期时，应使用经过验证的 `session:*` 能力，而不是在规则中直接打开串口。

## 工具、环境与动作

工具由 `tools.toml` 的逻辑名称和 `tool-discovery.toml` 的候选路径组成。进程动作以 `tool`、`cwd`、`arguments`、`parser` 与可选超时、环境、产物集描述。参数是带 `kind` 的结构化条目；不能写 shell 片段。解释器式工具可使用 `launch.mode = "via-tool"`，其父工具提供可执行文件，子工具的发现路径通常加入 `prefix_args`。

环境可继承当前进程、加入静态变量、验证活跃环境，或通过固定包装器捕获指定激活脚本产生的环境。适配器只提供脚本路径模板，不能提供可插入用户文本的 shell 源码。捕获脚本、可执行文件和 Node 发射程序均作为独立 argv 传递。

## 设备、产物与测试

设备扫描默认关闭，且应保持被动。`serial` 仅枚举端口名；网络源不扫描子网；`command` 源必须引用已声明的进程 Action 与 Parser，不能使用任意命令。物理身份优先使用稳定序列号、位置等字段；端口回退与实例回退均需要显式允许。

产物规则只规划项目允许根目录下的文件或 glob。运行时拒绝路径逃逸、符号链接、过大文件和目标冲突，并由 Core 登记哈希。声明测试使用 `tests/cases.toml` 与本地 fixture 验证模板渲染、动作规划、解析、工作流和产物规划；它们不调用厂商工具或复制真实产物。

完整字段说明见 [适配器格式](adapter-format.md)、[工具发现](adapter-tool-discovery.md) 与 [解析器和产物](adapter-parsers.md)。
