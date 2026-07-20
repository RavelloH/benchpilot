import assert from "node:assert/strict";
import test from "node:test";
import { staticCommandDefinitions } from "../dist/application/commands/definitions.js";
import {
  CommandGraphValidationError,
  validateCommandGraph,
} from "../dist/application/commands/validator.js";
import { isMessageKey } from "../dist/i18n/index.js";

const displayPath = (definition) =>
  definition.path
    .map((segment) =>
      segment.kind === "literal" ? segment.value : `<${segment.name}>`,
    )
    .join(" ");

test("the static command graph is valid and contains only implemented roots", () => {
  assert.equal(
    validateCommandGraph(staticCommandDefinitions, {
      messageExists: isMessageKey,
    }),
    staticCommandDefinitions,
  );
  const roots = staticCommandDefinitions
    .filter((definition) => !definition.parentId)
    .map((definition) => definition.path[0].value);
  assert.deepEqual(roots, [
    "init",
    "doctor",
    "language",
    "config",
    "adapter",
    "device",
    "system",
    "run",
    "lock",
    "approval",
    "help",
    "home",
    "version",
    "upgrade",
  ]);
  for (const unavailable of ["setup", "alias", "workflow", "skill", "docs"])
    assert.equal(roots.includes(unavailable), false);
});

test("the graph distinguishes arguments, resources, and capabilities", () => {
  const byId = new Map(
    staticCommandDefinitions.map((definition) => [definition.id, definition]),
  );
  assert.deepEqual(
    byId.get("device.execute").path.map((segment) => segment.kind),
    ["literal", "dynamic-resource", "dynamic-capability"],
  );
  assert.deepEqual(
    byId.get("system.create").path.map((segment) => segment.kind),
    ["literal", "literal", "argument", "argument"],
  );
  assert.equal(byId.get("run.show").path[1].provider, "runs");
  assert.equal(
    byId.get("upgrade.version").path[1].provider,
    "upgrade-versions",
  );
  const paths = new Set(staticCommandDefinitions.map(displayPath));
  for (const path of [
    "language list",
    "config explain <key>",
    "adapter <adapter> doctor",
    "device <device> <capability>",
    "system member add <system> <device>",
    "system <system> show",
    "run <run> artifacts",
    "lock <lock> inspect",
    "approval <approval> approve",
    "upgrade <version>",
  ])
    assert.equal(paths.has(path), true, path);
});

test("graph validation rejects structural ambiguity", () => {
  const base = {
    id: "root",
    path: [{ kind: "literal", value: "root" }],
    summary: { key: "command.home" },
    arguments: [],
    options: [],
    interaction: "never",
    handler: "root.execute",
    output: { id: "root", schema: "root", version: 1, view: "root" },
  };
  assert.throws(
    () =>
      validateCommandGraph([
        base,
        { ...base, id: "duplicate", aliases: ["root"] },
      ]),
    (error) => {
      assert.ok(error instanceof CommandGraphValidationError);
      assert.ok(
        error.diagnostics.some((item) => item.code === "DUPLICATE_PATH"),
      );
      return true;
    },
  );
  assert.throws(
    () =>
      validateCommandGraph([
        { ...base, handler: undefined, output: undefined },
      ]),
    (error) =>
      error instanceof CommandGraphValidationError &&
      error.diagnostics.some((item) => item.code === "EMPTY_BRANCH"),
  );
});
