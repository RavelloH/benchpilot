import { compileAll, validateAllAdapters } from "./compiler.js";
import { hasErrors } from "./diagnostics.js";
import { runCases } from "./case-runner.js";

const command = process.argv[2];
const result =
  command === "compile" ? await compileAll() : await validateAllAdapters();
let diagnostics = result.diagnostics;
if (command === "test") {
  const validation = await validateAllAdapters();
  diagnostics = [
    ...diagnostics,
    ...(
      await Promise.all(
        validation.results.map((item) => runCases(item.adapter)),
      )
    ).flat(),
  ];
}
if (!command || !["validate", "compile", "test"].includes(command)) {
  process.stderr.write(
    "Usage: adapter:validate|adapter:compile|adapter:test\n",
  );
  process.exitCode = 2;
} else {
  diagnostics = diagnostics.sort((left, right) =>
    [left.adapterId ?? "", left.file, left.path ?? "", left.code, left.message]
      .join("\u0000")
      .localeCompare(
        [
          right.adapterId ?? "",
          right.file,
          right.path ?? "",
          right.code,
          right.message,
        ].join("\u0000"),
      ),
  );
  process.stdout.write(
    `${JSON.stringify({ ok: !hasErrors(diagnostics), diagnostics })}\n`,
  );
  if (hasErrors(diagnostics)) process.exitCode = 1;
}
