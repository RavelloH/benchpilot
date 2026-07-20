import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";

const sourceRoot = join(process.cwd(), "src");

async function typeScriptFiles(root) {
  return (await readdir(root, { recursive: true }))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => join(root, file));
}

const imports = (source) =>
  [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map(
    (match) => match[1],
  );

test("core and application imports follow the layer dependency direction", async () => {
  const rules = [
    {
      root: join(sourceRoot, "core"),
      forbidden: ["/cli/", "/application/", "/i18n/"],
    },
    {
      root: join(sourceRoot, "application"),
      forbidden: ["/cli/", "/i18n/"],
    },
  ];
  for (const rule of rules)
    for (const file of await typeScriptFiles(rule.root)) {
      const source = await readFile(file, "utf8");
      for (const specifier of imports(source))
        for (const forbidden of rule.forbidden)
          assert.equal(
            specifier.replaceAll("\\", "/").includes(forbidden),
            false,
            `${relative(sourceRoot, file)} imports forbidden layer ${specifier}`,
          );
    }
});

test("package metadata is the only CLI version source", async () => {
  const source = await readFile(join(sourceRoot, "cli", "index.ts"), "utf8");
  assert.match(source, /packageVersion/);
  assert.doesNotMatch(source, /const version\s*=\s*["']/);
});

test("Application returns locale-neutral data", async () => {
  const root = join(sourceRoot, "application");
  for (const file of await typeScriptFiles(root)) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /\.translate\s*\(/,
      `${relative(sourceRoot, file)} translates presentation text`,
    );
  }
});

test("only the RLog infrastructure adapter imports rlog-js", async () => {
  const importers = [];
  for (const file of await typeScriptFiles(sourceRoot)) {
    const source = await readFile(file, "utf8");
    if (imports(source).includes("rlog-js"))
      importers.push(relative(sourceRoot, file).replaceAll("\\", "/"));
  }
  assert.deepEqual(importers, ["infrastructure/rlog-business-log.ts"]);
});

test("CLI and i18n code do not bypass generated MessageKey types", async () => {
  for (const root of [join(sourceRoot, "cli"), join(sourceRoot, "i18n")])
    for (const file of await typeScriptFiles(root)) {
      const source = await readFile(file, "utf8");
      assert.doesNotMatch(
        source,
        /\bas\s+never\b/,
        `${relative(sourceRoot, file)} bypasses a generated message contract`,
      );
    }
});

test("CLI display width is implemented only by terminal primitives", async () => {
  const offenders = [];
  for (const file of await typeScriptFiles(join(sourceRoot, "cli"))) {
    const source = await readFile(file, "utf8");
    if (
      !file.endsWith(join("terminal", "text.ts")) &&
      /(?:codePointAt\s*\(|const\s+(?:displayWidth|padDisplay|pad)\s*=)/.test(
        source,
      )
    )
      offenders.push(relative(sourceRoot, file));
  }
  assert.deepEqual(offenders, []);
});

test("help views do not branch on command identity", async () => {
  const files = [
    join(sourceRoot, "cli", "help", "renderer.ts"),
    ...(await typeScriptFiles(join(sourceRoot, "cli", "views"))),
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /(?:data\.)?command\.id|commandId/,
      `${relative(sourceRoot, file)} contains command-specific view routing`,
    );
  }
  const menu = await readFile(
    join(sourceRoot, "cli", "presentation", "root-help.ts"),
    "utf8",
  );
  assert.doesNotMatch(menu, /staticCommandDefinitions/);

  for (const file of await typeScriptFiles(join(sourceRoot, "cli"))) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /agentHelpSections|agentRootHelpPage|commandHelpPage|rootHelpPage/,
      `${relative(sourceRoot, file)} retains a parallel help tree`,
    );
  }
});

test("CLI interaction labels come from command definitions", async () => {
  const source = await readFile(join(sourceRoot, "cli", "index.ts"), "utf8");
  assert.doesNotMatch(
    source,
    /menu\.(?:action|lock\.listAll|approval\.listAll)/,
  );
  assert.doesNotMatch(source, /const\s+menuChoices\s*=/);
});
