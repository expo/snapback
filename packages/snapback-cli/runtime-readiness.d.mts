export declare const RUNTIME_READINESS_SCHEMA_VERSION: 'snapback.runtime-readiness.v1';
export declare const RUNTIME_READINESS_INVALID_CODE: 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID';

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

export declare function digestRuntimeArtifacts(
  root: string,
  options?: { platform?: string; candidates?: readonly string[] | null }
): RuntimeArtifactDigest[];

export interface RuntimeReadinessReceipt {
  readonly schemaVersion: typeof RUNTIME_READINESS_SCHEMA_VERSION;
  readonly issuedAt: string;
  readonly issuer: string;
  readonly platform: string;
  readonly binary: Readonly<{ bytes: number; sha256: string }>;
  readonly artifacts: readonly RuntimeArtifactDigest[];
  readonly buildIdentity: Record<string, unknown> | null;
  readonly qualification: Record<string, unknown>;
}

export declare function issueRuntimeReadinessReceipt(options: {
  binaryPath: string;
  root: string;
  receiptPath?: string | null;
  qualification: Record<string, unknown>;
  issuer?: string;
  platform?: string;
  artifacts?: readonly RuntimeArtifactDigest[] | null;
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
