import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import YAML from "yaml";
import { format, resolveConfig } from "prettier";
import { messageArguments, sameMessageArguments } from "./i18n-contracts.mjs";

const root = process.cwd();
const localesRoot = path.join(root, "src", "i18n", "locales");
const output = path.join(root, "src", "i18n", "catalogs.generated.ts");

const fail = (message) => {
  throw new Error(`i18n: ${message}`);
};

const flatten = (value, prefix = "") => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${prefix || "catalog"} must be a mapping.`);
  return Object.entries(value).reduce((catalog, [key, child]) => {
    if (key.includes("."))
      fail(
        `${prefix ? `${prefix}.` : ""}${key} must use nested YAML mappings, not a dotted key.`,
      );
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      if (!child.trim()) fail(`${name} must not be blank.`);
      catalog[name] = child;
      return catalog;
    }
    Object.assign(catalog, flatten(child, name));
    return catalog;
  }, {});
};

const localeFiles = (await readdir(localesRoot))
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();
if (!localeFiles.includes("en.yml"))
  fail("src/i18n/locales/en.yml is required.");

const catalogs = Object.fromEntries(
  await Promise.all(
    localeFiles.map(async (file) => {
      const locale = path.basename(file, path.extname(file));
      const source = await readFile(path.join(localesRoot, file), "utf8");
      return [locale, flatten(YAML.parse(source))];
    }),
  ),
);
const english = catalogs.en;
const keys = Object.keys(english).sort();
if (!keys.length) fail("English catalog must not be empty.");
const contracts = Object.fromEntries(
  Object.entries(catalogs).map(([locale, catalog]) => [
    locale,
    Object.fromEntries(
      Object.entries(catalog).map(([key, message]) => [
        key,
        messageArguments(message, `${locale}.${key}`),
      ]),
    ),
  ]),
);

for (const [locale, catalog] of Object.entries(catalogs)) {
  const actual = Object.keys(catalog).sort();
  const missing = keys.filter((key) => !actual.includes(key));
  const extra = actual.filter((key) => !keys.includes(key));
  if (missing.length || extra.length)
    fail(
      `${locale} catalog differs from en.yml: ${[
        missing.length ? `missing ${missing.join(", ")}` : "",
        extra.length ? `extra ${extra.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ")}.`,
    );
  if (locale !== "en")
    for (const key of keys)
      if (catalog[key] === english[key])
        fail(`${locale}.${key} is identical to the English source.`);
      else if (!sameMessageArguments(contracts[locale][key], contracts.en[key]))
        fail(`${locale}.${key} does not preserve English ICU arguments.`);
}

const sourceFiles = [];
const collectSources = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectSources(file);
    else if (entry.isFile() && entry.name.endsWith(".ts") && file !== output)
      sourceFiles.push(file);
  }
};
await collectSources(path.join(root, "src"));

const used = new Set();
const definitionMessageProperties = new Set([
  "category",
  "description",
  "empty",
  "label",
  "message",
  "name",
  "prompt",
  "reason",
  "recovery",
  "summary",
  "title",
]);
const literalText = (node) =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
const propertyName = (node) => {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return undefined;
};
const typeMentionsMessageKey = (node) =>
  node &&
  (/\bMessageKey\b/.test(node.getText()) ||
    /Parameters\s*<\s*typeof\s+t\s*>\s*\[\s*1\s*\]/.test(node.getText()));
const collectCatalogLiterals = (node) => {
  if (!node) return;
  const key = literalText(node);
  if (key && keys.includes(key)) used.add(key);
  ts.forEachChild(node, collectCatalogLiterals);
};

for (const file of sourceFiles) {
  const source = ts.createSourceFile(
    file,
    await readFile(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : undefined;
      const index =
        name === "t"
          ? 1
          : name === "msg" || name === "messageRef"
            ? 0
            : name === "argument" || name === "option"
              ? 1
              : undefined;
      if (index !== undefined) collectCatalogLiterals(node.arguments[index]);
      if (name === "defineError") {
        collectCatalogLiterals(node.arguments[1]);
        collectCatalogLiterals(node.arguments[2]);
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (
        name &&
        (name.endsWith("Key") || definitionMessageProperties.has(name))
      )
        collectCatalogLiterals(node.initializer);
    }
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      typeMentionsMessageKey(node.type)
    )
      for (const child of node.initializer ? [node.initializer] : [])
        collectCatalogLiterals(child);
    if (ts.isSatisfiesExpression(node) && typeMentionsMessageKey(node.type)) {
      collectCatalogLiterals(node.expression);
    }
    if (
      ts.isFunctionLike(node) &&
      typeMentionsMessageKey(node.type) &&
      node.body
    ) {
      collectCatalogLiterals(node.body);
    }
    if (ts.isLiteralTypeNode(node)) collectCatalogLiterals(node.literal);
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const unused = keys.filter((key) => !used.has(key));
if (unused.length) fail(`unused message keys: ${unused.join(", ")}.`);

const ordered = Object.fromEntries(
  Object.entries(catalogs).map(([locale, catalog]) => [
    locale,
    Object.fromEntries(keys.map((key) => [key, catalog[key]])),
  ]),
);
const valuesEntries = keys
  .filter((key) => Object.keys(contracts.en[key]).length)
  .map(
    (key) =>
      `  readonly ${JSON.stringify(key)}: { ${Object.entries(contracts.en[key])
        .map(([name, type]) => `readonly ${JSON.stringify(name)}: ${type}`)
        .join("; ")} };`,
  )
  .join("\n");
const generated = `// Generated by scripts/generate-i18n.mjs. Do not edit manually.\nexport const catalogs = ${JSON.stringify(ordered, null, 2)} as const;\n\nexport type Locale = keyof typeof catalogs;\nexport type MessageKey = keyof typeof catalogs.en;\n\nexport interface MessageValuesByKey {\n${valuesEntries}\n}\n\nexport type MessageKeyWithValues = keyof MessageValuesByKey;\nexport type MessageValuesFor<Key extends MessageKey> = Key extends MessageKeyWithValues\n  ? MessageValuesByKey[Key]\n  : Record<never, never>;\nexport type MessageArgumentsFor<Key extends MessageKey> = MessageKey extends Key\n  ? [values?: Record<string, string | number | boolean | undefined>]\n  : Key extends MessageKeyWithValues\n    ? [values: MessageValuesFor<NoInfer<Key>>]\n    : [values?: undefined];\n`;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  await format(generated, {
    ...(await resolveConfig(output)),
    filepath: output,
  }),
);
