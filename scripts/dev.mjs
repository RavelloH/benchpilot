import { watch } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const run = (label, args) =>
  new Promise((resolve) => {
    process.stdout.write(`[dev] ${label}\n`);
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code && code !== 0)
        process.stderr.write(
          `[dev] ${label} failed (exit ${code}); waiting for changes.\n`,
        );
      resolve();
    });
  });

const serialTask = (label, args) => {
  let running = false;
  let pending = false;
  let timer;
  const execute = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    do {
      pending = false;
      await run(label, args);
    } while (pending);
    running = false;
  };
  return () => {
    clearTimeout(timer);
    timer = setTimeout(execute, 100);
  };
};

const runI18n = serialTask("regenerating i18n catalog", [
  "scripts/generate-i18n.mjs",
]);
const compileAdapters = serialTask("compiling adapter bundles", [
  "--import",
  "tsx",
  "src/adapters/compiler/cli.ts",
  "compile",
]);

await run("generating i18n catalog", ["scripts/generate-i18n.mjs"]);
await run("compiling adapter bundles", [
  "--import",
  "tsx",
  "src/adapters/compiler/cli.ts",
  "compile",
]);

const compiler = spawn(
  process.execPath,
  [
    path.join("node_modules", "typescript", "bin", "tsc"),
    "-p",
    "tsconfig.json",
    "--watch",
    "--preserveWatchOutput",
  ],
  { cwd: process.cwd(), stdio: "inherit" },
);

const watchers = [
  watch(path.join("src", "i18n", "locales"), { recursive: true }, runI18n),
  watch(path.join("src", "adapters"), { recursive: true }, compileAdapters),
];

const stop = () => {
  for (const watcher of watchers) watcher.close();
  compiler.kill("SIGINT");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
