export const LOGIN_BOOTSTRAP_COOKIE = 'zerobugs-login-bootstrap';
export const SECURE_LOGIN_BOOTSTRAP_COOKIE = '__Host-zerobugs-login-bootstrap';
export const LOGIN_BOOTSTRAP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type LoginBootstrapExchange = Readonly<{
  challengeId: string;
  code: string;
}>;

type LoginBootstrapEntry = Readonly<{
  exchange: LoginBootstrapExchange;
  expiresAtMs: number;
}>;

function validExchange(exchange: LoginBootstrapExchange): boolean {
  return /^sbc_[A-Za-z0-9._~-]+$/u.test(exchange.challengeId)
    && /^\d{6}$/u.test(exchange.code);
}

/**
 * Process-local, bounded custody for the OAuth-to-provider handoff. Consuming
 * an artifact deletes it before checking expiry, so every presented token is
 * one-shot even when it is stale.
 */
export class LoginBootstrapRegistry {
  readonly #entries = new Map<string, LoginBootstrapEntry>();
  readonly #maximumEntries: number;

  constructor(maximumEntries = 1_024) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
      throw new TypeError('login bootstrap maximumEntries must be a positive safe integer');
    }
    this.#maximumEntries = maximumEntries;
  }

  get size(): number {
    return this.#entries.size;
  }

  stage(
    token: string,
    exchange: LoginBootstrapExchange,
    expiresAtMs: number,
    nowMs = Date.now(),
  ): void {
    this.#prune(nowMs);
    if (!LOGIN_BOOTSTRAP_TOKEN_PATTERN.test(token)) {
      throw new TypeError('login bootstrap token is malformed');
    }
    if (!validExchange(exchange)) {
      throw new TypeError('login bootstrap exchange is malformed');
    }
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs) {
      throw new TypeError('login bootstrap expiry must be a future safe integer');
    }
    if (this.#entries.has(token)) {
      throw new TypeError('login bootstrap token was reused');
    }
    if (this.#entries.size >= this.#maximumEntries) {
      throw new Error('ZBUGS_LOGIN_BOOTSTRAP_CAPACITY: login bootstrap capacity was reached');
    }
    this.#entries.set(token, Object.freeze({
      exchange: Object.freeze({...exchange}),
      expiresAtMs,
    }));
  }

  consume(token: string | null, nowMs = Date.now()): LoginBootstrapExchange | null {
    if (token === null || !LOGIN_BOOTSTRAP_TOKEN_PATTERN.test(token)) return null;
    const entry = this.#entries.get(token);
    if (!entry) return null;
    this.#entries.delete(token);
    if (entry.expiresAtMs <= nowMs) return null;
    return entry.exchange;
  }

  #prune(nowMs: number): void {
    for (const [token, entry] of this.#entries) {
      if (entry.expiresAtMs <= nowMs) this.#entries.delete(token);
    }
  }
}

export function loginBootstrapCookieName(protocol: string): string {
  return protocol === 'https:'
    ? SECURE_LOGIN_BOOTSTRAP_COOKIE
    : LOGIN_BOOTSTRAP_COOKIE;
}
