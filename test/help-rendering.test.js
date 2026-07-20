import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { commandCatalogDefinition } from "../dist/application/commands/definitions.js";
import { HelpDocumentService } from "../dist/application/commands/help.js";
import { helpOutputDefinition } from "../dist/cli/definitions/help.js";
import { projectHelpDocument } from "../dist/cli/help/projector.js";
import { OutputEngine } from "../dist/cli/output/engine.js";
import { rootMenuChoices } from "../dist/cli/presentation/root-help.js";
import { stripTerminalText } from "../dist/cli/terminal/text.js";

const provider = { values: async () => [] };

const renderRoot = async (locale, color = false) => {
  const document = await new HelpDocumentService(
    commandCatalogDefinition,
    provider,
  ).document([]);
  const data = projectHelpDocument(document, locale);
  const output = [];
  new OutputEngine({
    mode: "screen",
    locale,
    color,
    columns: 80,
    output: { write: (value) => output.push(value) },
  }).render(helpOutputDefinition(data, true));
  return output.join("");
};

test("help screen and machine output consume one projected HelpData", async () => {
  const document = await new HelpDocumentService(
    commandCatalogDefinition,
    provider,
  ).document(["config"]);
  const data = projectHelpDocument(document, "zh-CN");
  const screen = [];
  new OutputEngine({
    mode: "screen",
    locale: "zh-CN",
    color: false,
    columns: 80,
    output: { write: (value) => screen.push(value) },
  }).render(helpOutputDefinition(data, false));
  assert.match(screen.join(""), /查看和管理配置/);
  assert.match(screen.join(""), /说明\n  读取、解释、校验并安全编辑配置。/);
  assert.match(screen.join(""), /config set <key> <value>/);
  assert.match(screen.join(""), /全局选项/);

  const json = [];
  new OutputEngine({
    mode: "json",
    locale: "zh-CN",
    color: false,
    columns: 80,
    output: { write: (value) => json.push(value) },
  }).render(helpOutputDefinition(data, false));
  const result = JSON.parse(json.join(""));
  assert.equal(result.version, 3);
  assert.equal(result.kind, "help");
  assert.deepEqual(result.data, data);
  assert.deepEqual(result.data.summary, {
    key: "command.config.root",
    text: "查看和管理配置",
  });
});

test("complete help renders nested commands in one definition-driven index", async () => {
  const document = await new HelpDocumentService(
    commandCatalogDefinition,
    provider,
  ).document([], { includeDynamicValues: true });
  const data = projectHelpDocument(document, "en");
  const screen = [];
  new OutputEngine({
    mode: "screen",
    locale: "en",
    color: false,
    columns: 80,
    output: { write: (value) => screen.push(value) },
  }).render(helpOutputDefinition(data, false));
  const output = screen.join("");
  assert.match(output, /Commands\n/);
  assert.match(output, /language set <locale>/);
  assert.match(output, /approval <approval> approve/);
  assert.doesNotMatch(output, /\[<approval>\]/);
});

test("root help groups only implemented commands from graph metadata", async () => {
  const document = await new HelpDocumentService(
    commandCatalogDefinition,
    provider,
  ).document([]);
  const data = projectHelpDocument(document, "en");
  const screen = [];
  new OutputEngine({
    mode: "screen",
    locale: "en",
    color: false,
    columns: 80,
    output: { write: (value) => screen.push(value) },
  }).render(helpOutputDefinition(data, false));
  const output = screen.join("");
  assert.match(output, /Get started/);
  assert.match(output, /Environment and integration/);
  assert.match(output, /device/);
  for (const unavailable of ["setup", "alias", "workflow", "skill", "docs"])
    assert.doesNotMatch(output, new RegExp(`^\\s*${unavailable}\\s`, "m"));
});

test("definition-driven root screen preserves the approved golden", async () => {
  for (const locale of ["en", "zh-CN"]) {
    const expected = await readFile(
      new URL(`fixtures/screen/root-help.${locale}.txt`, import.meta.url),
      "utf8",
    );
    assert.equal(await renderRoot(locale), expected);
    const colored = await renderRoot(locale, true);
    assert.match(colored, /\u001B\[/);
    assert.equal(stripTerminalText(colored), expected);
  }
});

test("interactive home consumes the same ordered command collection", async () => {
  const document = await new HelpDocumentService(
    commandCatalogDefinition,
    provider,
  ).document([]);
  const data = projectHelpDocument(document, "en");
  const choices = rootMenuChoices(data, false);
  assert.deepEqual(
    choices.flatMap((choice) => ("value" in choice ? [choice.value] : [])),
    [
      "init",
      "doctor",
      "language",
      "config",
      "adapter",
      "device",
      "system",
      "run",
      "approval",
      "lock",
      "upgrade",
      "help",
      "version",
    ],
  );
  assert.equal(
    choices.find((choice) => choice.value === "init").label,
    "init      Initialize a BenchPilot project in the current directory",
  );
});
