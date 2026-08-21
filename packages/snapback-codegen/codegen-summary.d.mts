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
  readonly fieldBoundary?: Readonly<{
    fields: readonly string[];
    condition: string;
  }>;
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

export interface MigrationAdvisoryGroup {
  readonly code: 'SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING';
  readonly repairClass: string;
  readonly affectedTableCount: number;
  readonly affectedTables: readonly string[];
  readonly affectedOperationCount: number;
  readonly affectedOperations: readonly string[];
  readonly occurrences: number;
  readonly detailSurfaces: readonly [
    '--json diagnostics',
    'generated/authorization-review.json#writePolicyChecks',
  ];
}

export interface TableVisibilitySummary {
  readonly declared: ReadonlyArray<Readonly<{
    table: string;
    kind: 'public-read' | 'owner' | 'membership' | 'any-of';
  }>>;
  readonly implicit: readonly string[];
  readonly counts: Readonly<{
    total: number;
    declared: number;
    implicit: number;
    publicRead: number;
    owner: number;
    membership: number;
    anyOf: number;
  }>;
}

export interface FieldBoundarySummaryEntry {
  readonly function: string;
  readonly fields: readonly string[];
  readonly condition: string;
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
    migrationAdvisories?: number;
    implicitAuthRequirements: number;
    degradedResults: number;
    fieldBoundaries: number;
    seedRows?: number | null;
  }>;
  readonly tableVisibility: TableVisibilitySummary;
  /** Human-output groups only; per-site facts remain in diagnostics and the
   * authorization-review writePolicyChecks projection. */
  readonly migrationAdvisories?: readonly MigrationAdvisoryGroup[];
  /** Opaque JavaScript handler claims: handler-enforced review declarations,
   * not mechanically proven field-level policies. */
  readonly fieldBoundaries: readonly FieldBoundarySummaryEntry[];
  readonly implicitAuthRequirements: readonly ImplicitAuthRequirementEntry[];
  readonly degradedResults: readonly DegradedResultEntry[];
  readonly seed?: Readonly<{ version: string; digest: `sha256:${string}`; rows: number | null }>;
}

export function createCodegenSummary(options: Readonly<{
  appId: string;
  inputsHash: string;
  tables: Readonly<Record<string, Readonly<{
    visibility?: Readonly<{ kind: 'public-read' | 'owner' | 'membership' }>;
    [fact: string]: unknown;
  }>>>;
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

export function groupedCodegenSummaryDiagnosticCodes(
  summary: CodegenSummary | null | undefined,
): ReadonlySet<string>;
