import {
  planWorkflow as plan,
  planWorkflowStep as planStep,
} from "../../contract/planning.js";
import { renderRequiredDeep, type RuleObject } from "../rules/template.js";

export const planWorkflow = (
  workflow: RuleObject,
  context: RuleObject,
  strict = false,
) => plan(workflow, context, strict, renderRequiredDeep);

export const planWorkflowStep = (
  rawStep: unknown,
  context: RuleObject,
  strict = false,
) => planStep(rawStep, context, strict, renderRequiredDeep);
