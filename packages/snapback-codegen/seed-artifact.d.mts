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

// --- LLP 0109 §17: seed asset fixtures ------------------------------------

export const SEED_ASSET_FIXTURES_FORMAT_V1: 'snapback.seed-asset-fixtures.v1';

export interface SeedAssetFixtureV1 {
  readonly id: string;
  readonly upload: string;
  readonly file: string;
  readonly mediaType: string;
  readonly sourceDigest: `sha256:${string}`;
}

export interface SeedAssetFixturesV1 {
  readonly formatVersion: 'snapback.seed-asset-fixtures.v1';
  readonly appId: string;
  readonly fixturesDigest: `sha256:${string}`;
  readonly fixtures: readonly SeedAssetFixtureV1[];
}

/** Domain-separated digest over the canonical JSON of the fixtures body. */
export function seedAssetFixturesDigest(body: unknown): `sha256:${string}`;

/**
 * `source` is the authored seed-assets.json; `sourceDigests` maps each
 * fixture's declared file path to the sha256 hex of its committed bytes
 * (the caller reads files under its own capability discipline — this
 * module never touches the filesystem).
 */
export function buildSeedAssetFixturesV1(
  source: unknown,
  appId: string,
  sourceDigests: ReadonlyMap<string, string>,
): SeedAssetFixturesV1;

/** Canonical (sorted-key) JSON of a fixtures artifact plus a trailing newline. */
export function canonicalSeedAssetFixturesJson(artifact: unknown): string;
