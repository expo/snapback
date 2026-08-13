export type DeclarationSuggestionReasonCode =
  | 'SNAPBACK_AUTHORING_ANALYSIS_FAILED'
  | 'SNAPBACK_AUTHORING_ARRAY_BOUND_UNRESOLVED'
  | 'SNAPBACK_AUTHORING_CLASS_INSTANCE_UNSUPPORTED'
  | 'SNAPBACK_AUTHORING_COMPILER_CONTEXT_MISSING'
  | 'SNAPBACK_AUTHORING_DEFINITION_INVALID'
  | 'SNAPBACK_AUTHORING_HANDLER_NOT_FOUND'
  | 'SNAPBACK_AUTHORING_INDEX_SIGNATURE_UNSUPPORTED'
  | 'SNAPBACK_AUTHORING_NON_JSON_RETURN'
  | 'SNAPBACK_AUTHORING_NUMBER_REFINEMENT_UNRESOLVED'
  | 'SNAPBACK_AUTHORING_OPERATION_NOT_FOUND'
  | 'SNAPBACK_AUTHORING_RECURSIVE_RETURN_UNSUPPORTED'
  | 'SNAPBACK_AUTHORING_RESULT_SHAPE_UNSUPPORTED'
  | 'SNAPBACK_AUTHORING_RETURN_ANY_UNRESOLVED'
  | 'SNAPBACK_AUTHORING_RETURN_UNKNOWN_UNRESOLVED'
  | 'SNAPBACK_AUTHORING_STRING_BOUND_UNRESOLVED'
  | 'SNAPBACK_AUTHORING_SUGGESTION_INPUT_INVALID'
  | 'SNAPBACK_AUTHORING_UNION_UNSUPPORTED';

export type DeclarationSuggestionDiagnosticCode =
  | DeclarationSuggestionReasonCode
  | 'SNAPBACK_DECLARATION_SUGGESTION_STALE';

export const DECLARATION_SUGGESTION_REASON_CODES: readonly DeclarationSuggestionReasonCode[];

export interface DeclarationSuggestionDiagnosticV1 {
  readonly schemaVersion: 'snapback.declaration-suggestion-diagnostic.v1';
  readonly code: DeclarationSuggestionDiagnosticCode;
  readonly severity: 'info' | 'warning' | 'error';
  readonly subsystem: 'codegen';
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface DeclarationSuggestionHoleV1 {
  readonly schemaVersion: 'snapback.declaration-suggestion-hole.v1';
  readonly code: DeclarationSuggestionReasonCode;
  readonly path: string;
  readonly sourceExpression: string;
  readonly availableChoices: readonly string[];
}

export interface DeclarationSuggestionEvidenceV1 {
  readonly schemaVersion: 'snapback.declaration-suggestion-evidence.v1';
  readonly path: string;
  readonly sourceExpression: string;
  readonly contractExpression: string | null;
  readonly confidence: 'exact' | 'schema-derived' | 'widened' | 'unresolved';
  readonly basis: 'typescript' | 'schema-reference' | 'contract-normalization';
}

export interface DeclarationSuggestionPatchV1 {
  readonly schemaVersion: 'snapback.declaration-source-patch.v1';
  readonly file: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly beforeText: string;
  readonly afterText: string;
  readonly unifiedDiff: string;
}

export interface DeclarationSuggestionV1 {
  readonly schemaVersion: 'snapback.declaration-suggestion.v1';
  readonly artifactKind: 'declarationSuggestion';
  readonly ok: true;
  readonly status: 'exact' | 'schema-derived' | 'widened' | 'holed' | 'refused';
  readonly operation: Readonly<{
    schemaVersion: 'snapback.declaration-suggestion-operation.v1';
    id: string;
    name: string;
    kind: 'Query' | 'LiveQuery' | 'Mutation' | 'Action';
  }>;
  readonly source: Readonly<{
    schemaVersion: 'snapback.declaration-suggestion-source.v1';
    backend: string;
    definitionFile: string;
    definitionDigest: `sha256:${string}`;
    schemaDigest: `sha256:${string}`;
    generatedTypeDigest: `sha256:${string}`;
    moduleFormat: 'module' | 'commonjs';
  }>;
  readonly compiler: Readonly<Record<string, unknown>>;
  readonly analyzer: Readonly<Record<string, unknown>>;
  readonly analysisInputId: `sha256:${string}`;
  readonly analysisInputs: readonly Readonly<{
    schemaVersion: 'snapback.declaration-suggestion-input.v1';
    label: string;
    digest: `sha256:${string}`;
    kind: string;
  }>[];
  readonly runtimeEvidenceReceipts: readonly [];
  readonly declaration: Readonly<{
    schemaVersion: 'snapback.declaration-freeze.v1';
    before: string | null;
    after: string | null;
  }>;
  readonly evidence: readonly DeclarationSuggestionEvidenceV1[];
  readonly confidence: Readonly<{
    schemaVersion: 'snapback.declaration-suggestion-confidence.v1';
    counts: Readonly<{ exact: number; schemaDerived: number; widened: number; unresolved: number }>;
    proportions: Readonly<{ exact: number; schemaDerived: number; widened: number; unresolved: number }>;
    total: number;
  }>;
  readonly holes: readonly DeclarationSuggestionHoleV1[];
  readonly diagnostics: readonly DeclarationSuggestionDiagnosticV1[];
  readonly patch: DeclarationSuggestionPatchV1 | null;
  readonly semanticSummary: Readonly<{
    schemaVersion: 'snapback.declaration-semantic-summary.v1';
    runtimeValidation: string;
    generatedClientTypes: string;
    unresolvedHoles: number;
    checksAfterAcceptance: readonly string[];
  }>;
}

export interface DeclarationSuggestionResultV1 {
  readonly schemaVersion: 'snapback.declaration-suggestion-result.v1';
  readonly artifactKind: 'declarationSuggestionResult';
  readonly ok: boolean;
  readonly suggestions: readonly DeclarationSuggestionV1[];
  readonly diagnostics: readonly DeclarationSuggestionDiagnosticV1[];
}

export interface DeclarationSuggestionApplyResultV1 {
  readonly schemaVersion: 'snapback.declaration-suggestion-apply.v1';
  readonly artifactKind: 'declarationSuggestionApplyResult';
  readonly ok: boolean;
  readonly operationId: string | null;
  readonly analysisInputId: `sha256:${string}` | null;
  readonly path: string | null;
  readonly sourceDigest: `sha256:${string}` | null;
  readonly diagnostics: readonly DeclarationSuggestionDiagnosticV1[];
}

export function resolveDeclarationSuggestionTarget(
  target: string,
  options?: Readonly<{ cwd?: string }>,
): Readonly<{ backendDir: string; definitionFile: string; operation: string | null }> | null;

export function suggestDeclarations(options: Readonly<{
  backendDir: string;
  definitionFile?: string;
  operation?: string | null;
}>): DeclarationSuggestionResultV1;

export function formatDeclarationSuggestionPatch(result: DeclarationSuggestionResultV1): string;
export function applyDeclarationSuggestion(input: unknown): DeclarationSuggestionApplyResultV1;
export function readDeclarationSuggestionFile(path: string, options?: Readonly<{ cwd?: string }>): unknown;
