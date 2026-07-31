// Type declarations for seed-artifact.mjs — the versioned `snapback.seed.v1`
// artifact builder and the legacy/versioned seed.json parser.

export const SEED_ARTIFACT_FORMAT_V1: 'snapback.seed.v1';
export const VERSIONED_SEED_MAX_EFFECTS_V1: 1024;

export type SeedTables = Readonly<Record<string, ReadonlyArray<Readonly<Record<string, unknown>>>>>;

export interface SeedSourceV1 {
  readonly seedVersion: string;
  readonly tables: SeedTables;
}

export interface SeedArtifactV1 {
  readonly formatVersion: 'snapback.seed.v1';
  readonly appId: string;
  readonly seedVersion: string;
  readonly tables: SeedTables;
  readonly seedDigest: `sha256:${string}`;
}

/** Domain-separated digest over the canonical JSON of the artifact body. */
export function seedArtifactDigest(body: unknown): `sha256:${string}`;

export function buildSeedArtifactV1(source: SeedSourceV1, appId: string): {
  artifact: SeedArtifactV1;
  seedRowCount: number;
};

export type ParsedSeedSource =
  | { versioned: true; artifact: SeedArtifactV1; seedRowCount: number }
  | { versioned: false; seed: Readonly<{ tables: SeedTables }> };

/**
 * Parses seed.json bytes; a `seedVersion` member selects the versioned v1
 * artifact path (which requires `appId`), otherwise the legacy shape.
 */
export function parseSeedSourceV1(bytes: Uint8Array | string, appId?: string): ParsedSeedSource;

/** Canonical (sorted-key) JSON of a seed artifact plus a trailing newline. */
export function canonicalSeedArtifactJson(artifact: unknown): string;
