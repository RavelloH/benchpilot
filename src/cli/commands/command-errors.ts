import { CommandParseError } from "../../application/commands/parser.js";
import { CommandResolutionError } from "../../application/commands/resolver.js";
import { BenchPilotError } from "../../core.js";

export const commandContractError = (
  error: unknown,
  path: readonly string[],
): unknown => {
  if (error instanceof CommandParseError)
    return new BenchPilotError(
      "USAGE_ERROR",
      2,
      error.message,
      false,
      undefined,
      [],
      { helpPath: path, parse: error.code, ...error.details },
    );
  if (error instanceof CommandResolutionError)
    return new BenchPilotError(
      error.code === "COMMAND_UNAVAILABLE"
        ? "COMMAND_UNAVAILABLE"
        : path.length > 1
          ? "USAGE_ERROR"
          : "UNKNOWN_COMMAND",
      error.code === "COMMAND_UNAVAILABLE" ? 3 : 2,
      error.message,
      false,
      undefined,
      [],
      { helpPath: path, resolution: error.code, ...error.details },
    );
  return error;
};
