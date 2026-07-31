import type { SnapbackProviderDiagnostic } from './diagnostics.mjs';

/** Per-query descriptor in a generated Contract data manifest. */
export interface SnapbackContractQueryDescriptor {
  readonly ephemeral?: boolean;
  readonly livePush?: boolean;
  readonly mode?: string;
  readonly source?: Readonly<{
    file?: string;
    line?: number;
    column?: number;
    generatedFrom?: string;
  }>;
  readonly [key: string]: unknown;
}

export interface SnapbackContractMutationDescriptor {
  readonly plan?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

/** Generated `contractDataManifest` artifact (v1/v2). */
export interface SnapbackContractDataManifest {
  readonly artifactKind?: string;
  readonly manifestVersion?: number;
  readonly schemaVersion?: string;
  readonly inputsHash?: string;
  readonly schemaHash?: string;
  readonly bundleHash?: string;
  readonly provider?: string;
  readonly queries?: Readonly<Record<string, SnapbackContractQueryDescriptor>>;
  readonly mutations?: Readonly<Record<string, SnapbackContractMutationDescriptor>>;
  readonly [key: string]: unknown;
}

export interface SnapbackArtifactIndex {
  readonly schemaVersion?: string;
  readonly inputsHash?: string;
  readonly schemaHash?: string;
  readonly bundleHash?: string;
  readonly manifestVersion?: number;
  readonly functions?: readonly Readonly<{ name: string; kind: string }>[];
  readonly artifacts?: readonly string[];
  readonly files?: readonly Readonly<Record<string, unknown>>[];
  readonly [key: string]: unknown;
}

/** Contract data manifest versions this adapter accepts. */
export const SUPPORTED_CONTRACT_DATA_MANIFEST_VERSIONS: readonly number[];

export function validateSnapbackContractArtifacts(options?: {
  manifest?: SnapbackContractDataManifest | null;
  contractDataManifest?: SnapbackContractDataManifest | null;
  artifactIndex?: SnapbackArtifactIndex | null;
  schemaManifest?: Readonly<Record<string, unknown>> | null;
  functionManifest?: Readonly<Record<string, unknown>> | null;
  expectedManifestVersion?: number | null;
  expectedSchemaVersion?: string | null;
  expectedInputsHash?: string | null;
  expectedSchemaHash?: string | null;
  expectedBundleHash?: string | null;
}): SnapbackProviderDiagnostic[];
