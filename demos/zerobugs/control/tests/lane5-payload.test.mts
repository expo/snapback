import {describe, expect, test} from 'bun:test';

import {renderIntentDeliveries} from '../composition/effects/payloads.mts';
import {verifyUnsubscribeToken} from '../composition/lib/tokens.mts';

const SECRET = 'lane5-payload-test-secret-at-least-sixteen';

function intent(visibility: 'public' | 'internal') {
  return {
    physicalID: 'intent-1',
    idempotencyKey: 'notification:commentAdd:client-1:mutation-1',
    trigger: 'commentAdd',
    kind: 'add-comment',
    issueID: 'issue-1',
    created: 1_700_000_000_000,
    payloadSnapshot: JSON.stringify({
      kind: 'add-comment',
      actor: {id: 'actor-1', login: 'actor'},
      issue: {
        id: 'issue-1', shortID: 42, title: 'A frozen defect',
        description: 'Description', visibility,
      },
      comment: {id: 'comment-1', body: 'A deterministic comment'},
    }),
    recipientSnapshot: JSON.stringify({
      actorSourceUserID: 'actor-1', includeActor: false,
      issueVisibility: visibility, issueShortID: 42,
      recipients: [{sourceUserID: 'recipient-1', email: 'r@example.invalid'}],
      discordEligible: visibility === 'public',
    }),
    discordEligible: visibility === 'public',
  } as const;
}

describe('Lane 5 inventory-exact effect rendering', () => {
  test('renders Loops headers/data, stable idempotency, and signed unsubscribe', () => {
    const deliveries = renderIntentDeliveries(intent('public'), {
      publicOrigin: 'http://127.0.0.1:4567',
      unsubscribeSecret: SECRET,
      loopsTransactionalID: 'transactional-1',
      expiresAt: 2_000_000_000,
    });
    expect(deliveries).toHaveLength(2);
    const email = deliveries[0];
    expect(email.idempotencyKey).toBe('client-1:mutation-1:r@example.invalid');
    expect(email.body).toMatchObject({
      email: 'r@example.invalid',
      transactionalId: 'transactional-1',
      addToAudience: true,
    });
    const variables = email.body.dataVariables as Record<string, unknown>;
    expect(variables.subject).toBe('#42 A frozen defect');
    expect(variables.link).toBe('http://127.0.0.1:4567/p/zero/issue/42.md#comment-comment-1');
    expect(variables['Message-ID']).toBe(variables['In-Reply-To']);
    const token = new URL(String(variables.unsubscribe)).searchParams.get('token')!;
    expect(verifyUnsubscribeToken(token, SECRET, 1_900_000_000)).toMatchObject({
      user: 'recipient-1', issue: 'issue-1', purpose: 'zerobugs.unsubscribe.v1',
    });
    expect(deliveries[1].body).toEqual({
      content: '**actor commented on an issue**\nA frozen defect\nA deterministic comment\n<http://127.0.0.1:4567/p/zero/issue/42.md#comment-comment-1>',
    });
  });

  test('internal issue rendering has email only', () => {
    const deliveries = renderIntentDeliveries(intent('internal'), {
      publicOrigin: 'http://localhost:4567',
      unsubscribeSecret: SECRET,
      loopsTransactionalID: 'transactional-1',
      expiresAt: 2_000_000_000,
    });
    expect(deliveries.map(item => item.channel)).toEqual(['email']);
  });
});
