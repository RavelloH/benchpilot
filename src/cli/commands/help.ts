export interface HelpCommandHandlerInput {
  readonly path: readonly string[];
  readonly helpRequested: boolean;
  readonly includeAll: boolean;
  readonly render: (
    target: readonly string[],
    includeAll?: boolean,
  ) => Promise<void>;
}

/** Resolves root, explicit, and global help through one document renderer. */
export const handleHelpCommand = async (input: HelpCommandHandlerInput) => {
  if (input.path[0] === "help") {
    if (input.helpRequested && input.path.length === 1)
      await input.render(["help"]);
    else await input.render(input.path.slice(1), input.includeAll);
    return true;
  }
  if (input.helpRequested) {
    await input.render(input.path);
    return true;
  }
  if (!input.path.length) {
    await input.render([]);
    return true;
  }
  return false;
};
