// The one HTTP client for the Snapback headless admin API (`/_snapback/api/*`).
//
// The Contract admin-ui imports it as a workspace package, and the server also
// exposes the same file at `/_snapback/admin/client.mjs` for tooling — so client
// behavior (auth header, error shaping, verb set) has one implementation, which
// is where the diary-0005 casing bug class lived.
//
// The admin console is a *system app*: it talks to this privileged admin
// contract, never to ordinary app tables through generated application
// functions. That keeps it usable even when the app's own schema/functions
// are broken — the bootstrap property LLP 0017 requires.

const CONSOLE_STORAGE_KEY = 'snapback_console_credential_v1';
const LEGACY_MASTER_STORAGE_KEY = 'snapback_admin_token';
const CREDENTIAL_REDACTION = '[REDACTED]';

export class AdminClient {
  constructor(baseUrl, { token } = {}) {
    this.baseUrl = String(baseUrl ?? '').replace(/\/$/, '');
    // Explicit tokens are for headless callers and remain memory-only. Browser
    // callers use setToken(), which immediately exchanges the master for a
    // short-lived console credential before anything is persisted.
    this.masterToken = token ?? '';
    // Secret-read leases are operator-minted, process/reset bounded, and
    // intentionally memory-only. They are never restored from browser
    // storage and are attached only to response-bearing inspection calls.
    this.secretReadLease = '';
    const stored = this.masterToken ? null : storedConsoleCredential();
    this.consoleCredential = stored?.credential ?? '';
    this.consoleExpiresAtMs = stored?.expiresAtMs ?? 0;
    clearLegacyStoredMaster();
  }

