import { resolve } from "node:path";
import { compileAll, validateAdapter } from "./compiler.js";
import { hasErrors } from "./diagnostics.js";
import { runCases } from "./case-runner.js";

const root = resolve("src", "adapters", "_template");
const command = process.argv[2];
const result =
  command === "compile" ? await compileAll() : await validateAdapter(root);
let diagnostics = result.diagnostics;
if (command === "test") {
  const validation = await validateAdapter(root);
  diagnostics = [...diagnostics, ...(await runCases(validation.adapter))];
}
if (!command || !["validate", "compile", "test"].includes(command)) {
  process.stderr.write(
    "Usage: adapter:validate|adapter:compile|adapter:test\n",
  );
  process.exitCode = 2;
} else {
  process.stdout.write(`${JSON.stringify({ diagnostics })}\n`);
  if (hasErrors(diagnostics)) process.exitCode = 1;
}
