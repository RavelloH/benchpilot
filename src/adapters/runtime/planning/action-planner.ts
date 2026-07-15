import {
  evaluateCondition,
  object,
  renderDeep,
  renderTemplate,
  type RuleObject,
} from "../rules/template.js";

export const planActionArguments = (action: RuleObject, context: RuleObject) =>
  (Array.isArray(action.arguments) ? action.arguments : [])
    .filter((item) => evaluateCondition(object(item).when, context))
    .flatMap((item) => {
      const argument = object(item);
      if (argument.kind === "flag") return [argument.flag];
      if (argument.kind === "option")
        return [
          argument.flag,
          String(renderTemplate(argument.value, context) ?? ""),
        ];
      if (argument.kind === "repeat") {
        const values = renderTemplate(argument.values, context);
        const prefix =
          argument.prefix === undefined ? [] : [String(argument.prefix)];
        return Array.isArray(values)
          ? values.flatMap((value) => [...prefix, String(value)])
          : [];
      }
      return [String(renderTemplate(argument.value, context) ?? "")];
    });

export const planActionEnvironment = (
  action: RuleObject,
  context: RuleObject,
) =>
  Object.fromEntries(
    Object.entries(object(action.env)).map(([key, value]) => [
      key,
      renderDeep(value, context),
    ]),
  );
