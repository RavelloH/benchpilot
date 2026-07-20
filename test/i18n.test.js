import assert from "node:assert/strict";
import test from "node:test";
import {
  messageArguments,
  sameMessageArguments,
} from "../scripts/i18n-contracts.mjs";
import { msg, resolveMessage, t } from "../dist/i18n/index.js";

test("ICU contracts parse arguments and reject incompatible uses", () => {
  assert.deepEqual(
    messageArguments(
      "{count, plural, =0 {none} one {one item} other {# items}}",
      "fixture",
    ),
    { count: "number" },
  );
  assert.equal(
    sameMessageArguments(
      messageArguments("Hello {name}"),
      messageArguments("你好，{name}"),
    ),
    true,
  );
  assert.throws(
    () => messageArguments("{value} {value, number}", "fixture"),
    /both string \| number \| boolean and number/,
  );
  assert.throws(
    () => messageArguments("{count, plural, one {one}", "fixture"),
    /invalid ICU syntax/,
  );
});

test("typed core messages format ICU and resolve MessageRefs", () => {
  assert.equal(
    t("en", "doctor.adaptersEnabled", { count: 2 }),
    "2 enabled adapter(s) are installed.",
  );
  const reference = msg("doctor.adaptersEnabled", { count: 2 });
  assert.deepEqual(reference, {
    key: "doctor.adaptersEnabled",
    values: { count: 2 },
  });
  assert.equal(resolveMessage("zh-CN", reference), "已安装 2 个已启用适配器。");
  assert.equal(
    resolveMessage("en", {
      key: "adapter.custom.message",
      fallback: "Adapter fallback",
    }),
    "Adapter fallback",
  );
  assert.equal(
    t("zh-CN", "cli.interaction.agent"),
    "当前调用需要交互补全或人工确认。Agent 模式仍可执行已提供完整参数且无需交互确认的命令。",
  );
  assert.equal(
    t("en", "cli.interaction.agent"),
    "This invocation requires interactive completion or human confirmation. Agent mode can still run commands with complete arguments that do not require interaction.",
  );
  assert.equal(
    t("zh-CN", "error.reason.agentInteractionUnsupported"),
    "当前调用需要交互补全或人工确认。Agent 模式仍可执行已提供完整参数且无需交互确认的命令。",
  );
  assert.equal(
    t("zh-CN", "menu.device.addDiscoveryEmpty"),
    "已启用的适配器未能自动发现设备。请手动选择适配器添加。",
  );
});
