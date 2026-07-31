export const EXACT_CONTRACT_PACKAGE: '@exact/contract';

/** A dynamically imported Exact module namespace. */
export type ExactContractModule = Record<string, unknown>;

export interface ExactContractExportResolution {
  packageName: '@exact/contract';
  packageRoot: string;
  packageJsonPath: string;
  subpath: string;
  specifier: string;
  path: string;
}

export function importExactContractCompiler(options?: {
  exactRoot?: string | null;
}): Promise<ExactContractModule>;

export function importExactContractRuntime(options?: {
  exactRoot?: string | null;
}): Promise<ExactContractModule>;

export function importExactContractConformance(options?: {
  exactRoot?: string | null;
}): Promise<ExactContractModule>;

export function importExactContractDeclaration(options?: {
  exactRoot?: string | null;
}): Promise<ExactContractModule>;

export function importExactContractDiagnostics(options?: {
  exactRoot?: string | null;
}): Promise<ExactContractModule>;

/**
 * Import an `@exact/contract` subpath from installed packages, falling back to
 * an Exact checkout's package exports. Throws an error carrying
 * `code: 'SNAPBACK_CAPABILITY_EXACT_PACKAGE_EXPORT_MISSING'` when unresolvable.
 */
export function importExactContractExport(
  subpath: string,
  options?: {
    exactRoot?: string | null;
    resolveSpecifier?: (specifier: string) => string;
  },
): Promise<ExactContractModule>;

export function resolveExactContractExport(
  subpath: string,
  options?: { exactRoot?: string | null },
): ExactContractExportResolution | null;
