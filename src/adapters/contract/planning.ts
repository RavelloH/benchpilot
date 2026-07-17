import {
  evaluateCondition,
  object,
  renderDeep,
  renderTemplate,
  type RuleObject,
} from "./template.js";

export type RequiredRenderer = (
  value: unknown,
  context: RuleObject,
  field: string,
) => unknown;

const optionalRequired: RequiredRenderer = (value, context) =>
  renderTemplate(value, context);

/** Pure action planning; callers choose required-value error behavior. */
export const planActionArguments = (
  action: RuleObject,
  context: RuleObject,
  required: RequiredRenderer = optionalRequired,
) =>
  (Array.isArray(action.arguments) ? action.arguments : [])
    .filter((item) => evaluateCondition(object(item).when, context))
    .flatMap((item) => {
      const argument = object(item);
      if (argument.kind === "flag") return [argument.flag];
      if (argument.kind === "option")
        return [
          argument.flag,
          String(required(argument.value, context, "argument") ?? ""),
        ];
      if (argument.kind === "repeat") {
        const values = required(argument.values, context, "argument");
        const prefix =
          argument.prefix === undefined ? [] : [String(argument.prefix)];
        return Array.isArray(values)
          ? values.flatMap((value) => [...prefix, String(value)])
          : [];
      }
      return [String(required(argument.value, context, "argument") ?? "")];
    });

export const planActionEnvironment = (
  action: RuleObject,
  context: RuleObject,
  requiredDeep: RequiredRenderer = optionalRequired,
) =>
  Object.fromEntries(
    Object.entries(object(action.env)).map(([key, value]) => [
      key,
      requiredDeep(value, context, "environment"),
    ]),
  );

export const planWorkflow = (
  workflow: RuleObject,
  context: RuleObject,
  strict = false,
  requiredDeep: RequiredRenderer = optionalRequired,
) =>
  (Array.isArray(workflow.steps) ? workflow.steps : [])
    .filter((step) => evaluateCondition(object(step).when, context))
    .map((step) => {
      const value = object(step);
      return {
        id: value.id,
        uses: value.uses,
        with: Object.fromEntries(
          Object.entries(object(value.with)).map(([key, item]) => [
            key,
            strict
              ? requiredDeep(item, context, "workflow input")
              : renderDeep(item, context),
          ]),
        ),
        continue_on_error: value.continue_on_error === true,
      };
    });

export const planWorkflowStep = (
  rawStep: unknown,
  context: RuleObject,
  strict = false,
  requiredDeep: RequiredRenderer = optionalRequired,
) => {
  const value = object(rawStep);
  if (!evaluateCondition(value.when, context)) return undefined;
  return {
    id: value.id,
    uses: value.uses,
    with: Object.fromEntries(
      Object.entries(object(value.with)).map(([key, item]) => [
        key,
        strict
          ? requiredDeep(item, context, "workflow input")
          : renderDeep(item, context),
      ]),
    ),
    continue_on_error: value.continue_on_error === true,
  };
};
