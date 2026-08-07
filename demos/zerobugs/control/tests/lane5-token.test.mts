import {describe, expect, test} from 'bun:test';

import {
  signUnsubscribeToken,
  tokenDigest,
  verifyUnsubscribeToken,
} from '../composition/lib/tokens.mts';

const SECRET = 'lane5-token-test-secret-at-least-sixteen';

describe('Lane 5 purpose-bound unsubscribe capabilities', () => {
  test('round trips exact claims and has a stable digest', () => {
    const token = signUnsubscribeToken({user: 'user-1', issue: 'issue-1', exp: 2_000}, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET, 1_999)).toEqual({
      v: 1,
      purpose: 'zerobugs.unsubscribe.v1',
      user: 'user-1',
      issue: 'issue-1',
      exp: 2_000,
    });
    expect(tokenDigest(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenDigest(token)).toBe(tokenDigest(token));
  });

  test('refuses expiry, forgery, wrong secret, and noncanonical extra claims', () => {
    const token = signUnsubscribeToken({user: 'user-1', issue: 'issue-1', exp: 2_000}, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET, 2_001)).toBeNull();
    expect(verifyUnsubscribeToken(`${token.slice(0, -1)}x`, SECRET, 1_000)).toBeNull();
    expect(verifyUnsubscribeToken(token, 'different-secret-at-least-sixteen', 1_000)).toBeNull();
    const [payload] = token.split('.');
    const widened = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
      email: 'oracle@example.invalid',
    })).toString('base64url');
    expect(verifyUnsubscribeToken(`${widened}.${token.split('.')[1]}`, SECRET, 1_000)).toBeNull();
  });
});

