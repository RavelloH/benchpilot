import { cp, mkdir, realpath, stat } from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactRecord,
  ArtifactRegistration,
} from "../../../core/artifacts/types.js";
import type { Run } from "../../../core/runs/run-manager.js";
import { AdapterRuntimeError } from "../errors.js";
import { planArtifacts, type ArtifactPlan } from "./artifacts.js";
import type { RuleObject } from "./template.js";

const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

const sourcesFor = async (plan: ArtifactPlan, baseRoot: string) => {
  if ("path" in plan) return [path.resolve(baseRoot, plan.path)];
  const matches: string[] = [];
  for await (const match of glob(path.resolve(baseRoot, plan.glob)))
    matches.push(path.resolve(match));
  return matches.sort((left, right) => left.localeCompare(right));
};

export const collectArtifacts = async (
  set: RuleObject,
  context: RuleObject,
  run: Run,
  registry: {
    register(record: ArtifactRegistration): Promise<ArtifactRecord>;
  },
  allowedRoots: string[],
  baseRoot = process.cwd(),
) => {
  const { plans, unsafe } = planArtifacts(set, context);
  if (unsafe)
    throw new AdapterRuntimeError(
      "ADAPTER_ARTIFACT_UNSAFE",
      "Artifact plan contains an unsafe path.",
    );
  const targetRoot = path.join(run.dir, "artifacts");
  await mkdir(targetRoot, { recursive: true });
  const artifacts = [];
  for (const plan of plans) {
    const matches = await sourcesFor(plan, baseRoot);
    if (!matches.length && plan.required)
      throw new AdapterRuntimeError(
        "ADAPTER_ARTIFACT_MISSING",
        `Required artifact is missing: ${String(plan.id)}`,
      );
    if (matches.length > 1 && plan.multiple !== true)
      throw new AdapterRuntimeError(
        "ADAPTER_ARTIFACT_MISSING",
        `Artifact matched multiple files: ${String(plan.id)}`,
      );
    for (const [index, match] of matches.entries()) {
      const source = await realpath(match).catch(() => undefined);
      if (
        !source ||
        !allowedRoots.some((root) => inside(path.resolve(root), source))
      )
        throw new AdapterRuntimeError(
          "ADAPTER_ARTIFACT_UNSAFE",
          `Artifact path is outside the allowed roots: ${match}`,
        );
      if (!(await stat(source)).isFile()) continue;
      const name = `${String(plan.id)}${matches.length > 1 ? `-${index + 1}` : ""}${path.extname(source)}`;
      const destination = path.join(targetRoot, name);
      await cp(source, destination, { force: false });
      artifacts.push(
        await registry.register({
          name,
          kind: "adapter-output",
          path: destination,
          metadata: { adapterEntry: String(plan.id) },
        }),
      );
    }
  }
  return artifacts;
};
