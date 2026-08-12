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
const REACHABILITY_STORAGE_PREFIX = 'snapback_reachability_credential_v1:';
const REACHABILITY_INDEX_KEY = 'snapback_reachability_sessions_v1';
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
    this.reachabilityCandidates = this.masterToken
      ? []
      : storedReachabilityCredentials(this.baseUrl);
    // A tab-scoped reachability record makes backend identity validation the
    // only restoration path for this origin. Never let an older ordinary
    // localStorage credential bypass that fail-closed check.
    const stored = this.masterToken || this.reachabilityCandidates.length
      ? null
      : storedConsoleCredential();
    if (this.reachabilityCandidates.length) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(CONSOLE_STORAGE_KEY);
      } catch {
        // The candidate still remains ineligible until both identity probes.
      }
    }
    this.consoleCredential = stored?.credential ?? '';
    this.consoleExpiresAtMs = stored?.expiresAtMs ?? 0;
    this.consoleProvenance = stored?.provenance ?? '';
    this.consoleReachability = null;
    this.reachabilityRestoreAttempted = false;
    this.consoleRenewalAttemptedAtMs = 0;
    this.consoleRenewalPromise = null;
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

  setConsoleCredential(credential, expiresAtMs) {
    const projected = projectConsoleCredential({ credential, expiresAtMs });
    if (!projected || projected.expiresAtMs <= Date.now()) {
      throw responseShapeError('console credential handoff was invalid or expired');
    }
    this.masterToken = '';
    this.#replaceConsoleCredential(projected);
  }

  async exchangeConsoleClaim(claimCode) {
    const code = String(claimCode ?? '').trim();
    if (!/^sbcl_[A-Fa-f0-9]{32}$/.test(code)) {
      throw responseShapeError('console claim code was invalid');
    }
    const exchanged = await this.#req(
      'POST',
      '/console/claim/exchange',
      { claimCode: code },
      {},
      false,
      false,
      false,
    );
    const credential = projectConsoleCredential(exchanged);
    if (
      !credential
      || credential.provenance !== 'operatorClaim'
      || credential.expiresAtMs <= Date.now()
    ) {
      throw responseShapeError('console claim exchange returned an invalid credential');
    }
    this.masterToken = '';
    this.#replaceConsoleCredential(credential);
    return { expiresAtMs: credential.expiresAtMs };
  }

  async requestConsoleApproval() {
    const response = await this.#req(
      'POST',
      '/console/approval/request',
      undefined,
      {},
      false,
      false,
    );
    if (!projectConsoleApprovalRequest(response)) {
      throw responseShapeError('console approval request returned an invalid response');
    }
    return response;
  }

  async pollConsoleApproval(deviceCode) {
    const code = String(deviceCode ?? '').trim();
    if (!code.startsWith('sbcd_')) {
      throw responseShapeError('console approval device code was invalid');
    }
    const response = await this.#req(
      'POST',
      '/console/approval/poll',
      { deviceCode: code },
      {},
      false,
      false,
      false,
    );
    if (exactRecord(response, ['status', 'interval'])) {
      if (
        response.status !== 'authorization_pending'
        || !Number.isSafeInteger(response.interval)
        || response.interval < 1
      ) {
        throw responseShapeError('console approval poll returned an invalid pending response');
      }
      return { status: response.status, interval: response.interval };
    }
    if (!exactRecord(response, ['status', 'credential', 'expiresAtMs'])) {
      throw responseShapeError('console approval poll returned an invalid response');
    }
    const credential = projectConsoleCredential({
      credential: response.credential,
      expiresAtMs: response.expiresAtMs,
    });
    if (
      response.status !== 'approved'
      || !credential
      || credential.expiresAtMs <= Date.now()
    ) {
      throw responseShapeError('console approval returned an invalid credential');
    }
    this.#replaceConsoleCredential(credential);
    return { status: 'approved', expiresAtMs: credential.expiresAtMs };
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
    if (
      includeCredential
      && path !== '/console/credential'
      && !this.consoleCredential
      && this.reachabilityCandidates.length
    ) {
      await this.#restoreReachabilityCredential();
    }
    if (
      includeCredential
      && path !== '/console/credential'
      && this.#consoleCredentialNeedsRenewal()
    ) {
      await this.#renewConsoleCredential();
    }
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
      if (preserveCredentialResponse) {
        throw opaqueCredentialResponseError();
      }
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
      if (res.status === 401 && this.consoleReachability) {
        this.#replaceConsoleCredential(null);
      }
      if (preserveCredentialResponse) throw opaqueCredentialResponseError();
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
      if (preserveCredentialResponse) throw opaqueCredentialResponseError();
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

  async #guideReq(relativePath, { json = false, expectedIdentity = null } = {}) {
    const path = String(relativePath ?? '');
    if (
      !path
      || path.includes('..')
      || !/^(?:guide-manifest\.generated\.json|[A-Za-z0-9._/-]+\.md)$/.test(path)
    ) {
      throw guideTransportError('SNAPBACK_GUIDE_PATH_INVALID', `invalid guide path ${JSON.stringify(path)}`);
    }
    let response;
    let text;
    try {
      response = await fetch(`${guideBaseUrl(this.baseUrl)}/${path}`);
      text = await response.text();
    } catch (error) {
      throw guideTransportError(
        'SNAPBACK_GUIDE_UNAVAILABLE',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!response.ok) {
      throw guideTransportError(
        'SNAPBACK_GUIDE_UNAVAILABLE',
        `GET ${path} returned HTTP ${response.status}`,
      );
    }
    const identity = {
      contentHash: response.headers.get('x-snapback-guide-content-sha256') || '',
      buildCommit: response.headers.get('x-snapback-server-build-commit') || '',
    };
    if (!identity.contentHash || !identity.buildCommit) {
      throw guideTransportError(
        'SNAPBACK_GUIDE_IDENTITY_MISSING',
        `GET ${path} omitted the guide content/build identity headers`,
      );
    }
    if (
      expectedIdentity
      && (
        identity.contentHash !== expectedIdentity.contentHash
        || identity.buildCommit !== expectedIdentity.buildCommit
      )
    ) {
      throw guideTransportError(
        'SNAPBACK_GUIDE_IDENTITY_MISMATCH',
        `GET ${path} did not match the loaded guide manifest identity`,
      );
    }
    if (!json) return { body: text, identity };
    try {
      return { body: JSON.parse(text), identity };
    } catch {
      throw guideTransportError(
        'SNAPBACK_GUIDE_MANIFEST_INVALID',
        `GET ${path} returned invalid JSON`,
      );
    }
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

  async #restoreReachabilityCredential() {
    if (this.reachabilityRestoreAttempted) return;
    this.reachabilityRestoreAttempted = true;
    const candidates = this.reachabilityCandidates;
    this.reachabilityCandidates = [];
    let activeIdentity = null;
    try {
      const response = await fetch(`${adminOrigin(this.baseUrl)}/_snapback/admin/reachability/identity`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (response.ok) {
        activeIdentity = projectReachabilityIdentity(await response.json(), false);
      }
    } catch {
      // A credential is never sent while backend identity is indeterminate.
    }
    for (const candidate of candidates) {
      const binding = candidate.reachability;
      if (
        !activeIdentity
        || activeIdentity.instanceId !== binding.instanceId
        || candidate.origin !== adminOrigin(this.baseUrl)
      ) {
        removeReachabilityCredential(candidate);
        continue;
      }
      try {
        const response = await fetch(
          `${adminOrigin(this.baseUrl)}/_snapback/admin/reachability/identity?session=${encodeURIComponent(binding.sessionId)}`,
          { method: 'GET', cache: 'no-store' },
        );
        const identity = response.ok
          ? projectReachabilityIdentity(await response.json(), true)
          : null;
        if (
          identity
          && identity.sessionId === binding.sessionId
          && identity.instanceId === binding.instanceId
          && candidate.expiresAtMs > Date.now()
        ) {
          this.consoleCredential = candidate.credential;
          this.consoleExpiresAtMs = candidate.expiresAtMs;
          this.consoleProvenance = candidate.provenance;
          this.consoleReachability = binding;
          return;
        }
      } catch {
        // Identity loss is a refusal, not a reason to optimistically restore.
      }
      removeReachabilityCredential(candidate);
    }
  }

  #consoleCredentialNeedsRenewal() {
    return !!this.#activeConsoleCredential()
      && this.consoleExpiresAtMs <= Date.now() + 2 * 60_000
      && this.consoleRenewalAttemptedAtMs <= Date.now() - 30_000;
  }

  async #renewConsoleCredential() {
    if (this.consoleRenewalPromise) return this.consoleRenewalPromise;
    this.consoleRenewalAttemptedAtMs = Date.now();
    this.consoleRenewalPromise = (async () => {
      try {
        const renewed = await this.#req(
          'POST',
          '/console/credential',
          undefined,
          {},
          true,
          false,
          true,
        );
        const credential = projectConsoleCredential(renewed);
        if (!credential || credential.expiresAtMs <= Date.now()) {
          throw responseShapeError('console credential renewal returned an invalid credential');
        }
        if (
          this.consoleReachability
          && (
            !credential.reachability
            || credential.reachability.sessionId !== this.consoleReachability.sessionId
            || credential.reachability.instanceId !== this.consoleReachability.instanceId
          )
        ) {
          this.#replaceConsoleCredential(null);
          throw responseShapeError(
            'console reachability credential renewal lost its session binding',
          );
        }
        this.#replaceConsoleCredential(credential);
      } catch (error) {
        // Renewal is a sliding convenience. Preserve an active credential for
        // the request that triggered renewal; the ordinary request remains the
        // authority check and will surface expiry when the cap is reached.
        if (!this.#activeConsoleCredential()) throw error;
      } finally {
        this.consoleRenewalPromise = null;
      }
    })();
    return this.consoleRenewalPromise;
  }

  #replaceConsoleCredential(record) {
    const previousReachability = this.consoleReachability;
    this.consoleCredential = record?.credential ?? '';
    this.consoleExpiresAtMs = record?.expiresAtMs ?? 0;
    this.consoleProvenance = record?.provenance ?? '';
    this.consoleReachability = record?.reachability ?? null;
    this.reachabilityCandidates = [];
    this.reachabilityRestoreAttempted = true;
    try {
      clearLegacyStoredMaster();
      if (previousReachability) removeReachabilityCredential({ reachability: previousReachability });
      if (record?.reachability) {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(CONSOLE_STORAGE_KEY);
        persistReachabilityCredential(this.baseUrl, record);
      } else if (typeof localStorage !== 'undefined' && record) {
        localStorage.setItem(CONSOLE_STORAGE_KEY, JSON.stringify(record));
      } else if (typeof localStorage !== 'undefined') {
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

  // @ref LLP 0167#authority-one-activation-chokepoint — the console is a thin
  //   client of the shared AdminRead/AdminWrite profile routes; policy remains
  //   entirely server-owned.
  networkProfile() {
    return this.#req('GET', '/debug/network-profile');
  }

  setNetworkProfile(profile, { source = 'api' } = {}) {
    // @ref LLP 0167#authority-one-activation-chokepoint — this is a source
    // hint for provenance only; deployment/admin authority remains server-owned.
    return this.#req(
      'PUT',
      '/debug/network-profile',
      profile,
      source === 'console' ? { 'x-snapback-network-profile-source': 'console' } : {},
    );
  }

  // @ref LLP 0184#b-forced-live-resync--add-now — a thin projection of the
  //   `debug.live.forceResync` host operation (there is no dedicated
  //   `/debug/live/force-resync` route the way network profiles have one;
  //   this operation is host-ops-only, like most of LLP 0024's surface).
  //   `startupNonce` fences the request to one exact running process and
  //   must come from a readiness descriptor or equivalent trusted source
  //   the caller already holds — this client does not mint or discover it.
  forceLiveResync({ connectionId, subscriptionId, reason, clearRetained = false, startupNonce }) {
    return this.#req('POST', '/host-ops', {
      operation: 'debug.live.forceResync',
      input: { connectionId, subscriptionId, reason, clearRetained, startupNonce },
    });
  }

  telemetryStats(filter = {}) {
    return this.#req(
      'GET',
      `/telemetry/stats${telemetryQuery(filter, [
        'kind', 'name', 'fromMs', 'toMs', 'callerKey', 'lane', 'groupByCaller',
      ])}`,
    );
  }

  declaredClients() {
    return this.#req('GET', '/auth/declared-clients');
  }

  integrations() {
    return this.#req('GET', '/auth/integrations');
  }

  passwordAttempt(email) {
    return this.#req('POST', '/auth/password/attempt', { email });
  }

  telemetryEvents(filter = {}) {
    return this.#req(
      'GET',
      `/telemetry/events${telemetryQuery(filter, [
        'kind', 'name', 'status', 'code', 'correlation', 'fromMs', 'toMs',
        'text', 'cursorRecordedTsMs', 'cursorId', 'order', 'limit',
      ])}`,
      undefined,
      {},
      true,
      true,
    );
  }

  // @ref LLP 0156#e14--surface-typed-operations-projected-everywhere-d5-discipline — structural
  //   lists, raw issue detail, and authored transitions retain distinct gates.
  errorsIssues(filter = {}) {
    return this.#req(
      'GET',
      `/errors/issues${telemetryQuery(filter, [
        'state', 'kind', 'name', 'subsystem', 'failureDisposition', 'release',
        'since', 'fromMs', 'toMs', 'order', 'cursor', 'limit',
      ])}`,
    );
  }

  errorsIssue(issue) {
    return this.#req(
      'GET',
      `/errors/issue${telemetryQuery({ issue }, ['issue'])}`,
      undefined,
      {},
      true,
      true,
    );
  }

  errorsTransition(input) {
    return this.#req('POST', '/errors/transition', input);
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

  // The injected-clock one-off jobs drain (LLP 0070 first slice) — the
  // set-based sibling of tickCron: `nowMs` is the injected clock, so
  // acceptance suites drive due-ness deterministically instead of sleeping.
  drainJobs({ nowMs, maxWaves } = {}) {
    const body = {};
    if (nowMs !== undefined) body.nowMs = nowMs;
    if (maxWaves !== undefined) body.maxWaves = maxWaves;
    return this.#req('POST', '/jobs/drain', body);
  }

  listJobs() {
    return this.#req('GET', '/jobs');
  }

  showJob(jobId) {
    return this.#req('GET', `/jobs/${encodeURIComponent(jobId)}`);
  }

  async cleanupEphemeral({
    cutoffTimestampMs,
    olderThanMs = cutoffTimestampMs === undefined ? 0 : undefined,
    dryRun = false,
    maxEntries = 1_000,
    startupNonce,
  } = {}) {
    // Existing console callers keep apply semantics, but now do so through a
    // finite batch and an explicit expiry cutoff. Bind the request to the
    // process observed immediately before the write; a restart between these
    // calls is refused by the server instead of cleaning a replacement.
    let nonce = String(startupNonce ?? '').trim();
    if (!nonce) {
      const instance = await this.#req('GET', '/control-catalog/instance');
      nonce = String(instance?.startupNonce ?? '').trim();
    }
    return this.#req('POST', '/ephemeral/cleanup', {
      ...(cutoffTimestampMs === undefined ? {} : { cutoffTimestampMs }),
      ...(olderThanMs === undefined ? {} : { olderThanMs }),
      dryRun: dryRun === true,
      maxEntries,
      startupNonce: nonce,
    });
  }

  // @ref LLP 0036#status-model-and-app-visibility-d4 — the status primitive:
  // names and states only, never values. The Secrets surface renders this.
  configStatus() {
    return this.#req('GET', '/config/status');
  }

  verifyConfigEntry(entry) {
    return this.#req('POST', '/config/verify', { entry, source: 'http' });
  }

  async guideManifest() {
    const { body: manifest, identity } = await this.#guideReq(
      'guide-manifest.generated.json',
      { json: true },
    );
    if (
      manifest?.contentHash !== identity.contentHash
      || manifest?.buildIdentity?.commit !== identity.buildCommit
    ) {
      throw guideTransportError(
        'SNAPBACK_GUIDE_IDENTITY_MISMATCH',
        'served guide manifest body does not match its response identity headers',
      );
    }
    return { manifest, identity };
  }

  async guidePage(path, expectedIdentity) {
    const { body } = await this.#guideReq(path, { expectedIdentity });
    return body;
  }
}

