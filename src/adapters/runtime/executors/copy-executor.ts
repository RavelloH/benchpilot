import { cp, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { AdapterRuntimeError } from "../errors.js";
import type { CopyLaunchPlan } from "../planning/launch-plan.js";

const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

export const executeCopy = async (
  plan: CopyLaunchPlan,
  allowedRoots: string[],
): Promise<Record<string, unknown>> => {
  const from = path.resolve(plan.from);
  const to = path.resolve(plan.to);
  const source = await realpath(from).catch(() => undefined);
  if (
    !source ||
    !allowedRoots.some((root) => inside(path.resolve(root), source))
  )
    throw new AdapterRuntimeError(
      "ADAPTER_ARTIFACT_UNSAFE",
      "Copy source is outside the allowed roots.",
    );
  if (!allowedRoots.some((root) => inside(path.resolve(root), to)))
    throw new AdapterRuntimeError(
      "ADAPTER_ARTIFACT_UNSAFE",
      "Copy destination is outside the allowed roots.",
    );
  await mkdir(path.dirname(to), { recursive: true });
  await cp(source, to, { recursive: plan.recursive, force: plan.overwrite });
  return { from: source, to, copied: true };
};
