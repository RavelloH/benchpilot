import type { MessageRef } from "../../contracts/message-ref.js";
import type { Json, Safety } from "../../core.js";

export type DynamicChildProviderId =
  | "adapters"
  | "configured-devices"
  | "configured-systems"
  | "device-capabilities"
  | "system-capabilities"
  | "runs"
  | "locks"
  | "approvals"
  | "upgrade-versions";

export type CommandSegment =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "argument"; readonly name: string }
  | {
      readonly kind: "dynamic-resource";
      readonly name: string;
      readonly provider: DynamicChildProviderId;
    }
  | {
      readonly kind: "dynamic-capability";
      readonly name: string;
      readonly provider: "device-capabilities" | "system-capabilities";
    };

export interface CommandFieldDefinition {
  readonly name: string;
  readonly kind: "argument" | "option";
  readonly summary: MessageRef;
  readonly required?: boolean;
  readonly position?: number;
  readonly variadic?: boolean;
  readonly value?: "boolean" | "string" | "json";
  readonly aliases?: readonly string[];
  readonly negatable?: boolean;
  readonly repeatable?: boolean;
  readonly secret?: boolean;
  readonly schema?: Json;
  /** Human placeholder used by declarative field views. */
  readonly placeholder?: string;
  /** Static machine values accepted for this field. */
  readonly enum?: readonly string[];
  /** Separates multiple enum values in one string option. */
  readonly separator?: ",";
  /** Read-only provider used to expose available field values in Help. */
  readonly choiceProvider?: string;
}

export interface CommandOutputReference {
  readonly id: string;
  readonly schema: string;
  readonly version: number;
  readonly view: string;
}

export interface CommandExample {
  readonly argv: readonly string[];
  readonly description?: MessageRef;
}

export interface CommandNavigationDefinition {
  readonly groupId: string;
  readonly order: number;
  readonly summary: MessageRef;
}

export interface CommandInteractionMenuDefinition {
  readonly summary: MessageRef;
  readonly order: number;
}

export interface CommandInteractionStepDefinition {
  /** A declared argument or option collected by this step. */
  readonly field?: string;
  /** Select one declared option from this mutually-exclusive group. */
  readonly oneOf?: readonly string[];
  readonly choices?: string;
  /** Also collect an optional field when it has no supplied value. */
  readonly collect?: "missing" | "absent";
  /** Only collect this step after a prior option has the expected value. */
  readonly whenOption?: {
    readonly name: string;
    readonly equals?: unknown;
  };
  /** Apply a selected locale to subsequent prompts in this interaction. */
  readonly updatesLocale?: boolean;
}

export interface CommandInteractionRecipeDefinition {
  readonly steps?: readonly CommandInteractionStepDefinition[];
}

export interface CommandGroupDefinition {
  readonly id: string;
  readonly label: MessageRef;
  readonly order: number;
  readonly views: readonly string[];
}

export interface CommandRootDefinition {
  readonly id: "root";
  readonly summary: MessageRef;
  readonly usage: readonly string[];
  readonly helpView: string;
  readonly allHelpView: string;
  readonly interactionView: string;
  readonly globalOptions: readonly {
    readonly name: string;
    readonly summary: MessageRef;
  }[];
  readonly examples: readonly CommandExample[];
  readonly footer: readonly MessageRef[];
}

export interface CommandCatalogDefinition {
  readonly root: CommandRootDefinition;
  readonly commandHelpView: string;
  readonly groups: readonly CommandGroupDefinition[];
  readonly globalOptions: readonly CommandFieldDefinition[];
  readonly commands: readonly CommandDefinition[];
}

export interface CommandOperationDescriptor {
  readonly kind: "dynamic-capability" | "static";
  readonly timeoutMs?: number;
  readonly lockMode?: "none" | "exclusive";
  readonly safety?: Safety;
  readonly createsRun?: boolean;
  readonly ttyOnly?: boolean;
}

export interface CommandDefinition {
  readonly id: string;
  readonly path: readonly CommandSegment[];
  readonly parentId?: string;
  readonly summary: MessageRef;
  readonly description?: MessageRef;
  readonly group?: MessageRef;
  readonly navigation?: CommandNavigationDefinition;
  readonly helpView?: string;
  readonly arguments: readonly CommandFieldDefinition[];
  readonly options: readonly CommandFieldDefinition[];
  readonly interaction: "never" | "when-incomplete" | "required";
  /** Optional entry shown when an interaction recipe offers this command. */
  readonly interactionMenu?: CommandInteractionMenuDefinition;
  readonly interactionRecipe?: CommandInteractionRecipeDefinition;
  readonly handler?: string;
  readonly output?: CommandOutputReference;
  readonly examples?: readonly CommandExample[];
  readonly errors?: readonly string[];
  readonly aliases?: readonly string[];
  readonly availability?: "available" | "unavailable";
  readonly children?: {
    readonly kind: "dynamic";
    readonly provider: DynamicChildProviderId;
  };
  readonly safety?: Safety;
  readonly operation?: CommandOperationDescriptor;
}

export interface DynamicCommandValue {
  readonly value: string;
  readonly summary?: MessageRef;
  readonly availability?: "available" | "unavailable";
  readonly unavailableReasonCode?: string;
  readonly arguments?: readonly CommandFieldDefinition[];
  readonly options?: readonly CommandFieldDefinition[];
  readonly output?: CommandOutputReference;
  readonly safety?: Safety;
  readonly operation?: CommandOperationDescriptor;
}

export interface DynamicCommandProviderContext {
  readonly provider: DynamicChildProviderId;
  readonly captures: Readonly<Record<string, string | readonly string[]>>;
  readonly definition: CommandDefinition;
}

/** Implementations must be read-only and must never probe or execute devices. */
export interface DynamicCommandProvider {
  values(
    context: DynamicCommandProviderContext,
  ): Promise<readonly DynamicCommandValue[]>;
}

export const commandPathKey = (path: readonly CommandSegment[]) =>
  path
    .map((segment) =>
      segment.kind === "literal"
        ? `literal:${segment.value}`
        : `${segment.kind}:${segment.name}`,
    )
    .join("/");
