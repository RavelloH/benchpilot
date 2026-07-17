import { fail, type Json } from "../../core.js";
import type { QueryUseCases } from "../queries/use-case.js";
import type { ConfigurationUseCases } from "./use-case.js";

export type ConfigurationCommandAction =
  "get" | "set" | "unset" | "resolved" | "explain" | "validate";

export interface ConfigurationCommandRequest {
  action: string;
  key?: string;
  value?: string;
  scopes: Array<"local" | "project" | "global">;
  showOrigin?: boolean;
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
    if (action === "set" && request.value === undefined)
      fail("USAGE_ERROR", 2, "config set requires <key> and <value>.");
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
            scopes: request.scopes,
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
