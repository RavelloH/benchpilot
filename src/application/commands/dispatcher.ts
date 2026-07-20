import type {
  CommandHandler,
  CommandIntent,
  CommandOutcome,
} from "./contracts.js";

export type CommandDispatchErrorCode =
  | "COMMAND_NOT_EXECUTABLE"
  | "HANDLER_NOT_REGISTERED"
  | "HANDLER_ALREADY_REGISTERED";

export class CommandDispatchError extends Error {
  constructor(
    readonly code: CommandDispatchErrorCode,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`${code}: ${JSON.stringify(details)}`);
    this.name = "CommandDispatchError";
  }
}

/** Stable handler registry; CLI routing never switches on command-specific data. */
export class CommandDispatcher {
  private readonly handlers = new Map<string, CommandHandler>();

  constructor(handlers: Readonly<Record<string, CommandHandler>> = {}) {
    for (const [id, handler] of Object.entries(handlers))
      this.register(id, handler);
  }

  register(id: string, handler: CommandHandler) {
    if (this.handlers.has(id))
      throw new CommandDispatchError("HANDLER_ALREADY_REGISTERED", {
        handlerId: id,
      });
    this.handlers.set(id, handler);
    return this;
  }

  async dispatch(intent: CommandIntent): Promise<CommandOutcome> {
    if (!intent.handlerId)
      throw new CommandDispatchError("COMMAND_NOT_EXECUTABLE", {
        commandId: intent.commandId,
      });
    const handler = this.handlers.get(intent.handlerId);
    if (!handler)
      throw new CommandDispatchError("HANDLER_NOT_REGISTERED", {
        commandId: intent.commandId,
        handlerId: intent.handlerId,
      });
    const outcome = await handler(intent);
    if (outcome.commandId !== intent.commandId)
      throw new CommandDispatchError("HANDLER_NOT_REGISTERED", {
        commandId: intent.commandId,
        handlerId: intent.handlerId,
        outcomeCommandId: outcome.commandId,
      });
    return outcome;
  }
}
