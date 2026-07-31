export interface ExactSeverityDiagnostic {
  severity: string;
  code?: string;
  readonly [key: string]: unknown;
}

export interface ExactStaticImportSemantics {
  diagnostics: readonly ExactSeverityDiagnostic[];
  descriptors: unknown;
  readonly [key: string]: unknown;
}

export interface ExactCompiledContract {
  diagnostics: readonly ExactSeverityDiagnostic[];
  file: ExactContractFile;
  readonly [key: string]: unknown;
}

/** The members of Exact's compiler surface this module consumes. */
export interface ExactContractCompilerLike {
  parseContractSource(source: string, contractFile: string): unknown;
  compileContractSource(
    source: string,
    contractFile: string,
    options: {
      diagnosticsMode: 'accumulate';
      importBoundaryMode: 'project';
      importSemantics: unknown;
    },
  ): ExactCompiledContract;
  resolveStaticContractImportSemantics(
    parsed: unknown,
    options: { rootDir: string | null },
  ): ExactStaticImportSemantics;
}

export interface ExactContractRuntimeLike {
  doctorContractDataProject(input: {
    manifest: unknown;
    descriptorUses: readonly ExactDescriptorUse[];
    expectedInputsHash: string | null;
  }): ExactDoctorReport;
}

export interface ExactDoctorReport {
  ok: boolean;
  readonly [key: string]: unknown;
}

export interface ExactContractFileImport {
  spec?: unknown;
  span?: { line: number; col: number; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface ExactContractFile {
  sourcePath?: string;
  components?: readonly Readonly<{
    queries?: readonly Readonly<{ expr?: unknown }>[];
    mutations?: readonly Readonly<{ expr?: unknown }>[];
  }>[];
  imports?: Readonly<Record<string, ExactContractFileImport>>;
  readonly [key: string]: unknown;
}

export interface ExactDescriptorUse {
  kind: 'query' | 'mutation';
  name: string;
  spec: unknown;
  source?: { file: string | undefined; line: number; column: number };
}

export function checkSnapbackContractDescriptors(options: {
  compiler: ExactContractCompilerLike;
  runtime: ExactContractRuntimeLike;
  contractFile: string;
  manifest: unknown;
  expectedInputsHash?: string | null;
  exactRoot?: string | null;
}): {
  ok: boolean;
  staticSemantics: ExactStaticImportSemantics;
  compiled: ExactCompiledContract;
  descriptorUses: ExactDescriptorUse[];
  doctorReport: ExactDoctorReport;
};

export function assertGeneratedRowShapeIsChecked(options: {
  compiler: ExactContractCompilerLike;
  contractFile: string;
  mutateSource: (source: string) => string;
  exactRoot?: string | null;
}): {
  ok: boolean;
  diagnostic: ExactSeverityDiagnostic | null;
  diagnostics: readonly ExactSeverityDiagnostic[];
};

export function descriptorUsesFromContractFile(file: ExactContractFile): ExactDescriptorUse[];
