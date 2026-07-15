import { compileAll, validateAllAdapters } from "./compiler.js";
import { hasErrors } from "./diagnostics.js";
import { runCases } from "./case-runner.js";

const command = process.argv[2];
const validation = command === "compile" ? null : await validateAllAdapters();
const result = validation ?? (await compileAll());
let diagnostics = result.diagnostics;
if (command === "test" && validation) {
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
