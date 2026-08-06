import {expect, test} from 'bun:test';

import {
  SessionController,
  type SessionHandshake,
  type SessionIdentity,
} from '../src/auth/session';

function authenticated(): SessionHandshake {
  return {activeMode: 'sessions', authority: {kind: 'session', isAuthenticated: true, userId: 'principal'}};
}

test('session replacement blanks predecessor identity before successor publication', async () => {
  let current: SessionIdentity = {
    principal: 'principal-a', sourceUserID: 'source-a', githubID: 1, login: 'a', role: 'crew',
  };
  let release!: () => void;
  let replacement = Promise.resolve();
  const controller = new SessionController({
    client: {
      async authSession() { return authenticated(); },
      async authExchange() { throw new Error('not reached'); },
      async authLogout() { return null; },
      async replaceBearerToken() { await replacement; },
      async query() { return {rows: [current]}; },
    },
  });

  await controller.refresh();
  expect(controller.getSnapshot().current?.sourceUserID).toBe('source-a');

  replacement = new Promise<void>(resolve => { release = resolve; });
  current = {
    principal: 'principal-b', sourceUserID: 'source-b', githubID: 2, login: 'b', role: 'user',
  };
  const transition = controller.switchBearer('successor');
  expect(controller.getSnapshot().phase).toBe('transitioning');
  expect(controller.getSnapshot().current).toBeNull();
  release();
  await transition;
  expect(controller.getSnapshot().phase).toBe('authenticated');
  expect(controller.getSnapshot().current?.sourceUserID).toBe('source-b');

  controller.setConnection('stale');
  expect(controller.getSnapshot().offline).toBe('degraded');
  controller.setConnection('disconnected');
  expect(controller.getSnapshot().offline).toBe('offline');
});
