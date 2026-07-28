// Exact provider credential-role and resource admission.
//
// @ref LLP 0111#durable-spend-cleanup-and-credential-custody — a credential
// role authorizes only its closed provider verb and exact bound resource.

import { SupervisorRefusal } from './index.mjs';

const ROLE_POLICIES = Object.freeze({
  flyControl: Object.freeze({
    aliases: Object.freeze(['flyControl', 'fly-control']),
    verbs: Object.freeze(['control']),
    provider: 'fly',
  }),
  tigrisControlState: Object.freeze({
    aliases: Object.freeze(['tigrisControlState', 'tigris-control-state', 'control-state']),
    verbs: Object.freeze(['s3:GetObject', 's3:PutObject']),
    provider: 'tigris',
  }),
});

function refuse(message) {
  throw new SupervisorRefusal('SNAPBACK_SUPERVISOR_CREDENTIAL_INVALID', message);
}

export function providerSecretPath(reference, suffix = '') {
  let parsed;
  try {
    parsed = new URL(reference);
  } catch {
    refuse('provider credential reference is malformed');
  }
  const stem = parsed.pathname.replace(/^\//, '');
  if (
    parsed.protocol !== 'provider-secret:'
    || parsed.host !== 'supervisor'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(stem)
  ) {
    refuse('provider credential reference is outside supervisor secret custody');
  }
  return `/run/secrets/${stem}${suffix}`;
}

function exactFlyResources(binding) {
  return new Set([
    binding.appId,
    `fly://apps/${binding.appId}`,
  ]);
}

function exactTigrisPrefix(binding) {
  if (
    typeof binding.tigrisBucket !== 'string'
    || typeof binding.controlStatePrefix !== 'string'
    || binding.controlStatePrefix.length < 1
    || binding.controlStatePrefix.startsWith('/')
    || binding.controlStatePrefix.includes('..')
  ) {
    refuse('Tigris control-state bucket or prefix is invalid');
  }
  return `s3://${binding.tigrisBucket}/${binding.controlStatePrefix}`;
}

export function credentialBindingFor({
  binding,
  role,
  requiredVerb,
  objectKey = null,
}) {
  const policy = ROLE_POLICIES[role];
  if (!policy) refuse(`unknown provider credential role ${role}`);
  const candidates = binding.credentials?.filter(
    ({ role: candidate }) => policy.aliases.includes(candidate),
  ) ?? [];
  const [credential] = candidates;
  if (
    candidates.length !== 1
    || !credential
    || !credential.allowedVerbs.includes(requiredVerb)
    || !policy.verbs.includes(requiredVerb)
  ) {
    refuse(`target binding lacks ${role} ${requiredVerb} authority`);
  }

  if (policy.provider === 'fly') {
    const allowed = exactFlyResources(binding);
    if (
      credential.resourcePrefixes.length !== 1
      || !allowed.has(credential.resourcePrefixes[0])
    ) {
      refuse('Fly control credential is not bound to the exact target app');
    }
    return credential;
  }

  const exactPrefix = exactTigrisPrefix(binding);
  if (
    credential.resourcePrefixes.length !== 1
    || credential.resourcePrefixes[0] !== exactPrefix
    || typeof objectKey !== 'string'
    || objectKey !== binding.externalHeadKey
    || !objectKey.startsWith(binding.controlStatePrefix)
    || objectKey.includes('..')
  ) {
    refuse('Tigris control credential is not bound to the exact bucket, prefix, and object key');
  }
  return credential;
}

export const __providerCredentialsTest = Object.freeze({ ROLE_POLICIES });
