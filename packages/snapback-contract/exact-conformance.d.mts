export const EXACT_PROVIDER_CONFORMANCE_CHECK_ID: 'data-provider-conformance';
export const SNAPBACK_EXACT_PROVIDER_CONFORMANCE_MISSING:
  'SNAPBACK_CAPABILITY_EXACT_PROVIDER_CONFORMANCE_MISSING';
export const EXACT_PROVIDER_CONFORMANCE_CANDIDATE_PATHS: readonly string[];

export interface ExactConformanceDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  subsystem: 'contract-integration';
  message: string;
  details: Record<string, unknown> & { target_surface: string };
}

export interface ExactVerifyCheckSummary {
  id: string;
  title: string | null;
  command: string | null;
  manual: boolean;
  artifacts: readonly unknown[];
  notes: string | null;
}

export interface ExactVerifySummary {
  path: string | null;
  present: boolean;
  schemaVersion?: string | null;
  check?: (ExactVerifyCheckSummary | { id: string; source: 'package-export' }) | null;
  relatedChecks?: ExactVerifyCheckSummary[];
  profiles?: { id: string; title: string | null }[];
  error?: string;
}

export interface ExactConformanceCandidate {
  source: 'package-export' | 'SNAPBACK_EXACT_PROVIDER_CONFORMANCE' | 'known-path';
  label: string;
  path: string;
  present: boolean;
}

export interface ExactProviderConformanceReport {
  ok: boolean;
  status: 'available' | 'candidate-found' | 'missing' | 'exact-missing';
  available: boolean;
  runnable: boolean;
  exactRoot: string;
  expectedCheckId: 'data-provider-conformance';
  exactVerify: ExactVerifySummary;
  candidates: ExactConformanceCandidate[];
  diagnostics: ExactConformanceDiagnostic[];
}

export function discoverExactProviderConformance(options?: {
  exactRoot?: string | null;
  providerConformancePath?: string | null;
}): ExactProviderConformanceReport;

export function conformanceDiagnostic(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ExactConformanceDiagnostic;
