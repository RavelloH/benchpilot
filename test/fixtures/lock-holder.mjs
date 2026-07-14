import { LockManager, PathService } from "../../dist/index.js";

const [home, id] = process.argv.slice(2);
const manager = new LockManager(new PathService({ BENCHPILOT_HOME: home }));
const lock = await manager.acquire(id, "fixture");
process.stdout.write("ready\n");
await new Promise((resolve) => setTimeout(resolve, 10_000));
await manager.release(lock);
