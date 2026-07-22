# 设备锁

## 目的与范围

BenchPilot 使用锁（Lock）协调对同一物理资源的排他访问。任何声明 `lockMode: "exclusive"` 的 Capability 都必须由 Operation Runner 在调用能力实现前取得锁；适配器不应自行创建、绕过或释放这类锁。

锁保护的是物理资源，而不是配置中的设备实例名。两个项目即使使用不同的设备实例，只要适配器、资源类型和物理标识相同，就会得到相同的锁标识并相互排斥。

本文说明设备锁的状态、恢复流程和操作边界。它不替代设备端的电气安全措施，也不保证外部工具没有直接占用串口、调试器或烧录器。

## 锁标识与存储位置

设备锁的物理身份由以下字段组成：

```text
adapter + kind + physicalId
```

Core 会对稳定序列化后的身份计算 SHA-256 摘要，并生成形如 `<adapter>-<kind>-<digest>` 的锁 ID。ID 中不会包含原始 `physicalId`；完整身份只保存在锁记录中，供本机诊断和审计使用。

运行时锁目录位于临时运行时目录下：Windows 使用 `%TEMP%\\benchpilot\\locks`；其他平台优先使用 `$XDG_RUNTIME_DIR/benchpilot/locks`，否则使用系统临时目录。锁的更新保护文件和人工恢复记录与该目录相邻。锁本身不是项目私有状态，因此不同项目可以竞争同一台物理设备。

若设备运行时身份明确标记为不稳定，排他能力会在取得锁之前失败，错误为 `DEVICE_IDENTITY_UNAVAILABLE`。这避免把会变化的端口或临时枚举结果误当成设备身份。

## 获取、续租与释放

锁目录中保存 `owner.json`，当前格式为 `benchpilot.lock` v2。记录至少包含锁 ID、物理身份、所有者随机令牌、PID、主机名、命令、可选 Run ID，以及取得、心跳和过期时间。

获取时，BenchPilot 先在同级的临时创建目录写入记录，再通过目录重命名发布为正式锁。进程在创建过程中崩溃时，不会留下一个已发布但内容为空的锁目录。释放时则先将锁目录重命名为短暂的释放目录，再删除该目录，降低并发读取到半删除状态的风险。

取得锁后，Operation Runner 会启动心跳租约。默认心跳间隔为 5 秒，租期为 30 秒；服务集成可以覆盖这两个值。心跳和释放都在按锁 ID 保护的临界区中重新校验 `ownerToken`。如果发现令牌已被替换，旧持有者不能更新或删除新记录，并会得到 `LOCK_OWNERSHIP_LOST`。该错误会中止关联的操作。

`LockLease.stop()` 是异步操作：它会等待正在进行的心跳完成。因此，完成释放的租约不会在之后再次写回锁记录。

## 状态与存活判断

持久化状态和当前存活判断是两个不同的概念。

| 项目                | 含义                                                     |
| ------------------- | -------------------------------------------------------- |
| `active`            | 正常持有的锁记录。                                       |
| `quarantined`       | 清理失败可能仍保留物理资源访问，禁止自动或普通获取。     |
| `quarantine-failed` | 写入隔离状态本身失败；系统会尽力留下独立的人工恢复记录。 |
| `active` 存活性     | 本机 PID 仍存在，且心跳时间可解析。                      |
| `stale` 存活性      | 已能证明原持有者不再存活，或跨主机记录已严重过期。       |
| `unknown` 存活性    | 不能安全判断；例如其他主机的租约尚未严重过期。           |

对本机记录，BenchPilot 通过 PID 探测判断进程是否存在；跨主机记录仅在过期时间额外超过 10 秒后视为 stale。`clear-stale` 只会清除状态为 `active` 且已确认 stale 的锁。获取锁不会接管 stale 锁，必须由操作者显式清除。

## 隔离与人工恢复

Capability 注册的清理项可以声明其是否仍持有物理资源。任一此类清理项失败或超时后，Operation Runner 会将已取得的锁写为 `quarantined`，而不是正常释放。后续获取同一锁会失败并报告 `DEVICE_QUARANTINED`。

若隔离写入也失败，系统会尝试在运行时目录的 `lock-recovery` 中写入人工恢复记录，并把锁标记为 `quarantine-failed`。过期锁清理不会读取或删除这类恢复记录。

在清除隔离锁或人工恢复记录前，操作者应确认以下事实：

1. 先前的 BenchPilot、烧录工具、调试器和串口监视程序均已停止。
2. 设备没有处于可能造成危险的供电、复位或烧录状态。
3. 要释放的锁确实对应目标物理资源。

常用命令如下：

```powershell
benchpilot lock list
benchpilot lock <lock-id> show
benchpilot lock clear-stale
benchpilot lock <lock-id> clear --dangerously-clear-active-lock
benchpilot lock <lock-id> clear --dangerously-clear-quarantined-lock
```

`clear-stale` 不接受也不需要危险确认。清除仍活跃或无法判断的普通锁需要 `--dangerously-clear-active-lock`；清除 `quarantined` 或 `quarantine-failed` 锁需要 `--dangerously-clear-quarantined-lock`。CLI 的交互界面会在执行清除前要求确认，但脚本调用仍应显式提供对应开关。

## 异常目录

锁目录非空但没有可验证的 v2 `owner.json` 时，BenchPilot 将其报告为 `LOCK_CORRUPT`，并在锁列表中提供目录和条目名称。系统不会自动删除此类目录，也不会将其视为可安全复用的锁。

应先检查目录内容、相关进程和实际设备状态，再手动进行恢复。直接删除未知锁目录可能使仍在访问设备的外部进程与新的操作并发运行。

## 适配器要求

适配器应为每个 Capability 明确声明 `lockMode`。对会使用烧录器、调试器、串口或其他独占设备通道的能力，应声明 `exclusive`；纯计算且不访问共享物理资源的能力才可以声明 `none`。

长时间运行的外部进程必须注册为 Operation cleanup，并将其物理资源持有属性如实声明。这样进程无法结束或清理超时时，Core 才能隔离锁并阻止后续误操作。
