export declare const RUNTIME_READINESS_SCHEMA_VERSION: 'snapback.runtime-readiness.v1';
export declare const RUNTIME_READINESS_INVALID_CODE: 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID';

export declare function runtimeReadinessReceiptPath(binaryPath: string): string;

export interface RuntimeArtifactCandidate {
  readonly path: string;
  readonly relativePath: string;
}

export declare function runtimeArtifactCandidates(
  root: string,
  options?: { platform?: NodeJS.Platform }
): RuntimeArtifactCandidate[];

export interface RuntimeArtifactDigest {
  readonly relativePath: string;
  readonly sha256: string;
}

export declare function digestRuntimeArtifacts(
  root: string,
  options?: { platform?: NodeJS.Platform }
): RuntimeArtifactDigest[];

export interface RuntimeReadinessReceipt {
  readonly schemaVersion: typeof RUNTIME_READINESS_SCHEMA_VERSION;
  readonly issuedAt: string;
  readonly binarySha256: string;
  readonly artifacts: readonly RuntimeArtifactDigest[];
  readonly buildIdentity: Record<string, unknown>;
  readonly qualification: Record<string, unknown>;
}

export declare function issueRuntimeReadinessReceipt(options: {
  binaryPath: string;
  root: string;
  buildIdentity?: Record<string, unknown>;
  qualification: Record<string, unknown>;
  platform?: NodeJS.Platform;
}): RuntimeReadinessReceipt;

export interface RuntimeReadinessVerification {
  readonly ok: boolean;
  readonly reason?: string;
  readonly receipt?: RuntimeReadinessReceipt;
  readonly details?: Record<string, unknown>;
}

export declare function verifyRuntimeReadinessReceipt(options: {
  binaryPath: string;
  root: string;
  platform?: NodeJS.Platform;
}): RuntimeReadinessVerification;
