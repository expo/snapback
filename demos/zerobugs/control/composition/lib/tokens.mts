import {createHash, createHmac, timingSafeEqual} from 'node:crypto';

export const UNSUBSCRIBE_PURPOSE = 'zerobugs.unsubscribe.v1' as const;

export type UnsubscribeClaims = Readonly<{
  v: 1;
  purpose: typeof UNSUBSCRIBE_PURPOSE;
  user: string;
  issue: string;
  exp: number;
}>;

const CLAIM_KEYS = ['exp', 'issue', 'purpose', 'user', 'v'] as const;

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function canonicalClaims(claims: UnsubscribeClaims): string {
  return JSON.stringify({
    exp: claims.exp,
    issue: claims.issue,
    purpose: claims.purpose,
    user: claims.user,
    v: claims.v,
  });
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 256;
}

export function signUnsubscribeToken(
  input: Readonly<{user: string; issue: string; exp: number}>,
  secret: string,
): string {
  if (!validIdentifier(input.user) || !validIdentifier(input.issue)) {
    throw new TypeError('unsubscribe claims require bounded user and issue identifiers');
  }
  if (!Number.isSafeInteger(input.exp) || input.exp < 1) {
    throw new TypeError('unsubscribe expiry must be a positive integer epoch second');
  }
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new TypeError('unsubscribe signing secret must contain at least 16 characters');
  }
  const claims: UnsubscribeClaims = {
    v: 1,
    purpose: UNSUBSCRIBE_PURPOSE,
    user: input.user,
    issue: input.issue,
    exp: input.exp,
  };
  const payload = base64url(canonicalClaims(claims));
  const signature = base64url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${signature}`;
}

export function verifyUnsubscribeToken(
  token: string,
  secret: string,
  nowEpochSeconds = Math.floor(Date.now() / 1_000),
): UnsubscribeClaims | null {
  if (
    typeof token !== 'string' || token.length > 2_048
    || typeof secret !== 'string' || secret.length < 16
    || !Number.isSafeInteger(nowEpochSeconds)
  ) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = createHmac('sha256', secret).update(parts[0]).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[1], 'base64url');
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join('\0') !== [...CLAIM_KEYS].sort().join('\0')
    || record.v !== 1
    || record.purpose !== UNSUBSCRIBE_PURPOSE
    || !validIdentifier(record.user)
    || !validIdentifier(record.issue)
    || !Number.isSafeInteger(record.exp)
    || (record.exp as number) < nowEpochSeconds
  ) return null;
  return record as UnsubscribeClaims;
}

export function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

