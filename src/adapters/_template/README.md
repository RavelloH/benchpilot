# BenchPilot 适配器模板

本目录是声明式适配器格式 v1 的完整骨架，不是可执行适配器。复制它到 `src/adapters/builtin/<adapter-id>` 后，必须替换 manifest、Schema 和空规则；编译器会校验模板本身，但绝不会将其发布为 Bundle。

适配器规则只能声明数据：Tool 通过受限发现规则解析，进程 Action 使用结构化 argv，环境捕获只引用固定脚本路径。规则不能携带 shell 命令字符串、JavaScript、动态渲染代码或直接硬件访问逻辑。

## 必须完成的项目

1. 将 `manifest.toml` 中的 `id` 改为目录名，并填写适配器元数据。
2. 填写 `schemas/` 下的配置、设备、输入和输出 JSON Schema；对秘密字段标记脱敏元数据。
3. 在 `capabilities.toml` 显式处理每个标准能力。启用的能力必须声明处理器、Schema、超时、锁、安全策略与平台；禁用项必须保留原因和三个不支持平台。
4. 按需要补充 Tool、Discovery、Environment、Action、Workflow、Parser、Artifact、设备发现、会话、本地化、视图和测试案例。
5. 执行 `pnpm run adapter:validate`、`pnpm run adapter:compile` 和 `pnpm run adapter:test`。

## 安全边界

物理设备操作只能由已声明的能力触发，并由 Operation Runner 执行。适配器不创建 Run、不管理 Lock、不消费审批，也不决定清理顺序。锁定设备的能力需要稳定物理身份；默认配置不允许使用实例名作为身份。

普通 `device scan` 应保持被动：serial 源仅枚举端口名，网络源不扫描 LAN，设备 Probe 不在扫描或 Doctor 中运行。需要实际连接、复位或读写硬件时，应定义具有明确锁、超时和安全策略的能力。当前也没有串口 Action 执行器；端口会话必须使用经过声明验证的 `session:*` 路径。

## 参考

字段和验证规则见 [适配器格式](../../../docs/adapter-format.md)，工具与环境见 [工具发现](../../../docs/adapter-tool-discovery.md)，动作和输出处理见 [解析器和产物](../../../docs/adapter-parsers.md)。
