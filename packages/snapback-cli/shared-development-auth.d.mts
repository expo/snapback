// @ref LLP 0151#shared-development-browser-adapter — Public broker types mirror the governed shared-development auth adapter.
import type {
  SharedDevelopmentAuthProvider,
  SharedDevelopmentAuthStart,
} from '@expo/snapback-client/shared-development-auth';

export type {
  SharedDevelopmentAuthProvider,
  SharedDevelopmentAuthStart,
} from '@expo/snapback-client/shared-development-auth';

export {
  SHARED_DEVELOPMENT_AUTH_PROVIDERS,
  SHARED_DEVELOPMENT_AUTH_ROUTES,
  SHARED_DEVELOPMENT_AUTH_USER_LIMIT,
} from '@expo/snapback-client/shared-development-auth';

export interface SharedDevelopmentAuthAdmissionConfig {
  readonly allowSharedDevelopment?: boolean;
  readonly deploymentProfile?: string;
  readonly previewOwnerAuthenticated?: boolean;
  readonly previewExpiresAt?: string;
}

export function sharedDevelopmentAuthAdmitted(
  config: SharedDevelopmentAuthAdmissionConfig | null | undefined,
  nowMs?: number,
): boolean;

export interface SharedDevelopmentIdentityKeyInput {
  readonly appId: string;
  readonly providerInstallationId: string;
  readonly issuer: string;
  readonly subject: string;
}

export function sharedDevelopmentIdentityKey(
  input: SharedDevelopmentIdentityKeyInput,
): string;

export interface SharedDevelopmentBrokerIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly [key: string]: unknown;
}

export interface SharedDevelopmentAuthStartInput {
  readonly appId: string;
  readonly provider: SharedDevelopmentAuthProvider;
  readonly returnTo: string;
  readonly codeChallenge: string;
}

export interface SharedDevelopmentAuthRedeemInput {
  readonly appId: string;
  readonly code: string;
  readonly verifier: string;
}

export interface SharedDevelopmentAuthBroker<
  Identity extends SharedDevelopmentBrokerIdentity,
  Completion,
> {
  readonly start: (input: SharedDevelopmentAuthStartInput) => SharedDevelopmentAuthStart;
  readonly inspect: (
    transactionId: string,
  ) => Readonly<{ provider: SharedDevelopmentAuthProvider }>;
  readonly authorize: (transactionId: string) => string;
  readonly redeem: (input: SharedDevelopmentAuthRedeemInput) => Promise<Awaited<Completion>>;
  readonly admittedUserCount: () => number;
  readonly userLimit: number;
}

export interface SharedDevelopmentAuthBrokerOptions<
  Identity extends SharedDevelopmentBrokerIdentity,
  Completion,
> {
  readonly appId: string;
  readonly returnTargets: readonly string[];
  readonly identityFor: (provider: SharedDevelopmentAuthProvider) => Identity;
  readonly completeIdentity: (identity: Identity) => Completion | Promise<Completion>;
  readonly userLimit?: number;
  readonly transactionTtlMs?: number;
  readonly completionTtlMs?: number;
  readonly now?: () => number;
}

export function createSharedDevelopmentAuth<
  Identity extends SharedDevelopmentBrokerIdentity,
  Completion = unknown,
>(
  options: SharedDevelopmentAuthBrokerOptions<Identity, Completion>,
): SharedDevelopmentAuthBroker<Identity, Completion>;

export interface SharedDevelopmentRehearsalIdentity extends SharedDevelopmentBrokerIdentity {
  readonly provider: SharedDevelopmentAuthProvider;
  readonly displayName: string;
  readonly avatarUrl: '';
  readonly realm: 'rehearsal';
}

export function sharedDevelopmentRehearsalIdentity(
  provider: SharedDevelopmentAuthProvider,
  options?: Readonly<{ appId?: string; seed?: string }>,
): SharedDevelopmentRehearsalIdentity;
