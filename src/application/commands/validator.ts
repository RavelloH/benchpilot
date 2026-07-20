import type { CommandDefinition } from "./definition.js";
import { commandPathKey } from "./definition.js";

export interface CommandGraphDiagnostic {
  readonly code: string;
  readonly commandId?: string;
  readonly message: string;
}

export class CommandGraphValidationError extends Error {
  constructor(readonly diagnostics: readonly CommandGraphDiagnostic[]) {
    super(
      `Command graph is invalid:\n${diagnostics
        .map((diagnostic) => `- ${diagnostic.code}: ${diagnostic.message}`)
        .join("\n")}`,
    );
    this.name = "CommandGraphValidationError";
  }
}

export function validateCommandGraph(
  definitions: readonly CommandDefinition[],
  options: { messageExists?: (key: string) => boolean } = {},
) {
  const diagnostics: CommandGraphDiagnostic[] = [];
  const report = (code: string, message: string, commandId?: string) =>
    diagnostics.push({ code, message, ...(commandId ? { commandId } : {}) });
  const byId = new Map<string, CommandDefinition>();
  const byPath = new Map<string, CommandDefinition>();
  const commandNames = new Map<string, string>();
  for (const definition of definitions) {
    if (byId.has(definition.id))
      report(
        "DUPLICATE_ID",
        `Duplicate command id ${definition.id}.`,
        definition.id,
      );
    else byId.set(definition.id, definition);
    const path = commandPathKey(definition.path);
    if (byPath.has(path))
      report(
        "DUPLICATE_PATH",
        `Duplicate canonical path ${path}.`,
        definition.id,
      );
    else byPath.set(path, definition);
    if (!definition.path.length)
      report("EMPTY_PATH", "Command path must not be empty.", definition.id);
    const argumentsByPosition = [...definition.arguments].sort(
      (left, right) => (left.position ?? 0) - (right.position ?? 0),
    );
    let optionalSeen = false;
    const positions = new Set<number>();
    for (const [index, field] of argumentsByPosition.entries()) {
      if (field.kind !== "argument")
        report(
          "FIELD_KIND",
          `${field.name} is not an argument.`,
          definition.id,
        );
      if (!field.required) optionalSeen = true;
      else if (optionalSeen)
        report(
          "POSITIONAL_ORDER",
          `Required argument ${field.name} follows an optional argument.`,
          definition.id,
        );
      const position = field.position ?? index;
      if (positions.has(position))
        report(
          "POSITIONAL_CONFLICT",
          `Argument position ${position} is declared more than once.`,
          definition.id,
        );
      positions.add(position);
      if (field.variadic && index !== argumentsByPosition.length - 1)
        report(
          "VARIADIC_ORDER",
          `Variadic argument ${field.name} must be last.`,
          definition.id,
        );
    }
    const finalSegment = definition.path.at(-1);
    if (finalSegment?.kind === "literal")
      for (const name of [finalSegment.value, ...(definition.aliases ?? [])]) {
        const scoped = `${definition.parentId ?? "<root>"}\0${name}`;
        const owner = commandNames.get(scoped);
        if (owner)
          report(
            "ALIAS_CONFLICT",
            `Command name or alias ${name} conflicts with ${owner}.`,
            definition.id,
          );
        else commandNames.set(scoped, definition.id);
      }
    const optionNames = new Set<string>();
    for (const field of definition.options) {
      if (field.kind !== "option")
        report("FIELD_KIND", `${field.name} is not an option.`, definition.id);
      for (const name of [field.name, ...(field.aliases ?? [])]) {
        if (optionNames.has(name))
          report(
            "OPTION_CONFLICT",
            `Option name ${name} conflicts.`,
            definition.id,
          );
        optionNames.add(name);
      }
    }
    if (definition.safety?.flag && optionNames.has(definition.safety.flag))
      report(
        "SAFETY_OPTION_CONFLICT",
        `Safety flag ${definition.safety.flag} conflicts with an option.`,
        definition.id,
      );
    if (definition.handler && !definition.output)
      report(
        "OUTPUT_REQUIRED",
        "Executable command requires output.",
        definition.id,
      );
    for (const step of definition.interactionRecipe?.steps ?? []) {
      if (Boolean(step.field) === Boolean(step.oneOf?.length)) {
        report(
          "INTERACTION_STEP_INVALID",
          "Interaction steps must declare exactly one field or oneOf group.",
          definition.id,
        );
        continue;
      }
      const fields = [...definition.arguments, ...definition.options];
      const names = step.field ? [step.field] : (step.oneOf ?? []);
      for (const name of names)
        if (!fields.some((field) => field.name === name))
          report(
            step.field
              ? "INTERACTION_FIELD_NOT_FOUND"
              : "INTERACTION_OPTION_NOT_FOUND",
            `Interaction field ${name} is not declared by the command.`,
            definition.id,
          );
      if (
        step.whenOption &&
        !definition.options.some(
          (field) => field.name === step.whenOption!.name,
        )
      )
        report(
          "INTERACTION_OPTION_NOT_FOUND",
          `Interaction condition option ${step.whenOption.name} is not declared by the command.`,
          definition.id,
        );
    }
    if (
      definition.output &&
      (!definition.output.schema || !definition.output.view)
    )
      report(
        "OUTPUT_INVALID",
        "Output schema and view are required.",
        definition.id,
      );
    if (definition.operation?.kind === "static") {
      const operation = definition.operation;
      if (
        operation.timeoutMs === undefined ||
        operation.lockMode === undefined ||
        operation.safety === undefined ||
        operation.createsRun === undefined
      )
        report(
          "OPERATION_INCOMPLETE",
          "Static operation requires timeout, lock, safety, and Run semantics.",
          definition.id,
        );
    }
    const messages = [
      definition.summary,
      ...(definition.description ? [definition.description] : []),
      ...(definition.group ? [definition.group] : []),
      ...(definition.interactionMenu
        ? [definition.interactionMenu.summary]
        : []),
      ...definition.arguments.map((field) => field.summary),
      ...definition.options.map((field) => field.summary),
      ...(definition.examples ?? []).flatMap((example) =>
        example.description ? [example.description] : [],
      ),
    ];
    for (const message of messages)
      if (options.messageExists && !options.messageExists(message.key))
        report(
          "MESSAGE_NOT_FOUND",
          `Message key ${message.key} is not defined.`,
          definition.id,
        );
  }

  const children = new Map<string, CommandDefinition[]>();
  for (const definition of definitions) {
    if (!definition.parentId) continue;
    const parent = byId.get(definition.parentId);
    if (!parent)
      report(
        "PARENT_NOT_FOUND",
        `Parent ${definition.parentId} does not exist.`,
        definition.id,
      );
    else {
      const values = children.get(parent.id) ?? [];
      values.push(definition);
      children.set(parent.id, values);
      const parentPath = commandPathKey(parent.path);
      const childPath = commandPathKey(definition.path);
      if (!childPath.startsWith(`${parentPath}/`))
        report(
          "PARENT_PATH",
          `Path does not extend parent ${parent.id}.`,
          definition.id,
        );
    }
  }
  for (const [parentId, definitions] of children) {
    const parent = byId.get(parentId)!;
    const menuOrders = new Map<number, string>();
    const menuValues = new Map<string, string>();
    for (const definition of definitions) {
      if (!definition.interactionMenu) continue;
      const segment = definition.path[parent.path.length];
      if (segment?.kind !== "literal") {
        report(
          "INTERACTION_MENU_PATH",
          "Interaction menu entries must extend their parent with a literal segment.",
          definition.id,
        );
        continue;
      }
      const orderOwner = menuOrders.get(definition.interactionMenu.order);
      if (orderOwner)
        report(
          "INTERACTION_MENU_ORDER",
          `Interaction menu order ${definition.interactionMenu.order} conflicts with ${orderOwner}.`,
          definition.id,
        );
      else menuOrders.set(definition.interactionMenu.order, definition.id);
      const valueOwner = menuValues.get(segment.value);
      if (valueOwner)
        report(
          "INTERACTION_MENU_VALUE",
          `Interaction menu value ${segment.value} conflicts with ${valueOwner}.`,
          definition.id,
        );
      else menuValues.set(segment.value, definition.id);
    }
  }
  for (const definition of definitions) {
    const hasChildren = (children.get(definition.id)?.length ?? 0) > 0;
    if (definition.handler && hasChildren)
      report(
        "HANDLER_NOT_LEAF",
        "Only executable leaf commands may declare a handler.",
        definition.id,
      );
    if (!definition.handler && !hasChildren && !definition.children)
      report(
        "EMPTY_BRANCH",
        "Non-executable command requires children or a provider.",
        definition.id,
      );
    const visited = new Set<string>();
    let current: CommandDefinition | undefined = definition;
    while (current?.parentId) {
      if (visited.has(current.id)) {
        report(
          "PARENT_CYCLE",
          "Parent relationship contains a cycle.",
          definition.id,
        );
        break;
      }
      visited.add(current.id);
      current = byId.get(current.parentId);
    }
  }
  if (diagnostics.length) throw new CommandGraphValidationError(diagnostics);
  return definitions;
}
