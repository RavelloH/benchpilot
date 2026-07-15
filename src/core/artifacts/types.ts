export type Json = Record<string, unknown>;

export interface ArtifactRegistration {
  name: string;
  kind: string;
  path: string;
  metadata?: Json;
}

export interface ArtifactRecord extends ArtifactRegistration {
  size: number;
  sha256: string;
  createdAt: string;
}
