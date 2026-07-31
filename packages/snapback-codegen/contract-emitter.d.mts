// Type declarations for contract-emitter.mjs — the shared Contract
// binding-module emitter (runtime-links registry, per-binding modules, and
// .contract-meta sidecars).

export function generatedByHeader(generator?: string): string;

/** PascalCases an operation name and strips non-alphanumerics. */
export function pascal(value: string): string;

export function jsonLiteral(value: unknown): string;

/**
 * The runtime-links registry module: the typed link interface plus the
 * configure/reset/get triple every generated binding delegates through.
 */
export function renderRuntimeLinksModule(options: Readonly<{
  header: string;
  refLine?: string | null;
  linksBaseName: string;
  errorMessage: string;
  entries: ReadonlyArray<Readonly<{ name: string; argsType: string }>>;
}>): string;

/**
 * One per-binding module: descriptor const, rendered Args type, and the
 * callable that delegates through the links registry.
 */
export function renderBindingModule(options: Readonly<{
  header: string;
  refLine?: string | null;
  bindingComment?: string | null;
  name: string;
  argsType: string;
  linksBaseName: string;
}>): string;

/** The .contract-meta sidecar for a query binding. */
export function renderQueryMetaModule(options: Readonly<{
  header: string;
  name: string;
  reads: readonly string[];
  readMode: string;
  cacheKey: string;
  resultType?: string | null;
  shapeName?: string | null;
  shapeFields?: Readonly<Record<string, unknown>> | null;
  /** Pre-rendered `key: value` fact list appended to the query descriptor. */
  extraFacts?: string | null;
}>): string;

/** The .contract-meta sidecar for a mutation binding. */
export function renderMutationMetaModule(options: Readonly<{
  header: string;
  name: string;
  effects: readonly string[];
  invalidates: readonly string[];
}>): string;
