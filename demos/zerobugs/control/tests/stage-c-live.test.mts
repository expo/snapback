import {describe, expect, test} from 'bun:test';

import {authNetworkRequestFacts} from './acceptance/stage-c-live.mjs';

describe('Stage C browser auth request accounting', () => {
  test('counts only request-side auth traffic and isolates exchanges', () => {
    expect(authNetworkRequestFacts([
      {direction: 'request', method: 'GET', path: '/api/login/github'},
      {direction: 'response', status: 302, path: '/api/login/github'},
      {direction: 'request', method: 'POST', path: '/api/auth/bootstrap'},
      {direction: 'request', method: 'POST', path: '/__snapback/auth/exchange'},
      {direction: 'response', status: 200, path: '/__snapback/auth/exchange'},
      {direction: 'request', method: 'GET', path: '/__snapback/auth/session'},
      {direction: 'request', method: 'POST', path: '/__snapback/api/functions/commentAdd/run'},
    ])).toEqual({
      authRequests: 4,
      exchangeRequests: 1,
      bootstrapRequests: 1,
      oauthLoginRequests: 1,
    });
  });

  test('reports zero exchanges for reload, peer adoption, and ordinary mutations', () => {
    expect(authNetworkRequestFacts([
      {direction: 'request', method: 'GET', path: '/__snapback/auth/session'},
      {direction: 'request', method: 'POST', path: '/__snapback/api/functions/commentAdd/run'},
    ]).exchangeRequests).toBe(0);
  });
});
