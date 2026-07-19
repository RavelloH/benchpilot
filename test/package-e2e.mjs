import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "benchpilot-package-"));
const pnpmCli = process.env.npm_execpath;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCommand = (args, options) => {
  if (process.platform !== "win32") return execFileSync(npm, args, options);
  return execFileSync(
    process.env.ComSpec || "cmd.exe",
    ["/d", "/c", "npm", ...args],
    options,
  );
};

try {
  assert.ok(pnpmCli, "pnpm CLI path is unavailable.");
  execFileSync(
    process.execPath,
    [pnpmCli, "pack", "--pack-destination", temp],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  const archive = path.join(
    temp,
    (await readdir(temp)).find((name) => name.endsWith(".tgz")) || "",
  );
  assert.notEqual(archive, temp, "pnpm pack did not create an archive.");
  const project = path.join(temp, "project");
  await mkdir(project);
  await writeFile(
    path.join(project, "package.json"),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
  );
  npmCommand(["install", archive], {
    cwd: project,
    stdio: "inherit",
  });
  const env = {
    ...process.env,
    HOME: temp,
    USERPROFILE: temp,
    TEMP: path.join(project, "runtime"),
  };
  const run = (...args) =>
    npmCommand(["exec", "--no", "--", "benchpilot", ...args], {
      cwd: project,
      env,
      encoding: "utf8",
    });
  assert.match(run("--version"), /0\.0\.0/);
  assert.match(run("help"), /Agent-first device lifecycle CLI/);
  await access(
    path.join(
      project,
      "node_modules",
      "benchpilot",
      "dist",
      "i18n",
      "catalogs.generated.js",
    ),
  );
  await access(
    path.join(
      project,
      "node_modules",
      "benchpilot",
      "dist",
      "adapters",
      "bundles",
      "index.json",
    ),
  );
  run("init", "--project-name", "Demo", "--locale", "en");
  const commands = [
    ["help", "--json"],
    ["doctor", "--json"],
    ["adapter", "list", "--json"],
    ["device", "scan", "--json"],
    ["run", "list", "--json"],
  ];
  for (const args of commands) {
    const result = JSON.parse(run(...args));
    if (args[0] === "help") {
      assert.ok(Array.isArray(result), `${args.join(" ")} uses a page tree`);
      assert.equal(result[0]?.name, "name");
      continue;
    }
    assert.equal(
      typeof result.schema,
      "string",
      `${args.join(" ")} has a schema`,
    );
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
