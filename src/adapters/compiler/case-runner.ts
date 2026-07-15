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
const render = (value: unknown, context: JsonObject): unknown => {
  if (typeof value !== "string") return value;
  const exact = /^\$\{([^}]+)\}$/.exec(value);
  if (exact) return lookup(context, exact[1]);
  return value.replace(/\$\{([^}]+)\}/g, (_match, path: string) =>
    String(lookup(context, path) ?? ""),
  );
};
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
const sourceText = (source: unknown, stdout: string, stderr: string) =>
  source === "stderr"
    ? stderr
    : source === "both"
      ? `${stdout}\n${stderr}`
      : stdout;
const cast = (value: string, kind: unknown): unknown => {
  if (kind === "integer") return Number.parseInt(value, 10);
  if (kind === "number") return Number(value);
  if (kind === "boolean") return value === "true";
  if (kind === "json") return JSON.parse(value);
  return value;
};
const pointer = (value: unknown, path: string) =>
  path
    .slice(1)
    .split("/")
    .reduce<unknown>(
      (current, part) =>
        object(current)[part.replace(/~1/g, "/").replace(/~0/g, "~")],
      value,
    );

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
              return [arg.flag, String(render(arg.value, context) ?? "")];
            if (arg.kind === "repeat") {
              const values = render(arg.values, context);
              const prefix =
                arg.prefix === undefined ? [] : [String(arg.prefix)];
              return Array.isArray(values)
                ? values.flatMap((value) => [...prefix, String(value)])
                : [];
            }
            return [String(render(arg.value, context) ?? "")];
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
        if (expect.tool !== undefined && expect.tool !== action.tool)
          errors.push(
            diagnostic(
              "ADAPTER_CASE_INVALID",
              "tests/cases.toml",
              `Rendered tool differs for ${target}`,
              undefined,
              adapter.id,
            ),
          );
        if (
          expect.cwd !== undefined &&
          expect.cwd !== render(action.cwd, context)
        )
          errors.push(
            diagnostic(
              "ADAPTER_CASE_INVALID",
              "tests/cases.toml",
              `Rendered cwd differs for ${target}`,
              undefined,
              adapter.id,
            ),
          );
      }
    } else if (test.type === "plan-workflow") {
      const flow = object(object(rules.workflows)[target]);
      const plans = (Array.isArray(flow.steps) ? flow.steps : [])
        .filter((step) => active(object(step).when, context))
        .map((step) => {
          const value = object(step);
          return {
            id: value.id,
            uses: value.uses,
            with: Object.fromEntries(
              Object.entries(object(value.with)).map(([key, item]) => [
                key,
                render(item, context),
              ]),
            ),
            continue_on_error: value.continue_on_error === true,
          };
        });
      const steps =
        Array.isArray(expect.steps) &&
        expect.steps.every((item) => typeof item === "string")
          ? plans.map((plan) => plan.id)
          : plans;
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
        else {
          const stdout =
            typeof test.stdout_fixture === "string"
              ? await readFile(
                  resolve(adapter.root, "tests", test.stdout_fixture),
                  "utf8",
                )
              : "";
          const stderr =
            typeof test.stderr_fixture === "string"
              ? await readFile(
                  resolve(adapter.root, "tests", test.stderr_fixture),
                  "utf8",
                )
              : "";
          const normalized = (value: string) =>
            parser.strip_ansi
              ? value.replace(/\u001B\[[0-?]*[ -\/]*[@-~]/g, "")
              : value;
          const output = normalized(stdout),
            errorOutput = normalized(stderr);
          const matches = (Array.isArray(parser.errors) ? parser.errors : [])
            .map(object)
            .sort(
              (left, right) =>
                Number(right.priority ?? 0) - Number(left.priority ?? 0),
            )
            .find((rule) => {
              const text = sourceText(rule.source, output, errorOutput);
              try {
                return new RegExp(String(rule.pattern)).test(text);
              } catch {
                return false;
              }
            });
          const expectedError = object(expect.error);
          if (
            Object.keys(expectedError).length &&
            (!matches ||
              matches.kind !== expectedError.kind ||
              matches.retryable !== expectedError.retryable)
          )
            errors.push(
              diagnostic(
                "ADAPTER_CASE_INVALID",
                "tests/cases.toml",
                `Parser result differs for ${target}`,
                undefined,
                adapter.id,
              ),
            );
          const result: JsonObject = {};
          for (const rawRule of Array.isArray(parser.extract)
            ? parser.extract
            : []) {
            const rule = object(rawRule);
            let extracted: unknown;
            try {
              if (rule.type === "json-pointer")
                extracted = pointer(
                  JSON.parse(sourceText(rule.source, output, errorOutput)),
                  String(rule.pointer),
                );
              else {
                const match = new RegExp(String(rule.pattern)).exec(
                  sourceText(rule.source, output, errorOutput),
                );
                extracted =
                  match?.groups?.[String(rule.group)] ??
                  match?.[Number(rule.group)];
                if (extracted !== undefined)
                  extracted = cast(String(extracted), rule.cast);
              }
            } catch {
              extracted = undefined;
            }
            if (extracted === undefined && rule.required)
              errors.push(
                diagnostic(
                  "ADAPTER_CASE_INVALID",
                  "tests/cases.toml",
                  `Required extract missing: ${String(rule.id)}`,
                  undefined,
                  adapter.id,
                ),
              );
            if (extracted !== undefined)
              result[String(rule.target)] = extracted;
          }
          const progress = (
            Array.isArray(parser.progress) ? parser.progress : []
          ).flatMap((rawRule) => {
            const rule = object(rawRule);
            const match = new RegExp(String(rule.pattern), "g").exec(
              sourceText(rule.source, output, errorOutput),
            );
            return match
              ? [
                  Object.fromEntries(
                    Object.entries(object(rule.fields)).map(([name, kind]) => [
                      name,
                      cast(match.groups?.[name] ?? "", kind),
                    ]),
                  ),
                ]
              : [];
          });
          if (
            expect.result !== undefined &&
            JSON.stringify(result) !== JSON.stringify(expect.result)
          )
            errors.push(
              diagnostic(
                "ADAPTER_CASE_INVALID",
                "tests/cases.toml",
                `Parser result differs for ${target}`,
                undefined,
                adapter.id,
              ),
            );
          if (
            expect.progress !== undefined &&
            JSON.stringify(progress) !== JSON.stringify(expect.progress)
          )
            errors.push(
              diagnostic(
                "ADAPTER_CASE_INVALID",
                "tests/cases.toml",
                `Parser progress differs for ${target}`,
                undefined,
                adapter.id,
              ),
            );
          if (
            expect.success !== undefined &&
            Boolean(
              !matches &&
              (parser.success_exit_codes as unknown[] | undefined)?.includes(
                test.exit_code,
              ),
            ) !== expect.success
          )
            errors.push(
              diagnostic(
                "ADAPTER_CASE_INVALID",
                "tests/cases.toml",
                `Parser success differs for ${target}`,
                undefined,
                adapter.id,
              ),
            );
        }
      }
    } else if (test.type === "resolve-artifacts") {
      const set = object(object(rules.artifacts)[target]);
      if (!Object.keys(set).length)
        errors.push(
          diagnostic(
            "ADAPTER_CASE_INVALID",
            "tests/cases.toml",
            `Artifact set does not exist: ${target}`,
            undefined,
            adapter.id,
          ),
        );
      const base = String(render(set.base, context) ?? "");
      const plans = (Array.isArray(set.entries) ? set.entries : []).map(
        (entry) => {
          const value = object(entry);
          const relative = value.path ?? value.glob;
          return {
            id: value.id,
            path:
              relative === undefined
                ? undefined
                : `${base}/${String(render(relative, context) ?? "")}`.replace(
                    /\\/g,
                    "/",
                  ),
            required: value.required,
            multiple: value.multiple,
          };
        },
      );
      for (const entry of plans) {
        const path = entry.path;
        if (typeof path === "string" && path.split(/[\\/]/).includes(".."))
          errors.push(
            diagnostic(
              "ADAPTER_CASE_INVALID",
              "tests/cases.toml",
              "Artifact path escapes its base directory",
              undefined,
              adapter.id,
            ),
          );
      }
      if (
        expect.entries !== undefined &&
        JSON.stringify(plans) !== JSON.stringify(expect.entries)
      )
        errors.push(
          diagnostic(
            "ADAPTER_CASE_INVALID",
            "tests/cases.toml",
            `Artifact plan differs for ${target}`,
            undefined,
            adapter.id,
          ),
        );
    } else
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
