import type { MessageRef } from "../../contracts/message-ref.js";
import type { CommandDefinition } from "./definition.js";

export interface CommandInteractionEntry {
  readonly commandId: string;
  readonly value: string;
  readonly summary: MessageRef;
  readonly order: number;
}

/** Read-only interaction projection of the same definitions used by argv and Help. */
export class CommandInteractionService {
  private readonly byId: ReadonlyMap<string, CommandDefinition>;

  constructor(private readonly definitions: readonly CommandDefinition[]) {
    this.byId = new Map(
      definitions.map((definition) => [definition.id, definition]),
    );
  }

  children(
    parentId: string,
    commandIds?: readonly string[],
  ): readonly CommandInteractionEntry[] {
    const parent = this.byId.get(parentId);
    if (!parent) throw new Error(`Unknown interaction parent: ${parentId}`);
    const included = commandIds ? new Set(commandIds) : undefined;
    const entries = this.definitions.flatMap((definition) => {
      if (
        definition.parentId !== parentId ||
        !definition.interactionMenu ||
        (included && !included.has(definition.id))
      )
        return [];
      const segment = definition.path[parent.path.length];
      if (segment?.kind !== "literal")
        throw new Error(
          `Interaction command ${definition.id} does not have a literal menu segment.`,
        );
      return [
        {
          commandId: definition.id,
          value: segment.value,
          summary: definition.interactionMenu.summary,
          order: definition.interactionMenu.order,
        },
      ];
    });
    if (included && entries.length !== included.size) {
      const found = new Set(entries.map((entry) => entry.commandId));
      const missing = [...included].filter((id) => !found.has(id));
      throw new Error(`Unknown interaction commands: ${missing.join(", ")}`);
    }
    return entries.sort(
      (left, right) =>
        left.order - right.order || left.value.localeCompare(right.value),
    );
  }
}
