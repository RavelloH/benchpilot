# Process Runner

`runProcess` and `startProcess` execute commands without a shell and bind them to an Operation `AbortSignal`. Output is streamed to supplied writable streams or callbacks by default; full capture is opt-in and bounded.

On Unix, tree termination uses a detached process group and sends `SIGTERM`, then `SIGKILL` after the configured grace period. On Windows, it awaits `taskkill /PID <pid> /T` and escalates to `/F` if needed. In both cases, an aborted Operation does not settle until the tree has exited or reports `PROCESS_CLEANUP_TIMEOUT`.

`StartedProcess` exposes `state` and `isRunning()`. Calling `stop()` after normal completion is idempotent and does not send a signal to a possibly reused PID. Adapters should register `process.stop()` as critical Operation cleanup for long-lived child processes; a `PROCESS_CLEANUP_TIMEOUT` quarantines its physical Lock.
