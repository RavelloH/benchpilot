import { LockManager, PathService } from "../../dist/index.js";

const [runtime, id] = process.argv.slice(2);
const manager = new LockManager(new PathService({ TEMP: runtime }, "win32"));
const lock = await manager.acquire(id, "fixture");
process.stdout.write("ready\n");
await new Promise((resolve) => setTimeout(resolve, 10_000));
await manager.release(lock);
