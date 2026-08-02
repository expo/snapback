// Standalone core/operations/authority-fence graph for compiled Micro.
// It intentionally has no live, outbox, socket, storage, or Full imports.
// @ref LLP 0147#d5-keep-a-small-static-module-graph — a core-only generated
//   entry must not make the live lane reachable.

const DEFAULT_RESPONSE_LIMIT = 4 * 1024 * 1024;
const GENERATION_FIELDS = ['schemaVersion', 'appId', 'schemaHash', 'bundleHash', 'inputsHash'];

export const MICRO_CORE_INTERNALS = Symbol('snapback.micro-core-internals');

export function microCodedError(code, message, details = undefined, cause = undefined) {
  const error = new Error(`${code}: ${message}`, cause === undefined ? undefined : { cause });
  error.code = code;
  error.diagnostic = {
    code,
    severity: 'error',
    subsystem: 'micro-client',
    message,
    details: details ?? {},
  };
  return error;
}

export function microIsObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function microFiniteVersion(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function generationEquals(left, right) {
  return left !== null && right !== null
    && GENERATION_FIELDS.every((field) => left[field] === right[field]);
}

function assertGeneration(value, where) {
  if (!microIsObject(value)
    || !GENERATION_FIELDS.every((field) => typeof value[field] === 'string' && value[field].length > 0)) {
    throw microCodedError('SNAPBACK_MICRO_GENERATION_INVALID', `${where} has an incomplete artifact generation`);
  }
}

function assertDiagnostic(value) {
  if (!microIsObject(value)
    || typeof value.code !== 'string'
    || typeof value.message !== 'string'
    || (value.severity !== undefined && typeof value.severity !== 'string')
    || (value.subsystem !== undefined && typeof value.subsystem !== 'string')) {
    throw microCodedError('SNAPBACK_MICRO_DIAGNOSTIC_INVALID', 'the server returned a malformed diagnostic envelope');
  }
}

function assertOperationEnvelope(kind, value) {
  if (!microIsObject(value)) {
    throw microCodedError('SNAPBACK_MICRO_ENVELOPE_INVALID', `${kind} response must be an object`);
  }
  if (kind === 'Query') {
    if (!microFiniteVersion(value.version)
      || !Array.isArray(value.rows)
      || (value.cursor !== undefined && value.cursor !== null && typeof value.cursor !== 'string')) {
      throw microCodedError(
        'SNAPBACK_MICRO_ENVELOPE_INVALID',
        'query response requires a finite version, rows array, and optional string/null cursor',
      );
    }
  } else if (kind === 'Mutation') {
    if (!microFiniteVersion(value.version)
      || !Number.isSafeInteger(value.changed_count)
      || value.changed_count < 0
      || !Object.hasOwn(value, 'result')
      || !microIsObject(value.authorityDescriptor)
      || !microIsObject(value.receipt)) {
      throw microCodedError('SNAPBACK_MICRO_ENVELOPE_INVALID', 'mutation response has an invalid operation envelope');
    }
  } else if (kind === 'Action') {
    if (typeof value.ok !== 'boolean') {
      throw microCodedError('SNAPBACK_MICRO_ENVELOPE_INVALID', 'action response requires an ok boolean');
    }
    if (!value.ok) {
      assertDiagnostic(value.diagnostic);
      throw microCodedError(value.diagnostic.code, value.diagnostic.message, value.diagnostic.details);
    }
    if (!Object.hasOwn(value, 'result')) {
      throw microCodedError('SNAPBACK_MICRO_ENVELOPE_INVALID', 'successful action response requires result');
    }
  } else {
    throw microCodedError('SNAPBACK_MICRO_OPERATION_KIND_INVALID', `unsupported generated operation kind ${String(kind)}`);
  }
  return value;
}

async function boundedText(response, maximumBytes) {
  if (response.body === null || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) {
      throw microCodedError('SNAPBACK_MICRO_RESPONSE_TOO_LARGE', `response exceeds ${maximumBytes} bytes`);
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw microCodedError('SNAPBACK_MICRO_RESPONSE_TOO_LARGE', `response exceeds ${maximumBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

export function microAuthInput(userId) {
  return {
    principal: userId ?? null,
    session_id: null,
    user_id: userId ?? null,
    permissions: [],
  };
}

export function createMicroCoreRuntime({
  endpoint,
  expectedGeneration,
  userId = null,
  fetch: fetchImplementation = globalThis.fetch,
  timeoutMs = 10_000,
  maximumResponseBytes = DEFAULT_RESPONSE_LIMIT,
  requireGenerationFacts = false,
  queryRetries = 1,
} = {}) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw new TypeError('createMicroCoreRuntime requires endpoint');
  }
  assertGeneration(expectedGeneration, 'createMicroCoreRuntime');
  if (typeof fetchImplementation !== 'function') throw new TypeError('createMicroCoreRuntime requires fetch');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('createMicroCoreRuntime timeoutMs must be a positive integer');
  }
  if (!Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes < 1) {
    throw new TypeError('createMicroCoreRuntime maximumResponseBytes must be a positive integer');
  }

  const baseUrl = endpoint.replace(/\/$/u, '');
  let authority = { epoch: 0, userId };
  let disposed = false;
  const activeRequests = new Set();
  const participants = new Set();

  const capture = () => authority;
  const assertCurrent = (captured) => {
    if (disposed || captured !== authority) {
      throw microCodedError('SNAPBACK_MICRO_AUTHORITY_STALE', 'operation authority changed before publication');
    }
  };
  const request = async (method, path, body, captured, {
    ambiguous = false,
    staleCleanup = false,
    headers = undefined,
  } = {}) => {
    if (!staleCleanup) assertCurrent(captured);
    const controller = new AbortController();
    const record = { controller, captured };
    activeRequests.add(record);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await fetchImplementation(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(headers ?? {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (error) {
      if (ambiguous) {
        throw microCodedError(
          'SNAPBACK_MICRO_INDETERMINATE_OUTCOME',
          'the non-idempotent operation may have committed; Micro never retries it',
          { method, path },
          error,
        );
      }
      if (!staleCleanup && (captured !== authority || disposed)) assertCurrent(captured);
      throw microCodedError('SNAPBACK_MICRO_TRANSPORT_FAILED', 'request transport failed', { method, path }, error);
    } finally {
      clearTimeout(timer);
      activeRequests.delete(record);
    }
    const text = await boundedText(response, maximumResponseBytes);
    let value;
    try {
      value = text.length === 0 ? null : JSON.parse(text);
    } catch (error) {
      throw microCodedError('SNAPBACK_MICRO_RESPONSE_NOT_JSON', `HTTP ${response.status} response is not JSON`, {}, error);
    }
    if (!response.ok) {
      if (!microIsObject(value) || !Object.hasOwn(value, 'diagnostic')) {
        throw microCodedError('SNAPBACK_MICRO_HTTP_ERROR_INVALID', `HTTP ${response.status} response lacks a diagnostic`);
      }
      assertDiagnostic(value.diagnostic);
      const error = microCodedError(value.diagnostic.code, value.diagnostic.message, value.diagnostic.details);
      error.status = response.status;
      if (value.receipt !== undefined) error.receipt = value.receipt;
      throw error;
    }
    if (!staleCleanup) assertCurrent(captured);
    return value;
  };
  const validateFacts = (value) => {
    const active = value?.facts?.activeGeneration ?? null;
    if (requireGenerationFacts && active === null) {
      throw microCodedError('SNAPBACK_MICRO_GENERATION_FACTS_MISSING', 'sessions response omitted active generation facts');
    }
    if (active !== null && !generationEquals(active, expectedGeneration)) {
      throw microCodedError('SNAPBACK_MICRO_GENERATION_FACTS_MISMATCH', 'response active generation differs from generated code');
    }
  };

  const invoke = async (descriptor, args = {}) => {
    if (!microIsObject(descriptor)
      || typeof descriptor.name !== 'string'
      || !['Query', 'Mutation', 'Action'].includes(descriptor.kind)) {
      throw microCodedError('SNAPBACK_MICRO_DESCRIPTOR_INVALID', 'generated operation descriptor is invalid');
    }
    const captured = capture();
    const pathKind = descriptor.kind === 'Mutation' ? 'mutation'
      : descriptor.kind === 'Action' ? 'action' : 'query';
    const body = { args, auth: microAuthInput(captured.userId), read_set: [], expectedGeneration };
    const attempts = descriptor.kind === 'Query' ? queryRetries + 1 : 1;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const value = await request(
          'POST',
          `/${pathKind}/${encodeURIComponent(descriptor.name)}`,
          body,
          captured,
          { ambiguous: descriptor.kind !== 'Query' },
        );
        const admitted = assertOperationEnvelope(descriptor.kind, value);
        validateFacts(admitted);
        assertCurrent(captured);
        return admitted;
      } catch (error) {
        if (descriptor.kind !== 'Query'
          && error?.code !== 'SNAPBACK_MICRO_INDETERMINATE_OUTCOME'
          && [
            'SNAPBACK_MICRO_RESPONSE_TOO_LARGE',
            'SNAPBACK_MICRO_RESPONSE_NOT_JSON',
            'SNAPBACK_MICRO_ENVELOPE_INVALID',
            'SNAPBACK_MICRO_AUTHORITY_STALE',
            'SNAPBACK_MICRO_GENERATION_FACTS_MISSING',
            'SNAPBACK_MICRO_GENERATION_FACTS_MISMATCH',
          ].includes(error?.code)) {
          throw microCodedError(
            'SNAPBACK_MICRO_INDETERMINATE_OUTCOME',
            'the non-idempotent operation produced no publishable terminal response',
            { operation: descriptor.name, causeCode: error.code },
            error,
          );
        }
        lastError = error;
        if (descriptor.kind !== 'Query'
          || error?.code !== 'SNAPBACK_MICRO_TRANSPORT_FAILED'
          || attempt + 1 >= attempts) throw error;
        assertCurrent(captured);
      }
    }
    throw lastError;
  };

  const setIdentity = async (nextUserId) => {
    if (nextUserId !== null && typeof nextUserId !== 'string') {
      throw new TypeError('Micro identity must be a string or null');
    }
    if (disposed || authority.userId === nextUserId) return;
    authority = { epoch: authority.epoch + 1, userId: nextUserId };
    for (const record of activeRequests) record.controller.abort();
    await Promise.all([...participants].map((participant) => participant.authorityChanged(authority)));
  };
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    authority = { epoch: authority.epoch + 1, userId: authority.userId };
    for (const record of activeRequests) record.controller.abort();
    await Promise.all([...participants].map((participant) => participant.dispose()));
  };
  const internals = Object.freeze({
    capture,
    request,
    validateFacts,
    expectedGeneration,
    addParticipant(participant) {
      participants.add(participant);
      return () => participants.delete(participant);
    },
  });

  // @ref LLP 0147#d6-make-conservatism-the-micro-policy — final publication
  //   compares the monotone capture; cancellation is never its substitute.
  return Object.freeze({ invoke, setIdentity, dispose, [MICRO_CORE_INTERNALS]: internals });
}
