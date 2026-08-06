import {describe, expect, test} from 'bun:test';

import {
  EnvelopeError,
  MUTATION_NAMES,
  QUERY_NAMES,
  parseMutationEnvelope,
  parseQueryEnvelope,
} from '../composition/lib/envelopes.mts';

describe('Lane 5 frozen gateway envelopes', () => {
  test('accounts for the exact closed 19-query and 16-mutator corpus', () => {
    expect(QUERY_NAMES).toHaveLength(19);
    expect(new Set(QUERY_NAMES).size).toBe(19);
    expect(MUTATION_NAMES).toHaveLength(16);
    expect(new Set(MUTATION_NAMES).size).toBe(16);
  });

  test('accepts only exact query envelopes', () => {
    expect(parseQueryEnvelope({
      version: 'zerobugs.query.v1',
      name: 'issueDetail',
      args: {idField: 'shortID', id: 1},
    }).name).toBe('issueDetail');
    for (const value of [
      null,
      {version: 'zerobugs.query.v1', name: 'fixtureInspectTable', args: {}},
      {version: 'zerobugs.query.v1', name: 'issueDetail', args: {}, auth: {role: 'crew'}},
      {version: 'zerobugs.query.v2', name: 'issueDetail', args: {}},
    ]) expect(() => parseQueryEnvelope(value)).toThrow(EnvelopeError);
  });

  test('accepts exact mutation identity and refuses widening', () => {
    const parsed = parseMutationEnvelope({
      version: 'zerobugs.mutation.v1',
      name: 'notification.update',
      args: {issueID: 'i', subscribed: 'unsubscribe', created: 1},
      clientID: 'client-1',
      mutationID: 'mutation-1',
    });
    expect(parsed.name).toBe('notification.update');
    expect(() => parseMutationEnvelope({...parsed, name: 'fixtureIngestBatch'})).toThrow(EnvelopeError);
    expect(() => parseMutationEnvelope({...parsed, userID: 'caller-selected'})).toThrow(EnvelopeError);
    expect(() => parseMutationEnvelope({...parsed, clientID: ''})).toThrow(EnvelopeError);
  });
});

