// Type declarations for hosted-browser.mjs — the hosted app-browser entry
// point. Its public constructor has no bearer, operator, or agent-credential
// seam; every session uses AuthCoordinator custody and sender-constrained
// transport (LLP 0060 C1 / LLP 0077 browser custody).

import type { AuthCoordinator } from '@expo/snapback-contract/auth-coordinator';
import type { SnapbackClient } from './index.mjs';

/** The only options the hosted constructor permits; any other key throws. */
export interface HostedBrowserSnapbackClientOptions {
  /** Required: AuthCoordinator custody handle. */
  readonly authCoordinator: AuthCoordinator;
  readonly authClientProtocol?: number | null;
  readonly authInvalidationProtocol?: number | null;
  readonly authorityDescriptorProtocol?: number | null;
  readonly authorizedLeaseProtocol?: number | null;
  readonly clientStoreId?: string;
  readonly authCounterCeiling?: number;
}

/** Instances proxy the full SnapbackClient surface over an internal
 * sender-constrained client; the transport posture itself is immutable. */
export type HostedBrowserSnapbackClient = SnapbackClient & {
  readonly senderConstrained: true;
  /** Always throws: hosted browser custody cannot bypass
   * sender-constrained transport. */
  setBearerToken(): never;
};

export const HostedBrowserSnapbackClient: new (
  baseUrl: string,
  options: HostedBrowserSnapbackClientOptions,
) => HostedBrowserSnapbackClient;
