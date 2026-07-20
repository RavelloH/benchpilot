import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  coreErrorCatalog,
  coreErrorDefinition,
} from "../dist/core/errors/catalog.js";
import { humanErrorMessage } from "../dist/cli/output-renderer.js";
import { isMessageKey } from "../dist/i18n/index.js";

const sourceRoot = join(process.cwd(), "src");

test("literal BenchPilot errors use cataloged exit codes", async () => {
  const roots = ["core", "application", "cli"].map((name) =>
    join(sourceRoot, name),
  );
  const seen = new Set();
  for (const root of roots)
    for (const path of (await readdir(root, { recursive: true })).filter(
      (file) => file.endsWith(".ts"),
    )) {
      const file = join(root, path);
      if (file.endsWith(join("errors", "catalog.ts"))) continue;
      const source = ts.createSourceFile(
        file,
        await readFile(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node) => {
        const isFailure =
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "fail";
        const isError =
          ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "BenchPilotError";
        if (isFailure || isError) {
          const [kindNode, codeNode] = node.arguments ?? [];
          if (
            kindNode &&
            ts.isStringLiteral(kindNode) &&
            codeNode &&
            ts.isNumericLiteral(codeNode)
          ) {
            const definition = coreErrorDefinition(kindNode.text);
            assert.ok(
              definition,
              `${relative(sourceRoot, file)} uses uncataloged ${kindNode.text}`,
            );
            assert.equal(
              definition.exitCode,
              Number(codeNode.text),
              `${kindNode.text} exit code differs in ${relative(sourceRoot, file)}`,
            );
            seen.add(kindNode.text);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  assert.ok(seen.size > 20);
  for (const dynamicKind of [
    "APPROVAL_GUARD_BUSY",
    "FILE_GUARD_BUSY",
    "LOCK_GUARD_BUSY",
  ])
    assert.ok(coreErrorDefinition(dynamicKind));
});

test("every core error definition references generated messages", () => {
  for (const [kind, definition] of Object.entries(coreErrorCatalog)) {
    assert.equal(
      isMessageKey(definition.category.key),
      true,
      `${kind} category`,
    );
    assert.equal(isMessageKey(definition.reason.key), true, `${kind} reason`);
  }
  assert.equal(coreErrorDefinition("ADAPTER_EXTENSION_FAILED"), undefined);
});

test("human error presentation is definition-driven", () => {
  assert.equal(
    humanErrorMessage("zh-CN", "INVALID_ARTIFACT", "raw path failure"),
    "操作错误：执行产物无效、不可用，或不在允许的操作记录目录中。",
  );
  assert.equal(
    humanErrorMessage("en", "ADAPTER_EXTENSION_FAILED", "adapter fallback"),
    "Command failed: adapter fallback",
  );
});
