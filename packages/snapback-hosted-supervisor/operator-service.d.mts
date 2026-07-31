// Type declarations for operator-service.mjs — public/operator mTLS admission
// and the canonical provider lifecycle transaction bridge.

import type { HostedSupervisor } from './index.mjs';
import type { SupervisorRequestV1 } from './operator-authority.mjs';
import type { SupervisorResponseSigner } from './supervisor-response.mjs';
import type {
  ProviderLifecycleExecutor,
  ProviderLifecycleOperation,
} from './provider-executor.mjs';

/**
 * Refuses (throws OperatorAuthorityRefusal) unless the raw mTLS client
 * certificate digest matches the signed request; returns true otherwise.
 */
export function assertOperatorCertificateBinding(
  request: SupervisorRequestV1,
  peerCertificateRaw: Uint8Array,
): true;

export interface OperatorRequestService {
  /**
   * Admit one signed operator request over its bound client certificate,
   * execute (or exactly replay) it, and return the retained response.
   */
  execute(
    request: SupervisorRequestV1,
    options?: Readonly<{
      peerCertificateRaw?: Uint8Array;
      nowMs?: number;
    }>,
  ): Promise<unknown>;
}

export function createOperatorRequestService(options: {
  responseSigner: SupervisorResponseSigner;
  providerExecutor: ProviderLifecycleExecutor;
  createSupervisor: () => HostedSupervisor;
  persistSupervisor: (supervisor: HostedSupervisor) => unknown | Promise<unknown>;
}): OperatorRequestService;

export const __operatorServiceTest: Readonly<{
  LIFECYCLE_BODY_KEYS: readonly string[];
  VARIANT_OPERATIONS: Readonly<Record<string, readonly ProviderLifecycleOperation[]>>;
  effectIntentForJournal: (lifecycleRequest: Readonly<{
    requestSha256: string;
    effectIntent: Readonly<Record<string, unknown>>;
    [member: string]: unknown;
  }>) => Readonly<Record<string, unknown>>;
}>;
