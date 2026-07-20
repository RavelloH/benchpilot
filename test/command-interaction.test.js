import assert from "node:assert/strict";
import test from "node:test";
import { staticCommandDefinitions } from "../dist/application/commands/definitions.js";
import { CommandInteractionService } from "../dist/application/commands/interaction.js";
import { interactionMenuChoices } from "../dist/cli/interaction/menu.js";

const service = new CommandInteractionService(staticCommandDefinitions);

test("interaction menus come from ordered command definitions", () => {
  const entries = service.children("config");
  assert.deepEqual(
    entries.map((entry) => [entry.commandId, entry.value, entry.summary.key]),
    [
      ["config.get", "get", "menu.action.get"],
      ["config.set", "set", "menu.action.set"],
      ["config.unset", "unset", "menu.action.unset"],
      ["config.resolved", "resolved", "menu.action.resolved"],
      ["config.explain", "explain", "menu.action.explain"],
      ["config.validate", "validate", "menu.action.validate"],
    ],
  );
});

test("interaction recipes select command ids without defining presentation", () => {
  assert.deepEqual(
    service
      .children("lock.resource", ["lock.clear", "lock.show"])
      .map((entry) => entry.value),
    ["show", "clear"],
  );
  assert.throws(
    () => service.children("lock.resource", ["lock.missing"]),
    /Unknown interaction commands: lock\.missing/,
  );
});

test("one interaction projector localizes and aligns every command menu", () => {
  const entries = service.children("language");
  assert.deepEqual(
    interactionMenuChoices(entries, "en", false).map((choice) => choice.label),
    ["list  List", "get   Read configuration", "set   Write configuration"],
  );
  assert.deepEqual(
    interactionMenuChoices(entries, "zh-CN", false).map(
      (choice) => choice.label,
    ),
    ["list  列出", "get   读取配置", "set   写入配置"],
  );
});
