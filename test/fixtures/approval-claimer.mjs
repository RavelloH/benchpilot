import { ApprovalManager, PathService } from "../../dist/index.js";

const [projectRoot, bindingJson] = process.argv.slice(2);
const manager = new ApprovalManager(
  new PathService({ TEMP: `${projectRoot}/runtime` }, "win32"),
  projectRoot,
);
const claim = await manager.claim(JSON.parse(bindingJson));
process.stdout.write(`${claim ? "claimed" : "unavailable"}\n`);
if (claim) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
