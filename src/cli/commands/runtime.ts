import { promises as fs } from "node:fs";
import path from "node:path";
import { stdin, stdout } from "node:process";
import {
  ApprovalManager,
  duration,
  fail,
  type Json,
  LockManager,
  type PathService,
  projectStorageKey,
  readJson,
  type ResolvedConfig,
  RunManager,
} from "../../core.js";
import { brief } from "../help-renderer.js";
import type { Flags } from "../parser.js";
import { write } from "../output-renderer.js";

interface RuntimeCommandContext {
  parts: string[];
  flags: Flags;
  commandFlags: Json;
  paths: PathService;
  project: Awaited<ReturnType<PathService["project"]>>;
  config: ResolvedConfig;
}

export async function handleRuntimeCommand({
  parts,
  flags,
  commandFlags,
  paths,
  project,
  config,
}: RuntimeCommandContext): Promise<boolean> {
  if (parts[0] === "runs") {
    if (parts.length === 1) {
      stdout.write(brief("runs"));
      return true;
    }
    const manager = new RunManager(
      paths,
      projectStorageKey({
        id: String((config.value.project as Json | undefined)?.id || ""),
        root: project?.root,
      }),
    );
    if (parts[1] === "list") {
      let runs = await manager.list();
      if (commandFlags.status)
        runs = runs.filter((r) => r.manifest?.status === commandFlags.status);
      if (commandFlags.limit) runs = runs.slice(0, Number(commandFlags.limit));
      write({ runs }, flags);
      return true;
    }
    if (parts[1] === "prune") {
      const runs = await manager.list();
      if (
        !commandFlags["older-than"] &&
        !commandFlags.keep &&
        !commandFlags["dangerously-remove-all-runs"]
      )
        fail(
          "DANGEROUS_CONFIRMATION_REQUIRED",
          7,
          "runs prune requires --older-than, --keep, or --dangerously-remove-all-runs.",
        );
      let remove = runs;
      if (commandFlags.keep) remove = runs.slice(Number(commandFlags.keep));
      if (commandFlags["older-than"]) {
        const age = duration(commandFlags["older-than"]);
        remove = runs.filter(
          (r) => Date.now() - Date.parse(String(r.manifest?.startedAt)) > age,
        );
      }
      for (const r of remove)
        await fs.rm(
          path.join(
            paths.runsRoot(
              projectStorageKey({
                id: String(
                  (config.value.project as Json | undefined)?.id || "",
                ),
                root: project?.root,
              }),
            ),
            r.id,
          ),
          { recursive: true, force: true },
        );
      write({ removed: remove.map((x) => x.id) }, flags);
      return true;
    }
  }
  if (parts[0] === "run" && parts[1]) {
    if (parts.length === 2) {
      stdout.write(
        "benchpilot run <run-id> — Commands: show, logs, artifacts\n",
      );
      return true;
    }
    const manager = new RunManager(
      paths,
      projectStorageKey({
        id: String((config.value.project as Json | undefined)?.id || ""),
        root: project?.root,
      }),
    );
    const record = await manager.get(parts[1]);
    const dir = record.dir;
    if (parts[2] === "show")
      write({ manifest: record.manifest, result: record.result }, flags);
    else if (parts[2] === "logs")
      write(
        { log: await fs.readFile(path.join(dir, "benchpilot.log"), "utf8") },
        flags,
        await fs.readFile(path.join(dir, "benchpilot.log"), "utf8"),
      );
    else if (parts[2] === "artifacts")
      write(
        {
          artifacts: await fs
            .readdir(path.join(dir, "artifacts"))
            .catch(() => []),
        },
        flags,
      );
    else fail("USAGE_ERROR", 2, "Unknown run command.");
    return true;
  }
  if (parts[0] === "locks") {
    if (parts.length === 1) {
      stdout.write(brief("locks"));
      return true;
    }
    const locks = new LockManager(paths);
    if (parts[1] === "list") write({ locks: await locks.list() }, flags);
    else if (parts[1] === "clear-stale") {
      const ls = await locks.list();
      const cleared = [];
      for (const l of ls)
        if (l && (await locks.liveness(l)) === "stale") {
          await locks.clear(l.lockId, false);
          cleared.push(l.lockId);
        }
      write({ cleared }, flags);
      return true;
    }
    return true;
  }
  if (parts[0] === "lock" && parts[1]) {
    if (parts.length === 2) {
      stdout.write("benchpilot lock <lock-id> — Commands: inspect, clear\n");
      return true;
    }
    const locks = new LockManager(paths);
    if (parts[2] === "inspect")
      write(await readJson(locks.file(parts[1])), flags);
    else if (parts[2] === "clear")
      write(
        {
          cleared: await locks.clear(
            parts[1],
            Boolean(commandFlags["dangerously-clear-active-lock"]),
          ),
        },
        flags,
      );
    else fail("USAGE_ERROR", 2, "Unknown lock command.");
    return true;
  }
  if (parts[0] === "approvals" && parts.length === 1) {
    stdout.write(brief("approvals"));
    return true;
  }
  if (parts[0] === "approvals" && parts[1] === "list") {
    const a = new ApprovalManager(paths);
    write({ approvals: await Promise.all(await a.list()) }, flags);
    return true;
  }
  if (parts[0] === "approval" && parts[1]) {
    if (parts.length === 2) {
      stdout.write(
        "benchpilot approval <approval-id> — Commands: inspect, approve, reject\n",
      );
      return true;
    }
    const a = new ApprovalManager(paths);
    if (parts[2] === "inspect") write(await a.get(parts[1]), flags);
    else if (parts[2] === "reject") {
      await a.change(parts[1], "rejected");
      write({ id: parts[1], status: "rejected" }, flags);
    } else if (parts[2] === "approve") {
      if (
        !stdin.isTTY ||
        !stdout.isTTY ||
        process.env.CI ||
        flags.json ||
        flags.jsonl
      )
        fail(
          "INTERACTIVE_APPROVAL_REQUIRED",
          7,
          "Approval requires an interactive TTY and cannot use JSON output.",
        );
      const req = await a.get(parts[1]);
      stdout.write(
        `Risk approval ${parts[1]}. Type physical device ID (${(req.binding as Json).device && ((req.binding as Json).device as Json).physicalId}): `,
      );
      const answer = await new Promise<string>((r) =>
        stdin.once("data", (x) => r(String(x).trim())),
      );
      if (answer !== ((req.binding as Json).device as Json).physicalId)
        fail("APPROVAL_CHALLENGE_FAILED", 7, "Challenge did not match.");
      await a.change(parts[1], "approved");
      write({ id: parts[1], status: "approved" }, flags);
    } else fail("USAGE_ERROR", 2, "Unknown approval command.");
    return true;
  }
  return false;
}
