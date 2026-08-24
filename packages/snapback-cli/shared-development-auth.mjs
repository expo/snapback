// The broker half of the shared development auth completion protocol.
//
// `snapback dev` supervises this. It holds the transaction state, repeats
// admission from server-held state, enforces the user cap, and derives the
// app-scoped rehearsal identity. The client half — verifier generation,
// authorization-URL validation, callback reading — is in
// `@expo/snapback-client/shared-development-auth`.
//
// Nothing here is a real Apple or Google login. The identities are hermetic
// rehearsal identities issued by this process, and they carry a rehearsal
// realm that cannot enter a staging or production deployment.
//
// @ref LLP 0151#shared-development-browser-adapter — exact return
// allowlisting, one-use completion codes, client-held verifiers, app-scoped
// rehearsal identities, and a server-side user cap are all mechanism here, not
// client policy.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  SHARED_DEVELOPMENT_AUTH_PROVIDERS,
  SHARED_DEVELOPMENT_AUTH_ROUTES,
  SHARED_DEVELOPMENT_AUTH_USER_LIMIT,
  sharedDevelopmentAuthRefusal as refuse,
} from '@expo/snapback-client/shared-development-auth';

export {
  SHARED_DEVELOPMENT_AUTH_PROVIDERS,
  SHARED_DEVELOPMENT_AUTH_ROUTES,
  SHARED_DEVELOPMENT_AUTH_USER_LIMIT,
};

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const PROVIDERS = new Set(SHARED_DEVELOPMENT_AUTH_PROVIDERS);

/**
 * Server-side admission for the shared development profile.
 *
 * @ref LLP 0151#resolved-provider-entry — the client projection is not the
 * admission boundary. A modified bundle cannot promote itself into a shared
 * preview or enable shared auth in staging or production, because this
 * decision reads only state the broker holds.
 */
