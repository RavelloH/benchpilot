import { editConfiguration } from "../../application/config/use-case.js";
import { fail, type Json, type PathService } from "../../core.js";
import type { Flags } from "../parser.js";

/** @deprecated CLI compatibility bridge; configuration mutation lives in Application. */
export async function editConfig(
  paths: PathService,
  project: Awaited<ReturnType<PathService["project"]>>,
  flags: Flags,
  key: string,
  value?: string,
): Promise<Json> {
  const scopes = ["local", "project", "global"].filter(
    (scope) => flags[scope],
  ) as Array<"local" | "project" | "global">;
  if (scopes.length > 1)
    fail("USAGE_ERROR", 2, "Choose only one configuration scope.");
  return editConfiguration({ paths, project, scope: scopes[0], key, value });
}
