# 外部进程执行

## 目的与范围

Core 的 `runProcess()` 和 `startProcess()` 用于执行适配器所需的外部程序。它们以参数数组启动可执行文件、禁用 shell，并将进程生命周期绑定到操作的 `AbortSignal`。适配器不应使用 shell 字符串拼接来替代该执行器。

该执行器负责启动、标准输出与标准错误的流式转发、可选的有界捕获，以及取消后的进程树终止。它不解释命令业务语义，也不把非零退出码自动转换为某个适配器错误；调用方负责解析结果并决定错误类别。

## 调用方式

`runProcess()` 启动后等待完成，返回退出码、信号和耗时。`startProcess()` 额外返回 `StartedProcess`，适合需要在操作期间保留子进程句柄的场景：

```ts
const process = startProcess({
  command: "tool",
  args: ["--port", port],
  cwd,
  env,
  signal: context.signal,
  onStdout: (chunk) => context.logger.info(chunk.toString("utf8")),
});

context.registerCleanup("tool-process", () => process.stop(), {
  critical: true,
  holdsPhysicalResource: true,
});

const result = await process.result;
```

`command` 是可执行文件路径或名称，`args` 是逐项参数；执行器始终使用 `shell: false`。调用前如果 `signal` 已中止，函数会拒绝启动，不会创建子进程。

## 输出转发与捕获

子进程以管道方式创建 stdout 和 stderr。每个数据块可以同时写入提供的 `Writable` 流，并调用 `onStdout` 或 `onStderr` 回调。适配器运行时通常将这些块交给日志和解析层；不得把业务日志写入 JSON stdout。

默认不保存完整输出。设置 `captureOutput: true` 后，结果中才会返回 `stdout` 和 `stderr` 文本。默认上限为 4 MiB，可通过 `maxCaptureBytes` 调整。超出上限时，执行器保留前部和尾部字节，并在两者之间插入明确的截断分隔符；结果会设置 `stdoutTruncated`、`stderrTruncated` 和汇总字段 `outputTruncated`。

因此，捕获结果是供诊断和有界解析使用的视图，不是原始连续字节流。需要完整原始输出时，调用方应将流写入受控的 Run capture 或 artifact，而不是提高内存捕获上限。

## 取消与进程树终止

当关联 `AbortSignal` 触发时，执行器停止进程，并在终止已确认后才拒绝 `result`。默认会终止进程树；可通过 `killTree: false` 仅终止直接子进程，但只有在子进程不会继续持有设备或其他关键资源时才应这样做。

不同平台的处理方式如下：

| 平台      | 正常终止                                     | 强制终止                                           |
| --------- | -------------------------------------------- | -------------------------------------------------- |
| Unix-like | 子进程以独立进程组启动，向组发送 `SIGTERM`。 | 超过宽限期后向组发送 `SIGKILL`。                   |
| Windows   | 等待 `taskkill /PID <pid> /T`。              | 正常终止未确认后执行 `taskkill /PID <pid> /T /F`。 |

默认正常终止宽限期 `gracefulKillMs` 为 2 秒，强制终止等待 `forceKillMs` 也为 2 秒。执行器会验证进程组或子进程已退出；超过这两个阶段仍无法确认退出时，`result` 以 `PROCESS_CLEANUP_TIMEOUT` 失败，状态变为 `cleanup-timeout`。

这意味着操作超时或收到 `SIGINT`、`SIGTERM` 时，Capability 的 Promise 不应仅依赖信号自行返回。任何由 Process Runner 启动的外部进程都会经历终止流程，操作随后才进入其余清理步骤。

## `StartedProcess` 状态与 `stop()`

`StartedProcess.state` 可为 `running`、`stopping`、`stopped`、`exited` 或 `cleanup-timeout`。`isRunning()` 仅在 `running` 和 `stopping` 时返回 true。

`stop()` 可重复调用，多个调用会共享同一个停止过程。进程已正常退出后调用 `stop()` 是无操作，不会向可能已被系统复用的 PID 发送信号。对仍运行的进程，`stop()` 使用与取消相同的树终止策略，并在成功确认退出后完成。

长生命周期进程必须由 Capability 注册 cleanup。清理项应标为 `critical: true`，并在进程可能占用串口、调试器、烧录器或其他设备通道时标为 `holdsPhysicalResource: true`。若 `stop()` 返回 `PROCESS_CLEANUP_TIMEOUT` 或其他此类清理失败，Operation Runner 会隔离关联物理锁，而不是把它释放给下一次操作。

## 调用方责任

调用方应显式提供需要的工作目录、环境变量和取消信号，并根据工具协议处理退出码、信号、输出编码与截断。不要假设 stdout 数据块按行、按 UTF-8 字符或按工具消息边界切分；流块是任意分段。

对于普通短命令，等待 `runProcess()` 即可。对于会在后台持续运行、可能产生子进程或访问物理设备的工具，应使用 `startProcess()` 并立即注册清理。这样 Operation Runner 才能维持既定清理顺序：能力清理、锁租约停止、审批终结、锁释放或隔离、日志关闭，最后终结 Run。