export function sharedDevelopmentAuthAdmitted(config, nowMs = Date.now()) {
  if (config?.allowSharedDevelopment !== true) return false;
  const deployment = config.deploymentProfile ?? 'development';
  if (deployment === 'development' || deployment === 'test') return true;
  if (deployment !== 'preview' || config.previewOwnerAuthenticated !== true) return false;
  const expiresAt = Date.parse(config.previewExpiresAt ?? '');
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

function opaque(prefix) {
  return `${prefix}_${randomBytes(24).toString('base64url')}`;
}

function challengeFor(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function equalText(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The app-scoped rehearsal subject. Derived from the app id, the development
 * provider installation, and the provider subject together, so the same shared
 * provider account is a different Snapback identity in every app.
 *
 * @ref LLP 0151#shared-development-browser-adapter — the broker does not use
 * email to link accounts, and two apps on the same shared provider never
 * receive the same Snapback identity.
 */
export function sharedDevelopmentIdentityKey({ appId, providerInstallationId, issuer, subject }) {
  return createHash('sha256')
    .update(`snapback.shared-development-identity.v1\n${JSON.stringify([
      appId, providerInstallationId, issuer, subject,
    ])}`)
    .digest('hex');
}

/**
 * The broker-side transaction store: start → authorize → redeem, once each.
 */
export function createSharedDevelopmentAuth({
  appId,
  returnTargets,
  identityFor,
  completeIdentity,
  userLimit = SHARED_DEVELOPMENT_AUTH_USER_LIMIT,
  transactionTtlMs = 5 * 60_000,
  completionTtlMs = 60_000,
  now = () => Date.now(),
}) {
  if (typeof appId !== 'string' || appId.length === 0) {
    throw refuse('app-binding-missing', 'shared development auth requires an app id');
  }
  if (!Array.isArray(returnTargets) || returnTargets.length === 0) {
    throw refuse(
      'return-target-missing',
      'shared development auth requires at least one exact return target',
    );
  }
  if (!Number.isSafeInteger(userLimit)
    || userLimit < 1
    || userLimit > SHARED_DEVELOPMENT_AUTH_USER_LIMIT) {
    throw refuse(
      'user-limit-invalid',
      `shared development auth userLimit must be an integer from 1 through ${SHARED_DEVELOPMENT_AUTH_USER_LIMIT}`,
    );
  }
  if (typeof identityFor !== 'function' || typeof completeIdentity !== 'function') {
    throw refuse(
      'identity-source-missing',
      'shared development auth requires identityFor and completeIdentity',
    );
  }
  const returns = new Set(returnTargets.map((value) => new URL(value).toString()));
  const transactions = new Map();
  const completions = new Map();
  const admittedUsers = new Set();

  function prune() {
    const timestamp = now();
    for (const [id, transaction] of transactions) {
      if (transaction.expiresAt <= timestamp) transactions.delete(id);
    }
    for (const [code, completion] of completions) {
      if (completion.expiresAt <= timestamp) completions.delete(code);
    }
  }

  function start(input) {
    prune();
    if (input?.appId !== appId) {
      throw refuse('app-binding-mismatch', 'shared development auth app binding does not match');
    }
    if (!PROVIDERS.has(input?.provider)) {
      throw refuse('provider-unsupported', 'shared development auth provider is unsupported', {
        allowed: SHARED_DEVELOPMENT_AUTH_PROVIDERS,
      });
    }
    let returnTo;
    try {
      returnTo = new URL(input?.returnTo).toString();
    } catch {
      throw refuse('return-target-invalid', 'shared development auth return target is not a URL');
    }
    // Exact-string allowlisting. The broker accepts a generated app binding and
    // a fixed provider name; it never accepts an arbitrary callback URL.
    if (!returns.has(returnTo)) {
      throw refuse(
        'return-target-not-allowlisted',
        'shared development auth return target is not allowlisted',
      );
    }
    if (!CHALLENGE_PATTERN.test(input?.codeChallenge ?? '')) {
      throw refuse('code-challenge-invalid', 'shared development auth code challenge is invalid');
    }
    const transactionId = opaque('sat');
    const state = opaque('sas');
    transactions.set(transactionId, {
      appId,
      provider: input.provider,
      returnTo,
      codeChallenge: input.codeChallenge,
      state,
      expiresAt: now() + transactionTtlMs,
    });
    return Object.freeze({
      transactionId,
      state,
      authorizationPath: `${SHARED_DEVELOPMENT_AUTH_ROUTES.authorize}?transaction=${encodeURIComponent(transactionId)}`,
      expiresAt: new Date(now() + transactionTtlMs).toISOString(),
    });
  }

  function inspect(transactionId) {
    prune();
    const transaction = transactions.get(transactionId);
    if (!transaction) {
      throw refuse('transaction-unavailable', 'shared development auth transaction is unavailable');
    }
    return Object.freeze({ provider: transaction.provider });
  }

  function authorize(transactionId) {
    prune();
    const transaction = transactions.get(transactionId);
    if (!transaction) {
      throw refuse('transaction-unavailable', 'shared development auth transaction is unavailable');
    }
    if (transaction.location) return transaction.location;
    const identity = identityFor(transaction.provider);
    const userKey = `${appId}\0${identity.issuer}\0${identity.subject}`;
    if (!admittedUsers.has(userKey) && admittedUsers.size >= userLimit) {
      throw refuse('user-limit-reached', 'shared development auth user limit reached', { userLimit });
    }
    admittedUsers.add(userKey);
    const code = opaque('sac');
    completions.set(code, Object.freeze({
      appId,
      identity,
      codeChallenge: transaction.codeChallenge,
      transactionId,
      expiresAt: now() + completionTtlMs,
    }));
    const location = new URL(transaction.returnTo);
    // The callback carries only state and a short-lived one-use code. No
    // provider token and no Snapback session credential crosses this URL.
    location.searchParams.set('code', code);
    location.searchParams.set('state', transaction.state);
    transaction.location = location.toString();
    return transaction.location;
  }

  async function redeem(input) {
    prune();
    const completion = completions.get(input?.code);
    if (!completion) {
      throw refuse(
        'completion-code-unavailable',
        'shared development auth completion code is unavailable',
      );
    }
    // Deleted before any check that can throw: one code redeems once, so a
    // replay after a failed verifier check finds nothing to replay.
    completions.delete(input.code);
    transactions.delete(completion.transactionId);
    if (input?.appId !== appId || completion.appId !== appId) {
      throw refuse('app-binding-mismatch', 'shared development auth app binding does not match');
    }
    if (typeof input?.verifier !== 'string'
      || !equalText(challengeFor(input.verifier), completion.codeChallenge)) {
      throw refuse(
        'verifier-mismatch',
        'shared development auth redemption verifier does not match',
      );
    }
    return completeIdentity(completion.identity);
  }

  return Object.freeze({
    start,
    inspect,
    authorize,
    redeem,
    admittedUserCount: () => admittedUsers.size,
    userLimit,
  });
}

/**
 * The hermetic rehearsal identity the shared development broker issues.
 *
 * This is deliberately not a provider login. It is a stable, app-scoped
 * fixture identity whose issuer names its own provenance, so nothing
 * downstream can mistake it for `accounts.google.com` or `appleid.apple.com`.
 */
export function sharedDevelopmentRehearsalIdentity(provider, { appId, seed = 'default' } = {}) {
  if (!PROVIDERS.has(provider)) {
    throw refuse('provider-unsupported', 'shared development auth provider is unsupported', {
      allowed: SHARED_DEVELOPMENT_AUTH_PROVIDERS,
    });
  }
  const subject = createHash('sha256')
    .update(`snapback.shared-development-rehearsal.v1\n${JSON.stringify([appId ?? '', provider, seed])}`)
    .digest('hex')
    .slice(0, 32);
  return Object.freeze({
    provider,
    issuer: `snapback-shared-development.invalid/${provider}`,
    subject,
    displayName: provider === 'apple' ? 'Apple Rehearsal User' : 'Google Rehearsal User',
    avatarUrl: '',
    realm: 'rehearsal',
  });
}
