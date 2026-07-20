import type { PromptChoice, InteractionSession } from "./prompter.js";
import { menuDivider } from "./prompter.js";

export interface ResourceNavigationInput {
  readonly path: readonly string[];
  readonly root: string;
  readonly rootChoices: readonly PromptChoice[];
  readonly resources: () => Promise<readonly PromptChoice[]>;
  readonly actionChoices: (
    resource: string,
  ) => Promise<readonly PromptChoice[]>;
  readonly onStaticAction?: (action: string) => Promise<readonly string[]>;
  readonly interaction: () => InteractionSession;
  readonly color: boolean;
}

/**
 * Navigates a graph branch with static root actions plus dynamic resources.
 * It returns a canonical argv path and leaves execution to the command graph.
 */
export const navigateResourceCommand = async (
  input: ResourceNavigationInput,
): Promise<readonly string[] | undefined> => {
  if (input.path[0] !== input.root) return undefined;
  if (input.path.length > 2) return undefined;
  const records = await input.resources();
  const staticValues = new Set(
    input.rootChoices
      .filter((choice) => "value" in choice)
      .map((choice) => choice.value),
  );
  if (input.path.length === 1) {
    const selected = await input
      .interaction()
      .choose(
        [
          ...input.rootChoices,
          ...(records.length
            ? [{ separator: menuDivider(input.color) }, ...records]
            : []),
        ],
        { commandPath: [input.root], nextBackPath: [input.root] },
      );
    if (staticValues.has(selected))
      return (await input.onStaticAction?.(selected)) ?? [input.root, selected];
    const action = await input
      .interaction()
      .choose(await input.actionChoices(selected), {
        commandPath: [input.root, selected],
      });
    return [input.root, selected, action];
  }
  if (input.path.length !== 2) return undefined;
  const resource = input.path[1]!;
  if (staticValues.has(resource)) return undefined;
  if (!records.some((choice) => "value" in choice && choice.value === resource))
    return undefined;
  const action = await input
    .interaction()
    .choose(await input.actionChoices(resource), {
      commandPath: [input.root, resource],
    });
  return [input.root, resource, action];
};
