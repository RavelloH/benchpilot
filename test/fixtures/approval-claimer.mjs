import { ApprovalManager, PathService } from "../../dist/index.js";

const [home, bindingJson] = process.argv.slice(2);
const manager = new ApprovalManager(new PathService({ BENCHPILOT_HOME: home }));
const claim = await manager.claim(JSON.parse(bindingJson));
process.stdout.write(`${claim ? "claimed" : "unavailable"}\n`);
