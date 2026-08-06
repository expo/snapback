import {expect, test} from 'bun:test';

import {
  LoginBootstrapRegistry,
  loginBootstrapCookieName,
} from '../composition/lib/login-bootstrap.mts';
import {
  SessionController,
  getSessionController,
  type SessionClient,
  type SessionHandshake,
} from '../src/auth/session';
import {parseLoginBootstrapExchange} from '../src/auth/login-bootstrap';

const token = 'a'.repeat(43);
const exchange = Object.freeze({
  challengeId: `sbc_${'b'.repeat(32)}`,
  code: '012345',
});

function authenticated(): SessionHandshake {
  return {
    activeMode: 'sessions',
    authority: {kind: 'session', isAuthenticated: true, userId: 'principal'},
  };
}

test('login bootstrap registry is bounded, expiring, and one-use', () => {
  const registry = new LoginBootstrapRegistry(1);
  registry.stage(token, exchange, 2_000, 1_000);
  expect(registry.size).toBe(1);
  expect(registry.consume(token, 1_999)).toEqual(exchange);
  expect(registry.consume(token, 1_999)).toBeNull();

  registry.stage(token, exchange, 3_000, 2_000);
  expect(registry.consume(token, 3_000)).toBeNull();
  expect(registry.size).toBe(0);
  expect(loginBootstrapCookieName('http:')).toBe('zerobugs-login-bootstrap');
  expect(loginBootstrapCookieName('https:')).toBe('__Host-zerobugs-login-bootstrap');
});

test('browser exchange parser accepts only the closed challenge/code artifact', () => {
  expect(parseLoginBootstrapExchange(exchange)).toEqual(exchange);
  expect(() => parseLoginBootstrapExchange({...exchange, token: 'must-not-pass'})).toThrow(
    'login bootstrap response was malformed',
  );
  expect(() => parseLoginBootstrapExchange({...exchange, code: '12345'})).toThrow(
    'login bootstrap response was malformed',
  );
});

test('session bootstrap exchanges through coordinator custody before identity publication', async () => {
  const events: string[] = [];
  let releaseBootstrap!: () => void;
  const bootstrapGate = new Promise<void>(resolve => { releaseBootstrap = resolve; });
  const controller = new SessionController({
    loadLoginBootstrap: async () => {
      events.push('bootstrap');
      await bootstrapGate;
      return exchange;
    },
    client: {
      async authExchange(observed) {
        events.push('exchange');
        expect(observed).toEqual(exchange);
      },
      async authSession() {
        events.push('session');
        return authenticated();
      },
      async authLogout() { return null; },
      async replaceBearerToken() { throw new Error('external bearer path must not run'); },
      async query() {
        events.push('identity');
        return {rows: [{
          principal: 'principal',
          sourceUserID: 'source-user',
          githubID: 42,
          login: 'zerobot',
          role: 'user',
        }]};
      },
    },
  });

  const first = controller.bootstrap();
  const strictModeReplay = controller.bootstrap();
  expect(strictModeReplay).toBe(first);
  releaseBootstrap();
  await Promise.all([first, strictModeReplay]);
  expect(events).toEqual(['bootstrap', 'exchange', 'session', 'identity']);
  expect(controller.getSnapshot().phase).toBe('authenticated');
  expect(controller.getSnapshot().current?.login).toBe('zerobot');
});

test('fresh controller restores a constructor-provided persisted session without an exchange', async () => {
  class PersistedSessionClient implements SessionClient {
    readonly #persistedSession: SessionHandshake;
    exchanges = 0;
    sessionOptions: Array<Readonly<{force?: boolean}> | undefined> = [];

    constructor(persistedSession: SessionHandshake) {
      this.#persistedSession = persistedSession;
    }

    async authExchange() {
      this.exchanges += 1;
      throw new Error('persisted custody must not require a second exchange');
    }

    async authSession(options?: Readonly<{force?: boolean}>) {
      this.sessionOptions.push(options);
      return this.#persistedSession;
    }

    async authLogout() { return null; }
    async replaceBearerToken() { throw new Error('external bearer path must not run'); }
    async query() {
      return {rows: [{
        principal: 'principal',
        sourceUserID: 'source-user',
        githubID: 42,
        login: 'zerobot',
        role: 'user',
      }]};
    }
  }

  const client = new PersistedSessionClient(authenticated());
  const controller = new SessionController({
    client,
    loadLoginBootstrap: async () => null,
  });

  await controller.bootstrap();

  expect(client.exchanges).toBe(0);
  expect(client.sessionOptions).toEqual([{force: true}]);
  expect(controller.getSnapshot().phase).toBe('authenticated');
  expect(controller.getSnapshot().current?.sourceUserID).toBe('source-user');
});

test('StrictMode remount and an interleaved refresh share one controller and reach a terminal phase', async () => {
  const events: string[] = [];
  let releaseExchange!: () => void;
  let exchangeStarted!: () => void;
  const exchangeGate = new Promise<void>(resolve => { releaseExchange = resolve; });
  const started = new Promise<void>(resolve => { exchangeStarted = resolve; });
  const client: SessionClient = {
    async authExchange(observed) {
      events.push('exchange');
      expect(observed).toEqual(exchange);
      exchangeStarted();
      await exchangeGate;
    },
    async authSession() {
      events.push('session');
      return authenticated();
    },
    async authLogout() { return null; },
    async replaceBearerToken() { throw new Error('external bearer path must not run'); },
    async query() {
      events.push('identity');
      return {rows: [{
        principal: 'principal',
        sourceUserID: 'source-user',
        githubID: 42,
        login: 'zerobot',
        role: 'user',
      }]};
    },
  };
  const options = {
    client,
    loadLoginBootstrap: async () => exchange,
  };
  const firstMount = getSessionController(options);
  const unmount = firstMount.subscribe(() => {});
  const bootstrap = firstMount.bootstrap();
  await started;
  unmount();

  const secondMount = getSessionController(options);
  expect(secondMount).toBe(firstMount);
  const remount = secondMount.subscribe(() => {});
  expect(secondMount.bootstrap()).toBe(bootstrap);
  const successor = secondMount.refresh({blank: true});
  await successor;
  releaseExchange();
  await bootstrap;
  remount();

  expect(events.filter(event => event === 'exchange')).toHaveLength(1);
  expect(['authenticated', 'anonymous', 'error']).toContain(secondMount.getSnapshot().phase);
  expect(secondMount.getSnapshot().phase).toBe('authenticated');
});
