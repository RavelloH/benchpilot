# 适配器概览

BenchPilot 的适配器（Adapter）用于把某一类工具链、项目与设备接入统一的命令、配置和操作模型。当前适配器采用声明式格式（Declarative Adapter Format v1）：适配器由 TOML、JSON Schema 与本地化目录组成，经编译后成为 Bundle v2；它不是可由用户项目加载的 JavaScript 或 npm 插件。

这一边界意味着，适配器只描述能力、工具、环境、动作、工作流、解析规则及设备规则。Run、日志、超时、取消、审批、Lock、清理和产物登记均由 Core 与 Operation Runner 管理。适配器规则不得包含 shell 命令字符串、JavaScript 表达式或绕开 Operation Runner 的硬件访问路径。

内置的 `esp-idf` 是当前唯一的生产适配器，详见 [ESP-IDF 适配器](adapters/esp-idf.md)。创建新适配器应从 [适配器模板](adapter-template.md) 开始。

## 使用范围

适配器可以：

- 为标准能力或扩展能力声明输入、输出、超时、锁模式和安全策略；
- 以参数数组规划进程动作，或将动作顺序组成工作流；
- 按优先级发现工具、解析工具输出、解析业务输出并登记安全的产物；
- 定义被动设备发现规则、稳定物理身份和受管串口会话；
- 提供输入、输出和设备配置的 JSON Schema，以及屏幕输出的受限视图。

适配器不会：

- 直接创建 Run、获取或释放 Lock、消费审批、写业务日志或决定清理顺序；
- 通过 `device scan` 打开串口、切换 DTR/RTS 或扫描局域网；
- 提供任意 shell 执行、串口 Action 执行器或外部 npm 适配器安装；
- 修改 JSON Result v3 或 JSONL Event v3 的公共结构。

## 启用、发现与配置

`benchpilot adapter <id> enable` 与 `disable` 仅修改当前项目配置中 `[adapters].enabled`，不会安装工具或改写全局适配器配置。

`benchpilot adapter <id> discover` 解析每个声明的工具、验证路径并运行其探测（probe）。所有必需工具均可用时，命令才会原子地写入声明为可持久化的全局 `[adapters.<id>]` 配置项。`configure --<key> <path>` 使用同一套发现与验证规则校验手工路径后再保存。已配置路径优先于环境变量、PATH 和其他候选项；显式配置但无效时会报错，不会静默回退。

这两类命令不操作设备。设备能力仅在适配器已为项目启用且通过动态命令图调用时执行。

## 编译与加载

开发时可运行以下命令：

```powershell
pnpm run adapter:validate
pnpm run adapter:compile
pnpm run adapter:test
```

`adapter:validate` 在 stdout 输出机器可读 JSON 诊断；存在错误时以非零状态退出。`adapter:compile` 只编译通过验证的内置适配器，生成确定性的 `dist/adapters/bundles/*.json` 与索引。Bundle 内含源哈希、Bundle SHA-256、已合并的平台规则、Schema 和本地化文本。

生产运行时只从随包发布的 Bundle 读取规则，不读取用户项目中的适配器 TOML。`_template` 会参加格式校验，但永不被编译或发布；`test/fixtures/adapters/complete` 是覆盖完整声明格式的测试夹具，也不是生产适配器。

## 与核心操作模型的关系

启用的能力会转换为 Core Capability。输入由 Schema 校验，敏感字段会在配置、审批、日志与结果前脱敏；输出同样经 Schema 校验。能力声明的 `timeout` 是默认上限，Operation Runner 的整体截止时间仍是外层边界。

需要设备锁的能力必须获得稳定物理身份。运行时按 `identity.fields` 的顺序取值，可选地使用规范化端口作为回退；只有显式开启 `allow_instance_fallback` 才能使用实例名。没有稳定身份的设备无法执行锁模式为 `device` 的能力，错误为 `DEVICE_IDENTITY_UNAVAILABLE`。

关于声明文件和验证规则，参见 [适配器格式](adapter-format.md)；关于能力安全边界，参见 [能力声明](adapter-capabilities.md)。
