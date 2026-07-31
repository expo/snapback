import {
  PROMOTION_PACKAGE_NAMES,
  validatePublicationAuthorityHead,
  validatePublicationLeaseIssueRequest,
} from './protocol.mjs';

const DEFAULT_AUTHORITY_RESPONSE_LIMIT = 128 * 1024;
const DEFAULT_AUTHORITY_TIMEOUT_MS = 15_000;

/**
 * Read one authority response without ever buffering an unbounded or stalled
 * peer body. The abort closes the fetch-side stream before an error escapes.
 *
 * @ref LLP 0041#standing-publication-authority-as-built — publication clients
 * bound and close every authority response, including error bodies.
 */
export async function fetchPublicationAuthorityJson(
  url,
  init = {},
  {
    fetchImpl = globalThis.fetch,
    maxBytes = DEFAULT_AUTHORITY_RESPONSE_LIMIT,
    timeoutMs = DEFAULT_AUTHORITY_TIMEOUT_MS,
  } = {},
) {
  if (typeof fetchImpl !== 'function') throw new TypeError('authority fetch implementation is required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('authority response maxBytes must be a positive safe integer');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('authority response timeoutMs must be a positive safe integer');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(
    new Error('publication authority response timed out'),
  ), timeoutMs);
  timeout.unref?.();
  let reader = null;
  let responseBody = null;
  let completed = false;
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: 'error',
      signal: init.signal
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal,
    });
    responseBody = response.body;
    const contentType = response.headers.get('content-type');
    if (contentType !== 'application/json') {
      throw new Error(`authority returned non-JSON HTTP ${response.status}`);
    }
    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null
      && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maxBytes)
    ) {
      throw new Error('publication authority response exceeded its byte bound');
    }
    if (response.body === null) {
      throw new Error(`authority returned an empty HTTP ${response.status} body`);
    }
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        throw new Error('publication authority response exceeded its byte bound');
      }
      chunks.push(Buffer.from(value));
    }
    completed = true;
    let value;
    try {
      value = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
    } catch {
      throw new Error(`authority returned non-JSON HTTP ${response.status}`);
    }
    return { ok: response.ok, status: response.status, value };
  } catch (error) {
    controller.abort(error);
    if (reader !== null) {
      try {
        await reader.cancel(error);
      } catch {
        // Preserve the bounded-read failure.
      }
    } else if (responseBody !== null) {
      try {
        await responseBody.cancel(error);
      } catch {
        // Preserve the bounded-read failure.
      }
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (!completed) controller.abort();
  }
}

export function validateObservedPriorVector(
  vector,
  { packageNames = PROMOTION_PACKAGE_NAMES } = {},
) {
  if (vector === null || typeof vector !== 'object' || Array.isArray(vector)) {
    throw new Error('prior vector must be an object');
  }
  const actual = Object.keys(vector).sort();
  const expected = [...packageNames].sort();
  if (
    actual.length !== expected.length
    || actual.some((name, index) => name !== expected[index])
  ) {
    throw new Error('prior vector must contain the exact nine-package inventory');
  }
  for (const name of packageNames) {
    const value = vector[name];
    if (
      value !== null
      && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value ?? '')
    ) {
      throw new Error(`prior vector ${name} is not an exact version or null`);
    }
  }
  return vector;
}

// @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
// — the request is derived from the byte-qualified candidate and a separately
// observed complete prior vector; callers cannot omit an inventory member.
export function createPublicationLeaseIssueRequest({
  ledger,
  priorVector,
  priorDefaultClosureReceiptSha256,
  head,
  publicKey,
  authorityOrigin,
  operationId,
  publisherInstanceId,
  lifetimeSeconds = 900,
}) {
  validateObservedPriorVector(priorVector);
  validatePublicationAuthorityHead({
    head,
    publicKey,
    authorityOrigin,
  });
  const packagesByName = new Map(
    (ledger?.packages ?? []).map((row) => [row.name, row]),
  );
  const packages = PROMOTION_PACKAGE_NAMES.map((name) => {
    const candidate = packagesByName.get(name);
    if (
      !candidate
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(candidate.version ?? '')
    ) {
      throw new Error(`candidate ledger omitted an exact ${name} version`);
    }
    return {
      name,
      expectedPriorVersion: priorVector[name],
      newVersion: candidate.version,
    };
  });
  return validatePublicationLeaseIssueRequest({
    schemaVersion: 'snapback.publication-lease-issue-request.v4',
    authorityInstallationId: head.authorityInstallationId,
    authorityOrigin: head.authorityOrigin,
    signingKeyId: head.signingKeyId,
    operationId,
    publisherInstanceId,
    expectedPublicationEpoch: head.publicationEpoch,
    expectedHeadSha256: head.headSha256,
    candidateLedgerSha256: ledger.candidateLedgerSha256,
    candidateTag: ledger.tag,
    defaultTag: 'latest',
    priorDefaultClosureReceiptSha256,
    lifetimeSeconds,
    packages,
  });
}
