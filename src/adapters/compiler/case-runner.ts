import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AdapterDiagnostic, LoadedAdapter } from "./types.js";
import { diagnostic } from "./diagnostics.js";
import { ensureInside } from "./layout.js";
import { mergePlatform } from "./platform-merger.js";
import {
  planActionArguments,
  planActionEnvironment,
} from "../runtime/planning/action-planner.js";
import { planWorkflow } from "../runtime/planning/workflow-planner.js";
import { planArtifacts } from "../runtime/rules/artifacts.js";
import { parseOutput } from "../runtime/rules/parser.js";
import { object, renderTemplate } from "../runtime/rules/template.js";

export const runCases = async (
  adapter: LoadedAdapter,
): Promise<AdapterDiagnostic[]> => {
  const errors: AdapterDiagnostic[] = [];
  const caseFile = adapter.files["tests/cases.toml"];
  if (!caseFile || !Array.isArray(caseFile.cases))
    return [
      diagnostic(
        "ADAPTER_CASE_INVALID",
        "tests/cases.toml",
        "Cases file is missing or invalid",
        undefined,
        adapter.id,
      ),
    ];
  const cases = caseFile.cases;
  for (const raw of Array.isArray(cases) ? cases : []) {
    const test = object(raw),
      platform = String(test.platform),
      overlay = object(adapter.files[`platforms/${platform}.toml`]?.overrides);
    const base = {
      actions: adapter.files["actions.toml"]?.actions ?? {},
      workflows: adapter.files["workflows.toml"]?.workflows ?? {},
      parsers: adapter.files["parsers.toml"]?.parsers ?? {},
      artifacts: adapter.files["artifacts.toml"]?.sets ?? {},
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
        const args = planActionArguments(action, context);
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
          expect.cwd !== renderTemplate(action.cwd, context)
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
        const environment = planActionEnvironment(action, context);
        if (
          expect.environment !== undefined &&
          JSON.stringify(environment) !== JSON.stringify(expect.environment)
        )
          errors.push(
            diagnostic(
              "ADAPTER_CASE_INVALID",
              "tests/cases.toml",
              `Rendered environment differs for ${target}`,
              undefined,
              adapter.id,
            ),
          );
      }
    } else if (test.type === "plan-workflow") {
      const flow = object(object(rules.workflows)[target]);
      const plans = planWorkflow(flow, context);
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
      const fixtures = [test.stdout_fixture, test.stderr_fixture].filter(
        (fixture): fixture is string => typeof fixture === "string",
      );
      if (
        !fixtures.length ||
        fixtures.some(
          (fixture) =>
            !fixture.startsWith("fixtures/") ||
            !ensureInside(resolve(adapter.root, "tests"), fixture),
        )
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
        let stdout = "";
        let stderr = "";
        try {
          stdout =
            typeof test.stdout_fixture === "string"
              ? await readFile(
                  resolve(adapter.root, "tests", test.stdout_fixture),
                  "utf8",
                )
              : "";
          stderr =
            typeof test.stderr_fixture === "string"
              ? await readFile(
                  resolve(adapter.root, "tests", test.stderr_fixture),
                  "utf8",
                )
              : "";
        } catch {
          errors.push(
            diagnostic(
              "ADAPTER_CASE_INVALID",
              "tests/cases.toml",
              "Fixture file does not exist",
              undefined,
              adapter.id,
            ),
          );
          continue;
        }
        const parsed = parseOutput(parser, stdout, stderr, test.exit_code);
        const expectedError = object(expect.error);
        if (
          Object.keys(expectedError).length &&
          (!parsed.error ||
            parsed.error.kind !== expectedError.kind ||
            parsed.error.retryable !== expectedError.retryable)
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
        for (const id of parsed.requiredMissing)
          errors.push(
            diagnostic(
              "ADAPTER_CASE_INVALID",
              "tests/cases.toml",
              `Required extract missing: ${id}`,
              undefined,
              adapter.id,
            ),
          );
        if (
          expect.result !== undefined &&
          JSON.stringify(parsed.result) !== JSON.stringify(expect.result)
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
          JSON.stringify(parsed.progress) !== JSON.stringify(expect.progress)
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
        if (expect.success !== undefined && parsed.success !== expect.success)
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
      const { plans, unsafe } = planArtifacts(set, context);
      if (unsafe)
        errors.push(
          diagnostic(
            "ADAPTER_CASE_INVALID",
            "tests/cases.toml",
            "Artifact path escapes its base directory",
            undefined,
            adapter.id,
          ),
        );
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
