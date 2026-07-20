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
});
