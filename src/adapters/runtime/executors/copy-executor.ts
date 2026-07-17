import {
  cp,
  lstat,
  mkdir,
  realpath,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { AdapterRuntimeError } from "../errors.js";
import type { CopyLaunchPlan } from "../planning/launch-plan.js";

const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

const unsafe = (plan: CopyLaunchPlan, reason: string) =>
  new AdapterRuntimeError(
    "ADAPTER_ARTIFACT_UNSAFE",
    `Unsafe copy operation: ${reason}.`,
    false,
    [],
    { operation: "copy", from: plan.from, to: plan.to, reason },
  );

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw signal.reason ?? new Error("Copy aborted.");
};

const nearestExistingParent = async (
  target: string,
  signal?: AbortSignal,
): Promise<string> => {
  let current = target;
  while (true) {
    throwIfAborted(signal);
    if (await lstat(current).catch(() => undefined)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
};

const assertNoSourceLinks = async (
  source: string,
  signal?: AbortSignal,
): Promise<void> => {
  throwIfAborted(signal);
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) throw new Error("source symlink");
  if (!metadata.isDirectory()) return;
  for (const entry of await readdir(source))
    await assertNoSourceLinks(path.join(source, entry), signal);
};

export const executeCopy = async (
  plan: CopyLaunchPlan,
  allowedRoots: string[],
  onWrite?: () => void,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> => {
  throwIfAborted(signal);
  const from = path.resolve(plan.from);
  const to = path.resolve(plan.to);
  const source = await realpath(from).catch(() => undefined);
  const roots = await Promise.all(
    allowedRoots.map(async (root) => ({
      resolved: path.resolve(root),
      real: await realpath(root).catch(() => undefined),
    })),
  );
  throwIfAborted(signal);
  if (!source || !roots.some((root) => root.real && inside(root.real, source)))
    throw unsafe(plan, "source-outside-allowed-roots");
  if (!roots.some((root) => inside(root.resolved, to)))
    throw unsafe(plan, "destination-outside-allowed-roots");
  try {
    await assertNoSourceLinks(from, signal);
  } catch {
    throw unsafe(plan, "source-contains-symlink");
  }
  const parent = path.dirname(to);
  const existingParent = await nearestExistingParent(parent, signal);
  const realExistingParent = await realpath(existingParent).catch(
    () => undefined,
  );
  if (
    !realExistingParent ||
    !roots.some((root) => root.real && inside(root.real, realExistingParent))
  )
    throw unsafe(plan, "destination-parent-escapes-allowed-roots");
  await mkdir(parent, { recursive: true });
  throwIfAborted(signal);
  const realParent = await realpath(parent).catch(() => undefined);
  if (
    !realParent ||
    !roots.some((root) => root.real && inside(root.real, realParent))
  )
    throw unsafe(plan, "destination-parent-escapes-after-create");
  const targetMeta = await lstat(to).catch(() => undefined);
  if (targetMeta?.isSymbolicLink())
    throw unsafe(plan, "destination-is-symlink");
  if (targetMeta && !plan.overwrite)
    throw unsafe(plan, "destination-exists-without-overwrite");
  const temporary = path.join(
    realParent,
    `.${path.basename(to)}.benchpilot-${randomBytes(8).toString("hex")}.tmp`,
  );
  const backup = path.join(
    realParent,
    `.${path.basename(to)}.benchpilot-${randomBytes(8).toString("hex")}.bak`,
  );
  let movedTarget = false;
  let committedTarget = false;
  try {
    throwIfAborted(signal);
    onWrite?.();
    await cp(source, temporary, {
      recursive: plan.recursive,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
    });
    throwIfAborted(signal);
    if (targetMeta && plan.overwrite) {
      // Re-check immediately before moving the existing target. A destination
      // replaced with a link after planning must never be followed or removed.
      if ((await lstat(to)).isSymbolicLink())
        throw unsafe(plan, "destination-is-symlink");
      await rename(to, backup);
      movedTarget = true;
    }
    throwIfAborted(signal);
    await rename(temporary, to);
    committedTarget = true;
    throwIfAborted(signal);
    if (movedTarget) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(
      () => undefined,
    );
    if (committedTarget)
      await rm(to, { recursive: true, force: true }).catch(() => undefined);
    if (movedTarget) await rename(backup, to).catch(() => undefined);
    if (error instanceof AdapterRuntimeError) throw error;
    throw unsafe(plan, "copy-failed");
  }
  return { from: source, to, copied: true };
};
