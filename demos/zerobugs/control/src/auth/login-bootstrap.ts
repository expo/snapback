export type LoginBootstrapExchange = Readonly<{
  challengeId: string;
  code: string;
}>;

export function parseLoginBootstrapExchange(value: unknown): LoginBootstrapExchange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('login bootstrap response must be an object');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join('\0') !== 'challengeId\0code'
    || typeof record.challengeId !== 'string'
    || !/^sbc_[A-Za-z0-9._~-]+$/u.test(record.challengeId)
    || typeof record.code !== 'string'
    || !/^\d{6}$/u.test(record.code)
  ) {
    throw new TypeError('login bootstrap response was malformed');
  }
  return Object.freeze({challengeId: record.challengeId, code: record.code});
}

export async function fetchLoginBootstrap(): Promise<LoginBootstrapExchange | null> {
  const response = await fetch('/api/auth/bootstrap', {
    method: 'POST',
    headers: {accept: 'application/json'},
    credentials: 'same-origin',
  });
  if (response.status === 204) return null;
  const value: unknown = await response.json();
  if (!response.ok) {
    const message = value && typeof value === 'object' && !Array.isArray(value)
      && typeof (value as Record<string, unknown>).error === 'string'
      ? (value as Record<string, string>).error
      : `login bootstrap was refused with HTTP ${response.status}`;
    throw new Error(`ZBUGS_LOGIN_BOOTSTRAP_REFUSED: ${message}`);
  }
  return parseLoginBootstrapExchange(value);
}
