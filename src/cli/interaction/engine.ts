import type {
  CommandFieldDefinition,
  CommandInteractionStepDefinition,
} from "../../application/commands/definition.js";
import type { ParsedCommand } from "../../application/commands/parser.js";
import { isLocale, resolveMessage, type Locale } from "../../i18n/index.js";
import type { PromptChoice } from "./prompter.js";
import { InteractionSession } from "./prompter.js";

export interface InteractionChoiceContext {
  readonly parsed: ParsedCommand;
  readonly field?: CommandFieldDefinition;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface InteractionChoices {
  readonly choices: readonly PromptChoice[];
  readonly multiple?: boolean;
  readonly prompt?: string;
  readonly serialize?: "json";
}

export type InteractionChoiceProvider = (
  context: InteractionChoiceContext,
) =>
  | Promise<readonly PromptChoice[] | InteractionChoices | undefined>
  | readonly PromptChoice[]
  | InteractionChoices
  | undefined;

export interface InteractionCompletion {
  readonly path: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
}

const fieldByName = (parsed: ParsedCommand, name: string) =>
  [
    ...parsed.resolved.definition.arguments,
    ...parsed.resolved.definition.options,
  ].find((field) => field.name === name);

const normalizedChoices = (
  result: readonly PromptChoice[] | InteractionChoices | undefined,
): InteractionChoices | undefined => {
  if (!result) return undefined;
  return "choices" in result ? result : { choices: result };
};

/** Completes missing fields from declarative recipes and field metadata. */
export class InteractionEngine {
  constructor(
    private readonly session: InteractionSession,
    private locale: Locale,
    private readonly providers: Readonly<
      Record<string, InteractionChoiceProvider>
    > = {},
  ) {}

  async complete(parsed: ParsedCommand): Promise<InteractionCompletion> {
    const path = [...parsed.intent.path];
    const values: Record<string, unknown> = {
      ...parsed.intent.globals,
      ...parsed.intent.options,
      ...parsed.intent.input,
    };
    const recipe = parsed.resolved.definition.interactionRecipe;
    const completed = new Set<string>();
    const steps: readonly CommandInteractionStepDefinition[] = [
      ...(recipe?.steps ?? []),
      ...parsed.missingFields.map((field) => ({ field })),
    ];
    for (const step of steps) {
      if (
        step.whenOption &&
        values[step.whenOption.name] !== (step.whenOption.equals ?? true)
      )
        continue;
      if (step.oneOf?.length) {
        if (step.oneOf.some((name) => values[name] === true)) continue;
        const choiceSet = step.choices
          ? normalizedChoices(
              await this.providers[step.choices]?.({ parsed, values }),
            )
          : undefined;
        if (!choiceSet?.choices.length)
          throw new Error("Interaction option group requires choices.");
        const selected = await this.session.choose(choiceSet.choices, {
          commandPath: path,
        });
        if (!step.oneOf.includes(selected))
          throw new Error(`Invalid interaction option: ${selected}`);
        values[selected] = true;
        continue;
      }
      const name = step.field;
      const selectedOptionNeedsValue =
        step.collect === "absent" &&
        step.whenOption?.name === name &&
        values[name!] === true;
      const shouldCollect =
        Boolean(name) &&
        (parsed.missingFields.includes(name!) ||
          (step.collect === "absent" &&
            (values[name!] === undefined || selectedOptionNeedsValue)));
      if (!name || completed.has(name) || !shouldCollect) continue;
      completed.add(name);
      const field = fieldByName(parsed, name);
      if (!field) throw new Error(`Unknown interaction field: ${name}`);
      const choiceSet: InteractionChoices | undefined = step.choices
        ? normalizedChoices(
            await this.providers[step.choices]?.({ parsed, field, values }),
          )
        : field.enum?.length
          ? { choices: field.enum.map((value) => ({ value })) }
          : undefined;
      let value: unknown;
      if (choiceSet?.multiple) {
        const selected = choiceSet.choices.length
          ? await this.session.chooseMany(
              choiceSet.prompt ?? resolveMessage(this.locale, field.summary),
              choiceSet.choices,
            )
          : [];
        value =
          choiceSet.serialize === "json" ? JSON.stringify(selected) : selected;
      } else if (choiceSet?.choices.length)
        value = await this.session.choose(choiceSet.choices, {
          commandPath: path,
        });
      else if (field.value === "boolean")
        value = await this.session.confirm(
          resolveMessage(this.locale, field.summary),
        );
      else
        value = await this.session.value(
          resolveMessage(this.locale, field.summary),
        );

      if (field.kind === "option") values[field.name] = value;
      else {
        const segment = parsed.resolved.definition.path.findIndex(
          (candidate) =>
            candidate.kind === "argument" && candidate.name === field.name,
        );
        if (segment < 0)
          throw new Error(
            `Argument ${field.name} has no command path segment.`,
          );
        if (field.variadic && Array.isArray(value))
          path.splice(segment, 0, ...value);
        else path[segment] = String(value);
        values[field.name] = value;
      }
      if (step.updatesLocale && typeof value === "string" && isLocale(value)) {
        this.locale = value;
        this.session.setLocale(value);
      }
    }
    const returnedFields = new Set([
      ...parsed.resolved.definition.options.map((field) => field.name),
      ...Object.keys(parsed.intent.globals),
    ]);
    return {
      path,
      values: Object.fromEntries(
        Object.entries(values).filter(([name]) => returnedFields.has(name)),
      ),
    };
  }
}