  async setToken(token) {
    const masterToken = String(token ?? '').trim();
    if (!masterToken) {
      this.masterToken = '';
      this.#replaceConsoleCredential(null);
      return;
    }
    const minted = await this.#req(
      'POST',
      '/console/credential',
      undefined,
      { 'x-snapback-admin-token': masterToken },
      false,
      false,
      true,
    );
    const credential = projectConsoleCredential(minted, masterToken);
    if (!credential || credential.expiresAtMs <= Date.now()) {
      throw responseShapeError('console credential exchange returned an invalid credential');
    }
    this.masterToken = '';
    this.#replaceConsoleCredential(credential);
  }

  setSecretReadLease(lease) {
    this.secretReadLease = String(lease ?? '').trim();
  }

  // UI boundaries use the same projection as the transport. Returning a new
  // Error also drops hostile custom properties and a stack whose first line
  // might otherwise retain a reflected credential.
  sanitizeError(error) {
    return sanitizeAdminError(error, this.#knownSecrets());
  }

  async #req(
    method,
    path,
    body,
    explicitHeaders = {},
    includeCredential = true,
    includeSecretRead = false,
    preserveCredentialResponse = false,
  ) {
    const headers = { ...explicitHeaders };
    if (includeCredential && this.masterToken) {
      headers['x-snapback-admin-token'] = this.masterToken;
    } else if (includeCredential && this.#activeConsoleCredential()) {
      headers['x-snapback-console-credential'] = this.consoleCredential;
    }
    if (includeSecretRead && this.secretReadLease) {
      headers['x-snapback-secret-read-lease'] = this.secretReadLease;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    const requestSecrets = collectAdminSecrets(body, headers, this.#knownSecrets());
    let res;
    let text;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      text = await res.text();
    } catch (error) {
      throw sanitizeAdminError(error, requestSecrets);
    }
    // @ref LLP 0032#confirmed-defect-register — S5.D3: check status before
    //   trusting the body as JSON, so a proxy 502 HTML page surfaces as a
    //   structured diagnostic instead of a bare SyntaxError.
    let json = null;
    let parseError = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (error) {
        parseError = error;
      }
    }
    if (!res.ok) {
      const rawDiagnostic = json && json.diagnostic
        ? json.diagnostic
        : parseError
          ? { code: 'SNAPBACK_HTTP_ERROR', message: `HTTP ${res.status} with non-JSON body: ${bodySnippet(redactKnownSecrets(text, requestSecrets))}` }
          : { code: `HTTP_${res.status}`, message: text };
      const d = sanitizeErrorValue(rawDiagnostic, requestSecrets);
      const error = new Error(`${d.code}: ${d.message ?? ''}`);
      error.diagnostic = d;
      // Consoles branch on auth failures (token banner) — expose the status.
      error.status = res.status;
      throw error;
    }
    if (parseError) {
      const d = {
        code: 'SNAPBACK_RESPONSE_NOT_JSON',
        message: `HTTP ${res.status} response is not JSON: ${bodySnippet(redactKnownSecrets(text, requestSecrets))}`,
      };
      const error = new Error(`${d.code}: ${d.message}`);
      error.diagnostic = d;
      error.status = res.status;
      throw error;
    }
    // The credential exchange consumes its exact closed response internally.
    // Every public return value replaces a credential reflected by a broken
    // receiver, even on HTTP 2xx.
    return preserveCredentialResponse
      ? json
      : sanitizeKnownSecrets(json, requestSecrets);
  }

  #knownSecrets() {
    const secrets = new Set();
    addSecret(secrets, this.masterToken);
    addSecret(secrets, this.consoleCredential);
    addSecret(secrets, this.secretReadLease);
    return secrets;
  }

  #activeConsoleCredential() {
    if (!this.consoleCredential) return '';
    if (this.consoleExpiresAtMs > Date.now()) return this.consoleCredential;
    this.#replaceConsoleCredential(null);
    return '';
  }

  #replaceConsoleCredential(record) {
    this.consoleCredential = record?.credential ?? '';
    this.consoleExpiresAtMs = record?.expiresAtMs ?? 0;
    try {
      if (typeof localStorage === 'undefined') return;
      clearLegacyStoredMaster();
      if (record) {
        localStorage.setItem(CONSOLE_STORAGE_KEY, JSON.stringify(record));
      } else {
        localStorage.removeItem(CONSOLE_STORAGE_KEY);
      }
    } catch {
      // Storage may be unavailable (private mode, headless); the in-memory
      // derived capability still applies to this client.
    }
  }

  inspect() {
    return this.#req('GET', '/inspect', undefined, {}, true, true);
  }

  scanTable(table, limit = 50, offset = 0) {
    return this.#req(
      'GET',
      `/data/${encodeURIComponent(table)}?limit=${limit}&offset=${offset}`,
      undefined,
      {},
      true,
      true,
    );
  }

  runFunction(name, input) {
    return this.#req(
      'POST',
      `/functions/${encodeURIComponent(name)}/run`,
      input,
      {},
      true,
      true,
    );
  }

  tickCron() {
    return this.#req('POST', '/cron/tick');
  }

  runCronJob(name) {
    return this.#req('POST', `/cron/${encodeURIComponent(name)}/run`);
  }

  cleanupEphemeral() {
    return this.#req('POST', '/ephemeral/cleanup');
  }

  // @ref LLP 0036#status-model-and-app-visibility-d4 — the status primitive:
  // names and states only, never values. The Secrets surface renders this.
  configStatus() {
    return this.#req('GET', '/config/status');
  }

  verifyConfigEntry(entry) {
    return this.#req('POST', '/config/verify', { entry, source: 'http' });
  }
}

function storedConsoleCredential() {
  try {
    if (typeof localStorage === 'undefined') return null;
    clearLegacyStoredMaster();
    const raw = localStorage.getItem(CONSOLE_STORAGE_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw);
    const projected = projectConsoleCredential(record);
    if (!projected || projected.expiresAtMs <= Date.now()) {
      localStorage.removeItem(CONSOLE_STORAGE_KEY);
      return null;
    }
    return projected;
  } catch {
    return null;
  }
}

function clearLegacyStoredMaster() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LEGACY_MASTER_STORAGE_KEY);
    }
  } catch {
    // Best-effort migration when storage is unavailable.
  }
}

function responseShapeError(message) {
  const error = new Error(`SNAPBACK_RESPONSE_INVALID: ${message}`);
  error.diagnostic = { code: 'SNAPBACK_RESPONSE_INVALID', message };
  return error;
}

function projectConsoleCredential(value, forbiddenMaster = '') {
  if (!exactRecord(value, ['credential', 'expiresAtMs'])) return null;
  if (
    typeof value.credential !== 'string' ||
    !value.credential.startsWith('sbcc_') ||
    value.credential.length <= 'sbcc_'.length ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    value.expiresAtMs < 0
  ) {
    return null;
  }
  const projected = {
    credential: value.credential,
    expiresAtMs: value.expiresAtMs,
  };
  // @ref LLP 0058#c1-the-v1-custody-claim — an exact response shape still
  // fails closed when the derived value would persist its minting authority.
  if (forbiddenMaster && projected.credential.includes(forbiddenMaster)) return null;
  return projected;
}

function exactRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function normalizedFieldName(name) {
  return String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();
}

function sensitiveAdminField(name) {
  const normalized = normalizedFieldName(name);
  return normalized === 'authorization'
    || normalized === 'value'
    || normalized.endsWith('_value')
    || normalized === 'token'
    || normalized.endsWith('_token')
    || normalized === 'bearer'
    || normalized.endsWith('_bearer')
    || normalized === 'credential'
    || normalized.endsWith('_credential')
    || normalized === 'lease'
    || normalized.endsWith('_lease')
    || normalized === 'proof'
    || normalized.endsWith('_proof')
    || normalized === 'secret'
    || normalized.endsWith('_secret')
    || normalized === 'private_key'
    || normalized.endsWith('_private_key')
    || normalized === 'key_material'
    || normalized.endsWith('_key_material');
}

function addSecret(secrets, value) {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const text = String(value);
  // @ref LLP 0058#c1-the-v1-custody-claim — known operator carriers have no
  // redaction length floor, and secret-bearing success keys fail closed.
  // These values come from known secret-bearing carriers, not heuristic
  // discovery. Even a one-byte operator token or config value remains secret.
  if (text.length > 0) secrets.add(text);
}

function collectAdminSecrets(body, headers, initialSecrets = new Set()) {
  const secrets = new Set(initialSecrets);
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (sensitiveAdminField(name)) addSecret(secrets, value);
  }
  const visit = (value, field = null) => {
    if (sensitiveAdminField(field)) addSecret(secrets, value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, field);
    } else if (value && typeof value === 'object') {
      for (const [name, item] of Object.entries(value)) visit(item, name);
    }
  };
  visit(body);
  return secrets;
}

function redactKnownSecrets(value, secrets) {
  let redacted = String(value ?? '');
  const marker = safeRedactionMarker(secrets);
  const ordered = [...secrets].sort((left, right) => right.length - left.length);
  for (const secret of ordered) {
    redacted = redacted.replaceAll(secret, marker);
  }
  return redacted;
}

function safeRedactionMarker(secrets) {
  const candidates = [CREDENTIAL_REDACTION, '<redacted>', '***', '•••', ''];
  return candidates.find((candidate) => (
    [...secrets].every((secret) => !candidate.includes(secret))
  )) ?? '';
}

function sanitizeKnownSecrets(value, secrets, seen = new WeakSet()) {
  if (typeof value === 'string') return redactKnownSecrets(value, secrets);
  if (Array.isArray(value)) return value.map((item) => sanitizeKnownSecrets(item, secrets, seen));
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  const safe = {};
  for (const [name, item] of Object.entries(value)) {
    // Renaming a protocol property can change its meaning and can collide with
    // another key. Reject the successful response generically instead.
    if (redactKnownSecrets(name, secrets) !== name) {
      throw responseShapeError('response contained a protected property name');
    }
    safe[name] = sanitizeKnownSecrets(item, secrets, seen);
  }
  seen.delete(value);
  return safe;
}

function sanitizeErrorValue(value, secrets, field = null, seen = new WeakSet()) {
  if (sensitiveAdminField(field)) return safeRedactionMarker(secrets);
  if (typeof value === 'string') return redactKnownSecrets(value, secrets);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeErrorValue(item, secrets, field, seen));
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  const safe = Object.fromEntries(Object.entries(value).map(([name, item]) => [
    redactKnownSecrets(name, secrets),
    sanitizeErrorValue(item, secrets, name, seen),
  ]));
  seen.delete(value);
  return safe;
}

function sanitizeAdminError(error, secrets) {
  const safe = new Error(redactKnownSecrets(error?.message ?? String(error), secrets));
  safe.name = redactKnownSecrets(error?.name ?? 'Error', secrets);
  if (error?.code !== undefined) safe.code = sanitizeErrorValue(error.code, secrets);
  if (error?.status !== undefined) safe.status = sanitizeErrorValue(error.status, secrets);
  if (error?.diagnostic !== undefined) {
    safe.diagnostic = sanitizeErrorValue(error.diagnostic, secrets);
  }
  return safe;
}

function bodySnippet(text, limit = 200) {
  const collapsed = String(text ?? '').replace(/\s+/g, ' ').trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…`;
}
