import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AdapterDiagnostic, JsonObject, LoadedAdapter } from "./types.js";
import { diagnostic } from "./diagnostics.js";
import { ensureInside } from "./layout.js";
import { mergePlatform } from "./platform-merger.js";

const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const lookup = (context: JsonObject, path: string) =>
  path
    .split(".")
    .reduce<unknown>((value, part) => object(value)[part], context);
const render = (value: unknown, context: JsonObject): unknown =>
  typeof value === "string"
    ? value.replace(/\$\{([^}]+)\}/g, (_match, path: string) =>
        String(lookup(context, path) ?? ""),
      )
    : value;
const active = (when: unknown, context: JsonObject) => {
  if (!when) return true;
  const item = object(when),
    actual = lookup(context, String(item.path));
  switch (item.operator) {
    case "exists":
      return actual !== undefined;
    case "not-exists":
      return actual === undefined;
    case "truthy":
      return Boolean(actual);
    case "falsy":
      return !actual;
    case "equals":
      return actual === item.value;
    case "not-equals":
      return actual !== item.value;
    case "in":
      return Array.isArray(item.value) && item.value.includes(actual);
    case "not-in":
      return Array.isArray(item.value) && !item.value.includes(actual);
    default:
      return false;
  }
};

export const runCases = async (
  adapter: LoadedAdapter,
): Promise<AdapterDiagnostic[]> => {
  const errors: AdapterDiagnostic[] = [];
  const cases = adapter.files["tests/cases.toml"].cases;
  for (const raw of Array.isArray(cases) ? cases : []) {
    const test = object(raw),
      platform = String(test.platform),
      overlay = object(adapter.files[`platforms/${platform}.toml`]?.overrides);
    const base = {
      actions: adapter.files["actions.toml"].actions,
      workflows: adapter.files["workflows.toml"].workflows,
      parsers: adapter.files["parsers.toml"].parsers,
      artifacts: adapter.files["artifacts.toml"].sets,
    };
    const rules = mergePlatform(base, overlay),
      context = object(test.context),
      expect = object(test.expect),
      target = String(test.target);
    if (!/^(windows|linux|macos)$/.test(platform)) {
      errors.push(
        diagnostic(
          "ADAPTER_CASE_INVALID",
          "tests/cases.toml",
          "Case platform is invalid",
          undefined,
          adapter.id,
        ),
      );
      continue;
    }
    if (test.type === "render-action") {
      const action = object(object(rules.actions)[target]);
      if (!Object.keys(action).length)
        errors.push(
          diagnostic(
            "ADAPTER_CASE_INVALID",
            "tests/cases.toml",
            `Action does not exist: ${target}`,
            undefined,
            adapter.id,
          ),
        );
      else {
        const args = (Array.isArray(action.arguments) ? action.arguments : [])
          .filter((item) => active(object(item).when, context))
          .flatMap((item) => {
            const arg = object(item);
            if (arg.kind === "flag") return [arg.flag];
            if (arg.kind === "option")
              return [arg.flag, render(arg.value, context)];
            return [render(arg.value, context)];
          });
        if (JSON.stringify(args) !== JSON.stringify(expect.args))
          errors.push(
            diagnostic(
              "ADAPTER_CASE_INVALID",
              "tests/cases.toml",
              `Rendered arguments differ for ${target}`,
              undefined,
              adapter.id,
            ),
          );
      }
    } else if (test.type === "plan-workflow") {
      const flow = object(object(rules.workflows)[target]);
      const steps = (Array.isArray(flow.steps) ? flow.steps : [])
        .filter((step) => active(object(step).when, context))
        .map((step) => object(step).id);
      if (JSON.stringify(steps) !== JSON.stringify(expect.steps))
        errors.push(
          diagnostic(
            "ADAPTER_CASE_INVALID",
            "tests/cases.toml",
            `Workflow plan differs for ${target}`,
            undefined,
            adapter.id,
          ),
        );
    } else if (test.type === "parse-output") {
      const parser = object(object(rules.parsers)[target]);
      if (!Object.keys(parser).length)
        errors.push(
          diagnostic(
            "ADAPTER_CASE_INVALID",
            "tests/cases.toml",
            `Parser does not exist: ${target}`,
            undefined,
            adapter.id,
          ),
        );
      const fixture = test.stderr_fixture ?? test.stdout_fixture;
      if (typeof fixture === "string") {
        if (
          !fixture.startsWith("fixtures/") ||
          !ensureInside(resolve(adapter.root, "tests"), fixture)
        )
          errors.push(
            diagnostic(
              "ADAPTER_CASE_INVALID",
              "tests/cases.toml",
              "Fixture path escapes tests/fixtures",
              undefined,
              adapter.id,
            ),
          );
        else await readFile(resolve(adapter.root, "tests", fixture), "utf8");
      }
    } else if (test.type !== "resolve-artifacts")
      errors.push(
        diagnostic(
          "ADAPTER_CASE_INVALID",
          "tests/cases.toml",
          `Unsupported case type: ${String(test.type)}`,
          undefined,
          adapter.id,
        ),
      );
  }
  return errors;
};
