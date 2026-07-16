import { cp, lstat, mkdir, realpath, rename, rm, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
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
  const maxFileBytes = 512 * 1024 * 1024;
  const maxTotalBytes = 1024 * 1024 * 1024;
  const { plans, unsafe } = planArtifacts(set, context);
  if (unsafe)
    throw new AdapterRuntimeError(
      "ADAPTER_ARTIFACT_UNSAFE",
      "Artifact plan contains an unsafe path.",
    );
  const targetRoot = path.join(run.dir, "artifacts");
  await mkdir(targetRoot, { recursive: true });
  // On macOS /var is commonly a symlink to /private/var. Sources are
  // canonicalized before registration, so canonicalize the base as well to
  // keep sourceRelativePath portable and inside the declared root.
  const resolvedBaseRoot = await realpath(baseRoot).catch(() =>
    path.resolve(baseRoot),
  );
  const roots = await Promise.all(
    allowedRoots.map(async (root) =>
      realpath(root).catch(() => path.resolve(root)),
    ),
  );
  const artifacts = [];
  const names = new Set<string>();
  let totalBytes = 0;
  for (const plan of plans) {
    const matches = await sourcesFor(plan, baseRoot);
    if (!matches.length && plan.required)
      throw new AdapterRuntimeError(
        "ADAPTER_ARTIFACT_MISSING",
        `Required artifact is missing: ${String(plan.id)}`,
      );
    const safe: Array<{ source: string; size: number }> = [];
    let rejectedUnsafe = false;
    for (const match of matches) {
      const sourceMeta = await lstat(match).catch(() => undefined);
      if (sourceMeta?.isSymbolicLink()) {
        rejectedUnsafe = true;
        continue;
      }
      const source = await realpath(match).catch(() => undefined);
      if (!source || !roots.some((root) => inside(root, source))) {
        rejectedUnsafe = true;
        continue;
      }
      const metadata = await stat(source);
      if (metadata.isFile()) safe.push({ source, size: Number(metadata.size) });
    }
    if (!safe.length && plan.required) {
      if (rejectedUnsafe)
        throw new AdapterRuntimeError(
          "ADAPTER_ARTIFACT_UNSAFE",
          `All matches for required artifact are unsafe: ${String(plan.id)}`,
        );
      throw new AdapterRuntimeError(
        "ADAPTER_ARTIFACT_MISSING",
        `Required artifact is missing: ${String(plan.id)}`,
      );
    }
    if (safe.length > 1 && plan.multiple !== true)
      throw new AdapterRuntimeError(
        "ADAPTER_ARTIFACT_MISSING",
        `Artifact matched multiple files: ${String(plan.id)}`,
      );
    for (const [index, { source, size }] of safe.entries()) {
      if (size > maxFileBytes || totalBytes + size > maxTotalBytes)
        throw new AdapterRuntimeError(
          "ADAPTER_ARTIFACT_TOO_LARGE",
          `Artifact size limit exceeded: ${String(plan.id)}`,
          false,
          ["Reduce artifact output or collect a smaller result set."],
          { entry: plan.id, size, maxFileBytes, maxTotalBytes },
        );
      const name = `${String(plan.id)}${matches.length > 1 ? `-${index + 1}` : ""}${path.extname(source)}`;
      if (names.has(name))
        throw new AdapterRuntimeError(
          "ADAPTER_ARTIFACT_UNSAFE",
          `Artifact destination collides: ${name}`,
        );
      names.add(name);
      const destination = path.join(targetRoot, name);
      const temporary = path.join(
        targetRoot,
        `.${name}.${randomBytes(6).toString("hex")}.tmp`,
      );
      let copied = false;
      try {
        await cp(source, temporary, {
          force: false,
          errorOnExist: true,
          verbatimSymlinks: true,
        });
        await rename(temporary, destination);
        copied = true;
        const record = await registry.register({
          name,
          kind: "adapter-output",
          path: destination,
          metadata: {
            adapterEntry: String(plan.id),
            sourceRelativePath: path.relative(resolvedBaseRoot, source),
            sourceSize: size,
          },
        });
        artifacts.push(record);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        if (copied)
          await rm(destination, { force: true }).catch(() => undefined);
        throw error;
      }
      totalBytes += size;
    }
  }
  return artifacts;
};
