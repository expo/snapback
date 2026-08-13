export declare const RUNTIME_READINESS_SCHEMA_VERSION: 'snapback.runtime-readiness.v1';
export declare const RUNTIME_READINESS_INVALID_CODE: 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID';
export declare const RUNTIME_PACKAGE_QUALIFICATION_FAILED_CODE: 'SNAPBACK_RUNTIME_PACKAGE_QUALIFICATION_FAILED';
export declare const RUNTIME_PACKAGE_RECEIPT_FILENAME: 'runtime-readiness.json';

export declare function runtimeReadinessReceiptPath(binaryPath: string): string;

export declare function runtimeArtifactCandidates(
  root: string,
  options?: { platform?: string }
): string[];

export interface RuntimeArtifactDigest {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface PreparedRuntimeReuseIdentity {
  readonly schemaVersion: 'snapback.prepared-runtime-reuse.v1';
  readonly source: Readonly<{ entryCount: number; sha256: string }>;
  readonly qualification: Readonly<{
    entryCount: number;
    sha256: string;
    inputs: readonly string[];
    probe: 'restricted-no-eval-handler-vm';
  }>;
  readonly toolchain: Readonly<{
    cargo: string;
    cc: string;
    cxx: string;
    node: string;
    rustc: string;
    hostTarget: string | null;
  }>;
  readonly platform: string;
  readonly buildEnvironment: Readonly<Record<string, string>>;
  readonly closureSha256: string;
}

export declare function digestRuntimeArtifacts(
  root: string,
  options?: { platform?: string; candidates?: readonly string[] | null }
): RuntimeArtifactDigest[];

export declare function packagedRuntimeArtifactCandidates(
  root: string,
  options?: { platform?: string }
): string[];

export declare function runtimePackageReceiptPath(root: string): string;

export interface RuntimeReadinessReceipt {
  readonly schemaVersion: typeof RUNTIME_READINESS_SCHEMA_VERSION;
  readonly issuedAt: string;
  readonly issuer: string;
  readonly platform: string;
  readonly binary: Readonly<{ bytes: number; sha256: string }>;
  readonly artifacts: readonly RuntimeArtifactDigest[];
  readonly buildIdentity: Record<string, unknown> | null;
  readonly qualification: Record<string, unknown>;
  readonly preparedRuntime?: PreparedRuntimeReuseIdentity;
  readonly sourceRevision?: string;
  readonly packageName?: string;
}

export declare function issueRuntimeReadinessReceipt(options: {
  binaryPath: string;
  root: string;
  receiptPath?: string | null;
  qualification: Record<string, unknown>;
  issuer?: string;
  platform?: string;
  artifacts?: readonly RuntimeArtifactDigest[] | null;
  buildIdentity?: Record<string, unknown> | null;
  sourceRevision?: string | null;
  packageName?: string | null;
  platformId?: string | null;
  preparedRuntime?: PreparedRuntimeReuseIdentity | null;
}): { receipt: RuntimeReadinessReceipt; receiptPath: string };

export interface RuntimeReadinessVerification {
  readonly ok: boolean;
  readonly reason: string;
  readonly receipt: RuntimeReadinessReceipt | null;
  readonly receiptPath: string;
  readonly diagnostic: Record<string, unknown> | null;
}

export declare function verifyRuntimeReadinessReceipt(options: {
  binaryPath: string;
  root: string;
  receiptPath?: string | null;
  platform?: string;
  artifacts?: readonly RuntimeArtifactDigest[] | null;
}): RuntimeReadinessVerification;

export declare function verifyRuntimePackageSeal(options: {
  root: string;
  binaryPath: string;
  packageName: string;
  platform: string;
  architecture: string;
  receiptPath?: string | null;
}): RuntimeReadinessVerification;

export declare function produceRuntimePackageSeal(options: {
  root: string;
  binaryPath: string;
  packageName: string;
  platform: string;
  architecture: string;
  buildIdentity: Record<string, unknown>;
  sourceRevision: string;
  environment?: Record<string, string | undefined>;
  qualification?: Record<string, unknown> | null;
  issuer?: string;
}): {
  receipt: RuntimeReadinessReceipt;
  receiptPath: string;
  verification: RuntimeReadinessVerification;
};
