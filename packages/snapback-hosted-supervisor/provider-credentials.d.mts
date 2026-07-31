// Type declarations for provider-credentials.mjs — exact provider
// credential-role and resource admission.

import type { FlyTargetBinding, FlyTargetBindingCredential } from './index.mjs';

export type ProviderCredentialRole = 'flyControl' | 'tigrisControlState';
export type ProviderCredentialVerb = 'control' | 's3:GetObject' | 's3:PutObject';

/**
 * Resolves a `provider-secret://supervisor/<stem>` reference to its
 * `/run/secrets/<stem><suffix>` path; refuses anything outside supervisor
 * secret custody.
 */
export function providerSecretPath(reference: string, suffix?: string): string;

/**
 * Returns the single credential binding that authorizes exactly the requested
 * role/verb against the exact bound resource; refuses (throws
 * SupervisorRefusal) otherwise. `objectKey` is required for Tigris
 * control-state access and must equal the binding's external head key.
 */
export function credentialBindingFor(options: Readonly<{
  binding: FlyTargetBinding;
  role: ProviderCredentialRole;
  requiredVerb: ProviderCredentialVerb;
  objectKey?: string | null;
}>): FlyTargetBindingCredential;

export const __providerCredentialsTest: Readonly<{
  ROLE_POLICIES: Readonly<Record<ProviderCredentialRole, Readonly<{
    aliases: readonly string[];
    verbs: readonly ProviderCredentialVerb[];
    provider: 'fly' | 'tigris';
  }>>>;
}>;
