import {
  evaluateCondition,
  object,
  renderDeep,
  type RuleObject,
} from "../rules/template.js";

export const planWorkflow = (workflow: RuleObject, context: RuleObject) =>
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
            renderDeep(item, context),
          ]),
        ),
        continue_on_error: value.continue_on_error === true,
      };
    });
