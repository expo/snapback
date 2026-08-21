export const HANDLER_RUNTIME_PROFILE_VERSION: 'snapback.handler-runtime-profile.v1';
export const HANDLER_ADMISSION_VERSION: 'snapback.handler-admission.legacy.v1';
export const HANDLER_GRAPH_RECORD_VERSION: 'snapback.handler-graph-record.v1';
export const HANDLER_GRAPH_EXTRACTOR_VERSION: 'snapback.inline-handler-extractor.v1';
export const HANDLER_RUNTIME_GUIDE: '/_snapback/guide/backend/handler-runtime.md';
export const FAMILIAR_HANDLER_DIALECT_GUIDE: '/_snapback/guide/backend/familiar-profile.md';

export interface HandlerRuntimeDiagnosticRule {
  readonly id: string;
  readonly code: string;
  readonly phase: 'static-admission' | 'definition-evaluation' | 'definition-discovery' | 'runtime-check';
  readonly alternative: string;
  readonly guideAnchor: string;
}

export const INLINE_HANDLER_RULES: Readonly<Record<string, unknown>>;
export const CLOSED_SCRIPT_HANDLER_RULES: Readonly<Record<string, unknown>>;
export const HANDLER_PROFILE_DIAGNOSTICS: readonly HandlerRuntimeDiagnosticRule[];
export function handlerRuleForCode(code: string): HandlerRuntimeDiagnosticRule | null;
export function handlerDiagnosticDetails(code: string): Readonly<{
  rule?: string;
  alternative?: string;
  guideAnchor?: string;
}>;
export function buildHandlerRuntimeProfile(input: Readonly<{
  appId: string;
  inputsHash: string;
  authoredSourceHash: string;
  targetProfile: string;
  functions: readonly Readonly<Record<string, unknown>>[];
  sourceFunctions?: readonly Readonly<Record<string, unknown>>[];
  graphRecords?: readonly Readonly<Record<string, unknown>>[];
  outboundActions?: boolean;
}>): Readonly<Record<string, unknown>>;
