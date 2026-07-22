# 声明式适配器格式

声明式适配器格式（Declarative Adapter Format）v1 是 BenchPilot 内置适配器的发布格式。它将工具、环境、设备、动作、工作流与输出处理写成经过 Schema 校验的静态规则，并由编译器生成 Bundle v2。格式的目标是让厂商差异留在声明中，而不是让 Core 按开发板或工具品牌分支。

规则仅是数据。模板只能读取受限上下文，进程调用总是结构化 argv，所有硬件影响必须通过声明能力交由 Operation Runner 执行。

## 目录结构

每个适配器目录必须包含下列文件：

```text
manifest.toml                 capabilities.toml          views.toml
tools.toml                    tool-discovery.toml        environments.toml
devices.toml                  actions.toml               workflows.toml
sessions.toml                 parsers.toml               artifacts.toml
schemas/config.schema.json    schemas/device.schema.json
schemas/inputs.schema.json    schemas/outputs.schema.json
platforms/windows.toml        platforms/linux.toml       platforms/macos.toml
tests/cases.toml              README.md
```

`installation.toml` 是唯一可选的顶级规则文件。额外文件只允许位于 `tests/fixtures/`、`docs/` 或 `i18n/<locale>.toml`；其他文件会被格式验证拒绝。适配器 ID 必须为小写 kebab-case，并与内置目录名称一致。

安装声明通过 `provider` 选择 Runtime 中显式注册的安装 provider。provider 负责已验证下载、环境校验与其集成特有的清理；其选择只依据声明名，不依据适配器 ID、厂商或板型。新增 provider 需要 Runtime 与格式支持，适配器包不能携带任意 JavaScript。

`manifest.toml` 描述 ID、显示名称、版本、说明、目录版本、最低 BenchPilot 版本、状态、弃用状态和标签。`capability_catalog_version` 必须匹配当前目录版本。四个 JSON Schema 分别定义全局适配器配置、设备配置、能力输入和能力输出；同一根 Schema 内的 `$defs` 可使用本地 JSON Pointer `$ref` 相互引用。

## 模板与条件

模板只支持 `${namespace.path}` 查找，不执行表达式、代码或命令替换。运行时上下文包含 `adapter`、`platform`、`config`、`device`、`input`、`project`、`home`、`temp`、`env`、`run`、`tool`、`discovery`、`environment`、`result`；工作流还会提供步骤结果。条件路径使用相同的受限点路径，支持 `equals`、`not-equals`、`in`、`not-in`、`exists`、`not-exists`、`truthy`、`falsy`。

可执行字段中的缺失值会导致 `ADAPTER_TEMPLATE_VALUE_MISSING`，不会被替换为空字符串。包括可执行文件、argv、工作目录、环境变量、工具路径与捕获脚本路径。因而用户输入可以作为参数数据参与渲染，但不能成为 shell 源码。

`devices.toml` 的 `serial` source 通过 Runtime 的共享串口 binding 被动枚举，不会打开端口或改变 DTR/RTS。每条记录至少包含 `port`；可用时还会提供 `description`、`hwid`、`vid`、`pid`、`serial_number`、`manufacturer`、`product` 和 `location`，供匹配器与稳定身份规则使用。适配器不得以嵌入脚本重做端口枚举。

## 平台覆盖

三个 `platforms/*.toml` 文件必须声明对应的 `platform` 和 `overrides`。覆盖可修改工具、工具发现、环境、设备、动作、工作流、会话、解析器与产物中的既有规则；对象递归合并，数组整体替换。覆盖不能改写 manifest、Schema、能力目录、本地化或视图，也不能引入新的规则 ID。

能力的可用平台由 `capabilities.toml` 的显式布尔值决定，不能通过平台覆盖文件增加支持。

## 本地化与视图

若存在本地化目录，必须有 `i18n/en.toml`。其他语言文件必须与英文目录具有相同的叶节点键；运行时先查所选语言，再回退至英文。消息键使用点分层级，例如 `doctor.environment_failed`。文本中的 `{name}` 会以提供的变量替换。

`views.toml` 只影响 Screen 展示，不进入 JSON Result v3 或 JSONL Event v3。视图可使用 Schema 已声明且非敏感的输出字段，标题、标签和完成消息都必须给出消息键与英文回退。支持 `detail`、`tree`、`completion` 和 `records` 等共享展示形式；不能放入 TypeScript、ANSI、任意格式化器或自定义渲染代码。

## 验证层次

编译器依次检查目录布局、JSON Schema、Schema 中的模板引用，以及跨文件语义：引用是否存在、正则是否可编译、处理器是否匹配、工具依赖是否成环、能力安全声明是否完整、平台覆盖是否越界等。`adapter:test` 只对无错误诊断的适配器运行声明测试案例。

格式的起点和可复制的完整空骨架见 [适配器模板](adapter-template.md)。