// Consume the CLI's fragment handoff before the console makes any request.
// The fragment is removed from the visible/history URL before validation or
// persistence. Ordinary credentials use localStorage; reachability-bound
// credentials are selected by their response binding and use sessionStorage.
export async function consumeConsoleCredentialFragment(
  client,
  locationObject = globalThis.location,
  historyObject = globalThis.history,
) {
  const raw = String(locationObject?.hash ?? '');
  if (!raw.startsWith('#')) return false;
  const parameters = new URLSearchParams(raw.slice(1));
  const carriesCredential = parameters.has('credential');
  const carriesClaim = parameters.has('claim');
  if (!carriesCredential && !carriesClaim) return false;
  const replacement = `${locationObject?.pathname ?? ''}${locationObject?.search ?? ''}` || '/';
  const canStripFragment = historyObject && typeof historyObject.replaceState === 'function';
  if (carriesClaim && !canStripFragment) {
    throw responseShapeError('console claim fragment could not be removed before exchange');
  }
  if (canStripFragment) {
    historyObject.replaceState(historyObject.state ?? null, '', replacement);
  }
  const keys = [...parameters.keys()];
  if (carriesClaim) {
    if (
      carriesCredential
      || keys.length !== 1
      || keys.filter((key) => key === 'claim').length !== 1
    ) {
      throw responseShapeError('console claim fragment was invalid');
    }
    await client.exchangeConsoleClaim(parameters.get('claim'));
    return true;
  }
  if (
    keys.length !== 2
    || keys.filter((key) => key === 'credential').length !== 1
    || keys.filter((key) => key === 'expiresAtMs').length !== 1
  ) {
    throw responseShapeError('console credential fragment was invalid');
  }
  const expiresAtMs = Number(parameters.get('expiresAtMs'));
  client.setConsoleCredential(parameters.get('credential'), expiresAtMs);
  return true;
}

