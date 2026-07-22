# 工具发现与环境解析

Tool 是适配器使用的逻辑程序名，Discovery 是将它解析为本机可信路径的规则，Environment 是运行该工具所需的进程环境。三者分离后，适配器可以声明解释器链、SDK 激活与配置持久化，而无需执行任意 shell 文本。

## 工具与启动计划

`tools.toml` 中每个 Tool 都声明 `required`、发现规则 ID 和 `launch`。直接启动使用 `launch.mode = "direct"`；解释器式启动使用 `launch.mode = "via-tool"`，引用父 Tool。运行时先递归解析父工具，再组合可执行文件和前缀参数：父工具的 executable 成为最终 executable，父前缀与当前 `prefix_args` 构成 argv 前缀。工具依赖循环是格式错误。

每个 Tool 还选择 Environment ID。运行时得到的 Launch 包含 executable、argsPrefix、发现的 path/root、候选 ID 和完整依赖链；这使同一 Tool 的 Action 与 Probe 使用一致的工具链。

## 候选路径与优先级

Discovery 的候选类型为 `config`、`config-path`、`environment`、`environment-path`、`path`、`fixed`、`glob` 与 `json-path`。候选按 `priority` 降序、声明顺序升序尝试，并只考虑当前平台已启用的候选。

- `config` 直接读取配置键；`config-path` 在其后追加路径段。
- `environment` 与 `environment-path` 读取进程环境；Windows 的名称匹配不区分大小写。
- `path` 在 PATH 的各目录中查找声明名称，并自动考虑该平台的可执行扩展名。
- `fixed` 和 `glob` 的路径可使用受限模板；glob 结果按字典序处理。
- `json-path` 从声明 JSON 文件的对象集合中取字段路径，可同时保留原始根路径供持久化使用。

显式配置为空时会继续寻找其他候选；显式配置有值但不通过 `path_type`、可执行性或平台验证时立即报 `ADAPTER_TOOL_CONFIG_INVALID`，不会回退到 PATH。若所有候选失败，运行时返回 `ADAPTER_TOOL_NOT_FOUND`。

## 探测与持久化

可选 `probe` 通过完整 Launch 使用共享 Process Runner 运行固定 argv，并由 `parsers.toml` 中的 Parser 解释。Probe 超时默认十秒，输出上限为每流 4 MiB；解析失败为 `ADAPTER_TOOL_PROBE_FAILED`，超时为 `ADAPTER_TOOL_PROBE_TIMEOUT`。Probe 缓存按适配器、平台、可执行文件、前缀、环境与参数隔离；原始输出和完整环境不会暴露在 Doctor 或扫描结果中。

`persistence` 让发现结果可由 `benchpilot adapter <id> discover` 保存。它声明配置 `key`，选择 `path` 或 `root` 作为源，并可移除固定 `strip_suffix`。仅声明为持久化的值会被写入，且所有必需工具已成功解析和探测后才原子保存。`configure --<key> <path>` 也使用同一规则验证路径。

## 环境

`strategy = "inherit"` 直接复制启动 BenchPilot 的环境。其他环境按 provider 优先级依次尝试：

- `active` 检查所需环境变量均已存在；
- `static` 将模板渲染后的字符串变量覆盖到基础环境；
- `capture-script` 通过固定 PowerShell、cmd 或 POSIX shell 包装器 source/call 一个已验证的脚本，并由当前 Node 可执行文件序列化环境。

捕获脚本必须是存在的普通文件，脚本路径、Node 路径与发射程序都是独立参数。捕获的硬上限为十秒。运行时只将相对基础环境的差异缓存在临时目录，并以 0600 文件权限保存；缓存失效键包含脚本真实路径、修改时间、发现结果和基础环境。

## 与设备发现的关系

工具探测不是设备探测。`device scan` 的 `command` 源可以使用声明的 Tool 和 Environment，但它只能引用声明 Action 与 Parser，受十秒上限约束；不会接受适配器提供的自由命令字符串。适配器的设备 Probe 不会在普通扫描或 Doctor 中执行。
