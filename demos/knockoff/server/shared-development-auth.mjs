import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const PROVIDERS = new Set(['apple', 'google']);

// @ref LLP 0151#resolved-provider-entry — the broker repeats admission from
// server-held state so a modified bundle cannot enable rehearsal identities in
// a production deployment.
export function sharedDevelopmentAuthAdmitted(config, nowMs = Date.now()) {
  if (config.allowSharedDevelopment !== true) return false;
  const deployment = config.deploymentProfile ?? 'development';
  if (deployment === 'development') return true;
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

// @ref LLP 0151#shared-development-browser-adapter — shared credentials use
// one-use completion codes, client-held redemption verifiers, exact app
// bindings, and app-scoped rehearsal identities.
export function createSharedDevelopmentAuth({
  appId,
  returnTargets,
  identityFor,
  completeIdentity,
  userLimit = 100,
  transactionTtlMs = 5 * 60_000,
  completionTtlMs = 60_000,
  now = () => Date.now(),
}) {
  if (typeof appId !== 'string' || appId.length === 0) throw new TypeError('shared auth requires appId');
  if (!Array.isArray(returnTargets) || returnTargets.length === 0) {
    throw new TypeError('shared auth requires at least one exact return target');
  }
  if (!Number.isSafeInteger(userLimit) || userLimit < 1 || userLimit > 100) {
    throw new TypeError('shared auth userLimit must be an integer from 1 through 100');
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
    if (input?.appId !== appId) throw new TypeError('shared auth app binding does not match');
    if (!PROVIDERS.has(input?.provider)) throw new TypeError('shared auth provider is unsupported');
    const returnTo = new URL(input?.returnTo).toString();
    if (!returns.has(returnTo)) throw new TypeError('shared auth return target is not allowlisted');
    if (!CHALLENGE_PATTERN.test(input?.codeChallenge ?? '')) {
      throw new TypeError('shared auth code challenge is invalid');
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
      authorizationPath: `/v1/shared/authorize?transaction=${encodeURIComponent(transactionId)}`,
      expiresAt: new Date(now() + transactionTtlMs).toISOString(),
    });
  }

  function inspect(transactionId) {
    prune();
    const transaction = transactions.get(transactionId);
    if (!transaction) throw new TypeError('shared auth transaction is unavailable');
    return Object.freeze({ provider: transaction.provider });
  }

  function authorize(transactionId) {
    prune();
    const transaction = transactions.get(transactionId);
    if (!transaction) throw new TypeError('shared auth transaction is unavailable');
    if (transaction.location) return transaction.location;
    const identity = identityFor(transaction.provider);
    const userKey = `${appId}\0${identity.issuer}\0${identity.subject}`;
    if (!admittedUsers.has(userKey) && admittedUsers.size >= userLimit) {
      throw new TypeError('shared auth development user limit reached');
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
    location.searchParams.set('code', code);
    location.searchParams.set('state', transaction.state);
    transaction.location = location.toString();
    return transaction.location;
  }

  async function redeem(input) {
    prune();
    const completion = completions.get(input?.code);
    if (!completion) throw new TypeError('shared auth completion code is unavailable');
    completions.delete(input.code);
    transactions.delete(completion.transactionId);
    if (input?.appId !== appId || completion.appId !== appId) {
      throw new TypeError('shared auth app binding does not match');
    }
    if (typeof input?.verifier !== 'string' || !equalText(challengeFor(input.verifier), completion.codeChallenge)) {
      throw new TypeError('shared auth redemption verifier does not match');
    }
    return completeIdentity(completion.identity);
  }

  return Object.freeze({ start, inspect, authorize, redeem });
}
