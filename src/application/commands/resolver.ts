import type {
  CommandDefinition,
  CommandFieldDefinition,
  CommandSegment,
  DynamicCommandProvider,
  DynamicCommandValue,
} from "./definition.js";

export type CommandResolutionErrorCode =
  "UNKNOWN_COMMAND" | "AMBIGUOUS_COMMAND" | "COMMAND_UNAVAILABLE";

export class CommandResolutionError extends Error {
  constructor(
    readonly code: CommandResolutionErrorCode,
    readonly path: readonly string[],
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`${code}: ${path.join(" ")}`);
    this.name = "CommandResolutionError";
  }
}

export interface ResolvedCommand {
  readonly definition: CommandDefinition;
  readonly path: readonly string[];
  readonly captures: Readonly<Record<string, string | readonly string[]>>;
  readonly dynamic: Readonly<Record<string, DynamicCommandValue>>;
  readonly executable: boolean;
}

const segmentPriority = (segment: CommandSegment) =>
  segment.kind === "literal"
    ? 4
    : segment.kind === "dynamic-resource"
      ? 3
      : segment.kind === "dynamic-capability"
        ? 2
        : 1;

const comparePriority = (
  left: readonly CommandSegment[],
  right: readonly CommandSegment[],
) => {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference =
      (right[index] ? segmentPriority(right[index]!) : 0) -
      (left[index] ? segmentPriority(left[index]!) : 0);
    if (difference) return difference;
  }
  return right.length - left.length;
};

const samePriority = (
  left: readonly CommandSegment[],
  right: readonly CommandSegment[],
) => comparePriority(left, right) === 0 && comparePriority(right, left) === 0;

const argumentFor = (
  definition: CommandDefinition,
  segment: CommandSegment,
): CommandFieldDefinition | undefined =>
  segment.kind === "argument"
    ? definition.arguments.find((field) => field.name === segment.name)
    : undefined;

const applyDynamicMetadata = (
  definition: CommandDefinition,
  segment: CommandSegment | undefined,
  value: DynamicCommandValue | undefined,
): CommandDefinition => {
  if (
    !value ||
    !segment ||
    segment.kind === "literal" ||
    segment.kind === "argument"
  )
    return definition;
  return {
    ...definition,
    ...(value.summary ? { summary: value.summary } : {}),
    ...(value.arguments ? { arguments: value.arguments } : {}),
    ...(value.options ? { options: value.options } : {}),
    ...(value.output ? { output: value.output } : {}),
    ...(value.safety ? { safety: value.safety } : {}),
    ...(value.operation ? { operation: value.operation } : {}),
    ...(value.availability ? { availability: value.availability } : {}),
  };
};

/** Resolves a canonical command without performing any command side effects. */
export class CommandResolver {
  constructor(
    private readonly definitions: readonly CommandDefinition[],
    private readonly provider: DynamicCommandProvider,
  ) {}

  async resolve(
    path: readonly string[],
    options: { allowIncompleteArguments?: boolean } = {},
  ): Promise<ResolvedCommand> {
    const candidates = this.definitions
      .filter((definition) => {
        const root = definition.path[0];
        return root?.kind === "literal" && root.value === path[0];
      })
      .sort((left, right) => comparePriority(left.path, right.path));
    const cache = new Map<string, readonly DynamicCommandValue[]>();
    for (let index = 0; index < candidates.length;) {
      const priority = candidates[index]!.path;
      const tier: CommandDefinition[] = [];
      while (
        index < candidates.length &&
        samePriority(priority, candidates[index]!.path)
      )
        tier.push(candidates[index++]!);
      const matches = (
        await Promise.all(
          tier.map((definition) =>
            this.match(
              definition,
              path,
              cache,
              options.allowIncompleteArguments === true,
            ),
          ),
        )
      ).filter((match): match is ResolvedCommand => match !== undefined);
      if (matches.length > 1)
        throw new CommandResolutionError("AMBIGUOUS_COMMAND", path, {
          commandIds: matches.map((match) => match.definition.id),
        });
      if (matches.length === 1) {
        const match = matches[0]!;
        if (match.definition.availability === "unavailable")
          throw new CommandResolutionError("COMMAND_UNAVAILABLE", path, {
            commandId: match.definition.id,
            dynamic: match.dynamic,
          });
        return match;
      }
    }
    throw new CommandResolutionError("UNKNOWN_COMMAND", path);
  }

  private async match(
    definition: CommandDefinition,
    path: readonly string[],
    cache: Map<string, readonly DynamicCommandValue[]>,
    allowIncompleteArguments: boolean,
  ): Promise<ResolvedCommand | undefined> {
    const captures: Record<string, string | readonly string[]> = {};
    const dynamic: Record<string, DynamicCommandValue> = {};
    let inputIndex = 0;
    let finalDynamic: DynamicCommandValue | undefined;
    for (const segment of definition.path) {
      const token = path[inputIndex];
      if (segment.kind === "literal") {
        if (token !== segment.value) return undefined;
        inputIndex += 1;
        finalDynamic = undefined;
        continue;
      }
      if (segment.kind === "argument") {
        const field = argumentFor(definition, segment);
        if (field?.variadic) {
          const remaining = path.slice(inputIndex);
          if (field.required && !remaining.length) return undefined;
          captures[segment.name] = remaining;
          inputIndex = path.length;
          finalDynamic = undefined;
          continue;
        }
        if (token === undefined) {
          if (field?.required && !allowIncompleteArguments) return undefined;
          captures[segment.name] = [];
          finalDynamic = undefined;
          continue;
        }
        captures[segment.name] = token;
        inputIndex += 1;
        finalDynamic = undefined;
        continue;
      }
      if (token === undefined) return undefined;
      const cacheKey = `${segment.provider}\0${JSON.stringify(captures)}`;
      let values = cache.get(cacheKey);
      if (!values) {
        values = await this.provider.values({
          provider: segment.provider,
          captures,
          definition,
        });
        cache.set(cacheKey, values);
      }
      const value = values.find((candidate) => candidate.value === token);
      if (!value) return undefined;
      captures[segment.name] = token;
      dynamic[segment.name] = value;
      finalDynamic = value;
      inputIndex += 1;
    }
    if (inputIndex !== path.length) return undefined;
    const resolvedDefinition = applyDynamicMetadata(
      definition,
      definition.path.at(-1),
      finalDynamic,
    );
    const unavailable = Object.values(dynamic).find(
      (value) => value.availability === "unavailable",
    );
    return {
      definition: unavailable
        ? { ...resolvedDefinition, availability: "unavailable" }
        : resolvedDefinition,
      path: [...path],
      captures,
      dynamic,
      executable: definition.handler !== undefined,
    };
  }
}
