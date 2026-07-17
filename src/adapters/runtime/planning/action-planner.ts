import {
  planActionArguments as planArguments,
  planActionEnvironment as planEnvironment,
} from "../../contract/planning.js";
import {
  renderRequiredDeep,
  renderRequiredTemplate,
  type RuleObject,
} from "../rules/template.js";

export const planActionArguments = (action: RuleObject, context: RuleObject) =>
  planArguments(action, context, renderRequiredTemplate);

export const planActionEnvironment = (
  action: RuleObject,
  context: RuleObject,
) => planEnvironment(action, context, renderRequiredDeep);
