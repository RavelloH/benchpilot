import path from "node:path";
import { fail } from "../errors/benchpilot-error.js";

export function resolveInside(root: string, name: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, name);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  )
    fail("INVALID_PATH", 3, "Path escapes its allowed storage root.");
  return resolved;
}
