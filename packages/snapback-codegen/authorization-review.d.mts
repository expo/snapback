export const AUTHORIZATION_REVIEW_FILE: 'authorization-review.json';
export const AUTHORIZATION_REVIEW_SCHEMA_VERSION: 'snapback.authorization-review.v2';
export const AUTHORIZATION_REVIEW_SCHEMA_AUTHORITY: '@expo/snapback-codegen/authorization-review.schema.json';

export function createAuthorizationReview(input: Readonly<{
  appId: string;
  authMode: string;
  inputsHash: string;
  tables: Readonly<Record<string, unknown>>;
  functions: readonly Readonly<Record<string, unknown>>[];
  sourceFunctions?: readonly Readonly<Record<string, unknown>>[];
  uncomposedReadSurfaceDiagnostics?: readonly Readonly<Record<string, unknown>>[];
  summary: Readonly<Record<string, unknown>>;
  visibilityGovernance?: Readonly<Record<string, any>> | null;
  writePolicyChecks?: readonly Readonly<Record<string, unknown>>[];
}>): Readonly<Record<string, unknown>>;

export function serializeAuthorizationReview(value: unknown): string;
export function validateAuthorizationReview(value: unknown): string[];
export function formatTableVisibilityPolicy(policy: unknown): string;
export function classifyTableVisibilityChange(previous: unknown, current: unknown):
  'unchanged' | 'narrowing' | 'broadening' | 'incomparable';
export function renderAuthorizationReviewDiff(previous: any, current: any): string;
export function compareAuthorizationReviews(committedBytes: string | Uint8Array, candidate: unknown): Readonly<{
  current: boolean;
  problems: readonly string[];
  diff: string;
}>;
