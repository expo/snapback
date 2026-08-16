// Type declarations for review-surface.mjs — generated-artifact custody:
// the artifacts.json review manifest, the content-addressed codegen cache,
// and fail-closed graph verification/resolution.

export const REVIEW_MANIFEST_VERSION: 2;
export const REVIEW_MANIFEST_FILE: 'artifacts.json';

export const CUSTODY: Readonly<{
  reviewManifest: 'review-manifest';
  consumerCommitted: 'consumer-committed';
  regenerableCache: 'regenerable-cache';
}>;

export type ArtifactCustody = 'consumer-committed' | 'regenerable-cache';

export type ArtifactLogicalKind =
  | 'schema-manifest'
  | 'authorization-review'
  | 'function-manifest'
  | 'normalized-application-definition'
  | 'handler-runtime-profile'
  | 'capability-manifest'
  | 'contract-data-manifest'
  | 'provider-introspection'
  | 'provider-binding'
  | 'typed-api'
  | 'package-metadata'
  | 'route-manifest'
  | 'operation-schema'
  | 'contract-projection'
  | 'remote-service-projection'
  | 'generated-projection';

export type ArtifactConsumer =
  | 'snapback-runtime'
  | 'developer-tooling'
  | 'contract'
  | 'client-bundler'
  | 'app-cli'
  | 'release'
  | 'migration-tooling'
  | 'tooling'
  | 'authorization-reviewers';

/** Stable two-space JSON with recursively sorted object keys. */
export function stableArtifactJson(value: unknown): string;

export function artifactSha256(bytes: string | Uint8Array): `sha256:${string}`;

/** The project root: the parent of a `snapback/` backend directory. */
export function codegenProjectRoot(backendRoot: string): string;

/** `<project>/.snapback/codegen-cache/<encoded inputsHash>`; fail-closed on bad hashes. */
export function codegenCacheGraphRoot(backendRoot: string, inputsHash: string): string;

export function logicalArtifactKind(path: string): ArtifactLogicalKind;
export function artifactConsumer(path: string): ArtifactConsumer;

export interface ArtifactFileRecord {
  readonly path: string;
  readonly sha256: `sha256:${string}`;
  readonly bytes: number;
  readonly logicalKind: ArtifactLogicalKind;
  readonly custody: ArtifactCustody;
  readonly consumer: ArtifactConsumer;
  readonly authority?: string;
  readonly regeneration: Readonly<{ rule: 'complete-inputs-hash'; command: string }>;
}

export function createArtifactFileRecords(
  graphRoot: string,
  artifactPaths: Iterable<string>,
  options?: Readonly<{
    committedProjectionPaths?: readonly string[];
    targetProfile?: string;
  }>,
): ArtifactFileRecord[];

/**
 * The manifestVersion-2 artifacts.json shape. Carries the legacy artifact
 * index fields (artifactKind, appId, inputsHash, artifacts, ...) alongside
 * the digested file inventory.
 */
export interface ReviewManifest {
  readonly manifestVersion: number;
  readonly inputsHash: string;
  readonly identities?: Readonly<{
    schemaVersion: 'snapback.semantic-identity.v1';
    semanticId: `sha256:${string}`;
    executableId: `sha256:${string}`;
    executableIdsByTarget: Readonly<Record<string, `sha256:${string}`>>;
    evidenceId: `sha256:${string}`;
    normalizedContractId?: `sha256:${string}`;
    normalizedSchemaId?: `sha256:${string}`;
    bundleId: `sha256:${string}`;
    generationId: `sha256:${string}`;
  }>;
  readonly reviewManifest: Readonly<{
    path: string;
    custody: 'review-manifest';
    authority: string;
  }>;
  readonly cache: Readonly<{
    key: string;
    graphPath: string;
    regenerationRule: 'regenerate-or-fail-closed';
  }>;
  readonly custody: Readonly<Record<string, number>>;
  readonly files: readonly ArtifactFileRecord[];
  readonly summary: unknown;
  readonly [legacyIndexFact: string]: unknown;
}

export function createReviewManifest(options: Readonly<{
  legacyIndex: Readonly<{ inputsHash: string; [fact: string]: unknown }>;
  backendRoot: string;
  outputDirectory: string;
  files: readonly ArtifactFileRecord[];
  summary: unknown;
}>): ReviewManifest;

/** Returns human-readable problems; empty for a valid manifest. */
export function validateReviewManifest(manifest: unknown): string[];

export function readReviewManifest(generatedRoot: string): { path: string; value: unknown };

export type VerifiedGeneratedGraph =
  | Readonly<{
      layout: 'legacy';
      graphRoot: string;
      materializedRoot: string;
      reviewPath: string;
      manifest: Readonly<Record<string, unknown>>;
    }>
  | Readonly<{
      layout: 'review-cache';
      graphRoot: string;
      materializedRoot: string;
      reviewPath: string;
      manifest: ReviewManifest;
    }>;

/** Fail-closed verification of the cache graph and its materialization. */
export function verifyGeneratedGraph(generatedRoot: string): VerifiedGeneratedGraph;

/** Resolves one artifact path through the verified graph (or legacy layout). */
export function resolveGeneratedArtifact(generatedRoot: string, artifactPath: string): string;

/** Atomically publishes a complete generated graph: cache first, then materialization. */
export function publishGeneratedGraph(options: Readonly<{
  temporaryGraphRoot: string;
  cacheGraphRoot: string;
  materializedRoot: string;
  reviewManifest: ReviewManifest;
}>): VerifiedGeneratedGraph;
