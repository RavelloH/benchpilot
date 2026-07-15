import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BenchPilotError, fail } from "../errors/benchpilot-error.js";
import type { Run } from "../runs/run-manager.js";
import type { ArtifactRecord, ArtifactRegistration } from "./types.js";

const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
};

export class ArtifactRegistry {
  private readonly root: string;

  constructor(private run: Run) {
    this.root = path.join(run.dir, "artifacts");
  }

  async register(registration: ArtifactRegistration): Promise<ArtifactRecord> {
    if (!registration.name || !registration.kind || !registration.path)
      fail(
        "INVALID_ARTIFACT",
        5,
        "Artifact name, kind, and path are required.",
      );
    const requested = path.resolve(registration.path);
    const declaredRoot = path.resolve(this.root);
    if (!inside(declaredRoot, requested))
      fail(
        "INVALID_ARTIFACT",
        5,
        "Artifact path must be inside the Run artifacts directory.",
      );
    const artifactRoot = await fs.realpath(declaredRoot).catch(() => undefined);
    if (!artifactRoot)
      throw new BenchPilotError(
        "INVALID_ARTIFACT",
        5,
        "Run artifact directory does not exist.",
      );
    const resolved = await fs.realpath(requested).catch(() => {
      throw new BenchPilotError(
        "INVALID_ARTIFACT",
        5,
        "Artifact file does not exist.",
      );
    });
    if (!inside(artifactRoot, resolved))
      fail(
        "INVALID_ARTIFACT",
        5,
        "Artifact path escapes the Run artifacts directory.",
      );
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) fail("INVALID_ARTIFACT", 5, "Artifact must be a file.");
    const contents = await fs.readFile(resolved);
    return {
      name: registration.name,
      kind: registration.kind,
      path: path.relative(this.run.dir, requested),
      size: stat.size,
      sha256: createHash("sha256").update(contents).digest("hex"),
      createdAt: new Date().toISOString(),
      metadata: registration.metadata,
    };
  }
}
