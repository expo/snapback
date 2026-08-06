// Type declarations for codegen-summary.mjs — the deterministic author-facing
// projection of one complete codegen result.

export interface CodegenSourceSpan {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

export interface CodegenSummaryDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly [detail: string]: unknown;
}

/** A generated function-manifest entry as the summary observes it. */
export interface CodegenSummaryFunction {
  readonly name: string;
  readonly kind: string;
  readonly readSetSummary?: readonly string[];
  readonly declaredReads?: readonly string[];
  readonly writeSetSummary?: readonly string[];
  readonly declaredWrites?: readonly string[];
  readonly [fact: string]: unknown;
}

export interface DegradedResultEntry {
  readonly code: string;
  readonly operation: string;
  readonly kind: string;
  readonly source: CodegenSourceSpan;
  readonly output: Readonly<{ path: string; symbol: string }>;
  readonly remediation: string;
}

export interface ImplicitAuthRequirementEntry {
  readonly code: 'SNAPBACK_AUTH_REQUIREMENT_IMPLICIT';
  readonly operation: string;
  readonly source: CodegenSourceSpan;
  readonly effectiveLegacyRequirement: 'optional-user';
  readonly allowed: readonly ['public', 'optional-user', 'authenticated'];
  readonly guideAnchor: string;
}

export interface CodegenSummary {
  readonly schemaVersion: 'snapback.codegen-summary.v1';
  readonly appId: string;
  readonly inputsHash: string;
  readonly counts: Readonly<{
    tables: number;
    operations: Readonly<{
      total: number;
      query: number;
      liveQuery: number;
      mutation: number;
      action: number;
      live: number;
    }>;
    ephemeralCollections: number;
    custody: Readonly<{
      reviewManifest: number;
      consumerCommitted: number;
      regenerableCache: number;
      total: number;
    }>;
    warnings: number;
    implicitAuthRequirements: number;
    degradedResults: number;
    seedRows?: number | null;
  }>;
  readonly implicitAuthRequirements: readonly ImplicitAuthRequirementEntry[];
  readonly degradedResults: readonly DegradedResultEntry[];
  readonly seed?: Readonly<{ version: string; digest: `sha256:${string}`; rows: number | null }>;
}

export function createCodegenSummary(options: Readonly<{
  appId: string;
  inputsHash: string;
  tables: Readonly<Record<string, unknown>>;
  functions: readonly CodegenSummaryFunction[];
  ephemeralCollections: readonly unknown[];
  fileRecords: ReadonlyArray<Readonly<{ custody: string; [fact: string]: unknown }>>;
  diagnostics: readonly CodegenSummaryDiagnostic[];
  sourceSpans?: Readonly<Record<string, CodegenSourceSpan>>;
  schemaFieldSpans?: Readonly<Record<string, CodegenSourceSpan>>;
  outputDirectory?: string;
  seedArtifact?: Readonly<{ seedVersion: string; seedDigest: `sha256:${string}` }> | null;
  seedRowCount?: number | null;
}>): CodegenSummary;

export function formatCodegenSummary(summary: CodegenSummary): string;
