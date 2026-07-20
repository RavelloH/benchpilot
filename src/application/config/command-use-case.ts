import { fail, type Json } from "../../core.js";
import type { QueryUseCases } from "../queries/use-case.js";
import { configurationCatalogEntry } from "./catalog.js";
import type { ConfigurationUseCases } from "./use-case.js";

export type ConfigurationCommandAction =
  "get" | "set" | "unset" | "resolved" | "explain" | "validate";

export interface ConfigurationCommandRequest {
  action: string;
  key?: string;
  value?: string;
  scopes: Array<"local" | "project" | "global">;
  showOrigin?: boolean;
  /** Apply the public CLI's built-in key and scope policy. */
  enforceCatalog?: boolean;
}

export interface ConfigurationCommandOutcome {
  kind: `config.${ConfigurationCommandAction}`;
  data: Json;
}

/** Command semantics for configuration; free of argv, terminals, and text UI. */
export class ConfigurationCommandUseCases {
  constructor(
    private readonly queries: QueryUseCases,
    private readonly mutations: ConfigurationUseCases,
  ) {}

  async execute(
    request: ConfigurationCommandRequest,
  ): Promise<ConfigurationCommandOutcome> {
    const action = request.action as ConfigurationCommandAction;
    if (
      !["get", "set", "unset", "resolved", "explain", "validate"].includes(
        action,
      )
    )
      fail("USAGE_ERROR", 2, `Unknown config command: ${request.action}`);
    const requiresKey = ["get", "set", "unset", "explain"].includes(action);
    if (requiresKey && !request.key)
      fail("USAGE_ERROR", 2, `config ${action} requires <key>.`);
    const entry =
      request.key && request.enforceCatalog
        ? configurationCatalogEntry(request.key)
        : undefined;
    if (requiresKey && request.enforceCatalog && !entry)
      fail(
        "CONFIG_KEY_NOT_FOUND",
        3,
        `Unknown configuration key: ${request.key}`,
      );
    if (action === "set" && request.value === undefined)
      fail("USAGE_ERROR", 2, "config set requires <key> and <value>.");
    const scopes =
      (action === "set" || action === "unset") && request.enforceCatalog
        ? request.scopes.length
          ? request.scopes
          : [entry!.scopes[0]]
        : request.scopes;
    if (
      (action === "set" || action === "unset") &&
      request.enforceCatalog &&
      scopes.some((scope) => !entry!.scopes.includes(scope))
    )
      fail(
        "CONFIG_SCOPE_INVALID",
        2,
        `${entry!.key} cannot be saved in the requested scope.`,
      );
    switch (action) {
      case "get":
        return {
          kind: "config.get",
          data: this.queries.getConfiguration(
            request.key!,
            request.showOrigin === true,
          ) as Json,
        };
      case "resolved":
        return {
          kind: "config.resolved",
          data: this.queries.resolvedConfiguration() as Json,
        };
      case "explain":
        return {
          kind: "config.explain",
          data: this.queries.explainConfiguration(request.key!) as Json,
        };
      case "validate":
        return {
          kind: "config.validate",
          data: this.queries.validateConfiguration() as Json,
        };
      case "set":
      case "unset":
        return {
          kind: `config.${action}`,
          data: await this.mutations.edit({
            scopes,
            key: request.key!,
            ...(action === "set" ? { value: request.value } : {}),
          }),
        };
    }
  }
}

export const createConfigurationCommandUseCases = (
  queries: QueryUseCases,
  mutations: ConfigurationUseCases,
) => new ConfigurationCommandUseCases(queries, mutations);