function telemetryQuery(input, allowed) {
  const query = new URLSearchParams();
  for (const key of allowed) {
    const value = input?.[key];
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

function guideBaseUrl(adminApiBaseUrl) {
  const base = String(adminApiBaseUrl ?? '').replace(/\/$/, '');
  if (base.endsWith('/_snapback/api')) {
    return `${base.slice(0, -'/_snapback/api'.length)}/_snapback/guide`;
  }
  if (base.endsWith('/api')) return `${base.slice(0, -'/api'.length)}/guide`;
  return `${base}/guide`;
}

function adminOrigin(adminApiBaseUrl) {
  const base = String(adminApiBaseUrl ?? '').replace(/\/$/, '');
  if (base.endsWith('/_snapback/api')) {
    return base.slice(0, -'/_snapback/api'.length);
  }
  try {
    return new URL(base).origin;
  } catch {
    return base;
  }
}

function guideTransportError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message };
  return error;
}

function opaqueCredentialResponseError() {
  const error = new Error(
    'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID: credential issuer returned an invalid response',
  );
  error.code = 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
  error.diagnostic = {
    code: error.code,
    message: 'credential issuer returned an invalid response',
  };
  return error;
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

function reachabilityStorageKey(binding) {
  return `${REACHABILITY_STORAGE_PREFIX}${binding.sessionId}:${binding.instanceId}`;
}

function projectReachabilityBinding(value) {
  if (!exactRecord(value, ['sessionId', 'instanceId'])) return null;
  if (
    typeof value.sessionId !== 'string'
    || !/^sbrs_[A-Za-z0-9]+$/.test(value.sessionId)
    || typeof value.instanceId !== 'string'
    || !/^[A-Za-z0-9-]+$/.test(value.instanceId)
  ) {
    return null;
  }
  return { sessionId: value.sessionId, instanceId: value.instanceId };
}

function projectReachabilityIdentity(value, withSession) {
  const keys = withSession ? ['instanceId', 'sessionId'] : ['instanceId'];
  if (!exactRecord(value, keys)) return null;
  if (typeof value.instanceId !== 'string' || !/^[A-Za-z0-9-]+$/.test(value.instanceId)) {
    return null;
  }
  if (withSession) {
    if (typeof value.sessionId !== 'string' || !/^sbrs_[A-Za-z0-9]+$/.test(value.sessionId)) {
      return null;
    }
    return { instanceId: value.instanceId, sessionId: value.sessionId };
  }
  return { instanceId: value.instanceId };
}

function reachabilityIndex() {
  if (typeof sessionStorage === 'undefined') return [];
  const raw = sessionStorage.getItem(REACHABILITY_INDEX_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((key) => (
    typeof key !== 'string' || !key.startsWith(REACHABILITY_STORAGE_PREFIX)
  ))) {
    sessionStorage.removeItem(REACHABILITY_INDEX_KEY);
    return [];
  }
  return [...new Set(parsed)];
}

function writeReachabilityIndex(keys) {
  if (typeof sessionStorage === 'undefined') return;
  const unique = [...new Set(keys)];
  if (unique.length) {
    sessionStorage.setItem(REACHABILITY_INDEX_KEY, JSON.stringify(unique));
  } else {
    sessionStorage.removeItem(REACHABILITY_INDEX_KEY);
  }
}

function persistReachabilityCredential(baseUrl, record) {
  if (typeof sessionStorage === 'undefined') return;
  const key = reachabilityStorageKey(record.reachability);
  const stored = {
    credential: record.credential,
    expiresAtMs: record.expiresAtMs,
    provenance: record.provenance,
    reachability: record.reachability,
    origin: adminOrigin(baseUrl),
  };
  sessionStorage.setItem(key, JSON.stringify(stored));
  writeReachabilityIndex([...reachabilityIndex(), key]);
}

function removeReachabilityCredential(record) {
  try {
    if (typeof sessionStorage === 'undefined' || !record?.reachability) return;
    const key = reachabilityStorageKey(record.reachability);
    sessionStorage.removeItem(key);
    writeReachabilityIndex(reachabilityIndex().filter((candidate) => candidate !== key));
  } catch {
    // A storage failure cannot make a reachability credential eligible.
  }
}

function storedReachabilityCredentials(baseUrl) {
  try {
    if (typeof sessionStorage === 'undefined') return [];
    const expectedOrigin = adminOrigin(baseUrl);
    const retained = [];
    const candidates = [];
    for (const key of reachabilityIndex()) {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const projected = projectConsoleCredential(parsed);
      if (
        !projected?.reachability
        || parsed.origin !== expectedOrigin
        || parsed.expiresAtMs <= Date.now()
        || key !== reachabilityStorageKey(projected.reachability)
      ) {
        sessionStorage.removeItem(key);
        continue;
      }
      retained.push(key);
      candidates.push({ ...projected, origin: parsed.origin });
    }
    writeReachabilityIndex(retained);
    return candidates;
  } catch {
    return [];
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
  const standard = exactRecord(value, ['credential', 'expiresAtMs']);
  const provenanced = exactRecord(value, ['credential', 'expiresAtMs', 'provenance']);
  const reachable = exactRecord(
    value,
    ['credential', 'expiresAtMs', 'provenance', 'reachability'],
  );
  const storedReachable = exactRecord(
    value,
    ['credential', 'expiresAtMs', 'provenance', 'reachability', 'origin'],
  );
  if (!standard && !provenanced && !reachable && !storedReachable) return null;
  if (
    typeof value.credential !== 'string' ||
    !/^sbcc_[A-Za-z0-9-]+$/.test(value.credential) ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    value.expiresAtMs < 0
    || ((provenanced || reachable || storedReachable) && value.provenance !== 'operatorClaim')
  ) {
    return null;
  }
  const projected = {
    credential: value.credential,
    expiresAtMs: value.expiresAtMs,
  };
  if (provenanced || reachable || storedReachable) projected.provenance = value.provenance;
  if (reachable || storedReachable) {
    const reachability = projectReachabilityBinding(value.reachability);
    if (!reachability) return null;
    projected.reachability = reachability;
  }
  // @ref LLP 0060#c1-the-v1-custody-claim — an exact response shape still
  // fails closed when the derived record would persist its minting authority
  // in any key or value, including an all-numeric master reflected as the
  // `expiresAtMs` timestamp or a master spanning serialized JSON punctuation.
  if (forbiddenMaster && consoleRecordContainsMaster(projected, forbiddenMaster)) return null;
  return projected;
}

function projectConsoleApprovalRequest(value) {
  if (!exactRecord(value, ['deviceCode', 'userCode', 'verificationUri', 'expiresIn', 'interval'])) {
    return null;
  }
  if (
    typeof value.deviceCode !== 'string'
    || !/^sbcd_[A-Za-z0-9]+$/.test(value.deviceCode)
    || typeof value.userCode !== 'string'
    || !/^[A-F0-9]{4}-[A-F0-9]{4}$/.test(value.userCode)
    || typeof value.verificationUri !== 'string'
    || !value.verificationUri
    || !Number.isSafeInteger(value.expiresIn)
    || value.expiresIn < 1
    || !Number.isSafeInteger(value.interval)
    || value.interval < 1
  ) {
    return null;
  }
  return value;
}

function consoleRecordContainsMaster(record, master) {
  return record.credential.includes(master)
    || String(record.expiresAtMs).includes(master)
    || JSON.stringify(record).includes(master);
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
    || normalized === 'device_code'
    || normalized === 'claim_code'
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
  // @ref LLP 0060#c1-the-v1-custody-claim — known operator carriers have no
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

// @ref LLP 0060#c1-the-v1-custody-claim — numeric response positions are
// compared against known operator carriers in canonical string form; an
// all-numeric master, console credential, lease, or config value reflected as
// a JSON number never survives either projection.
function redactReflectedNumber(value, secrets) {
  const text = String(value);
  const redacted = redactKnownSecrets(text, secrets);
  return redacted === text ? value : redacted;
}

function sanitizeKnownSecrets(value, secrets, seen = new WeakSet()) {
  if (typeof value === 'string') return redactKnownSecrets(value, secrets);
  if (typeof value === 'number' || typeof value === 'bigint') {
    return redactReflectedNumber(value, secrets);
  }
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
  if (typeof value === 'number' || typeof value === 'bigint') {
    return redactReflectedNumber(value, secrets);
  }
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
