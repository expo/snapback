import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { PublicationAuthorityError } from './authority.mjs';
import { canonicalJcs } from './protocol.mjs';

function errorBody(code, message) {
  return {
    schemaVersion: 'snapback.publication-authority-error.v1',
    code,
    message,
  };
}

function send(response, status, value) {
  const body = Buffer.from(canonicalJcs(value));
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': body.byteLength,
    'content-type': 'application/json',
  });
  response.end(body);
}

// @ref LLP 0041#standing-publication-authority-as-built — body-bearing
// refusals close the connection instead of draining attacker-controlled bytes.
function sendAndClose(request, response, status, value) {
  // Refusal must not turn into an unbounded drain of attacker-controlled body
  // bytes. Stop the readable side immediately, send the small closed error,
  // then destroy this connection once the response has flushed.
  const socket = request.socket;
  request.pause();
  socket?.pause();
  response.shouldKeepAlive = false;
  const body = Buffer.from(canonicalJcs(value));
  response.writeHead(status, {
    'cache-control': 'no-store',
    connection: 'close',
    'content-length': body.byteLength,
    'content-type': 'application/json',
  });
  response.end(body, () => socket?.destroy());
}

function connectionClosingError(code, message, status) {
  const error = new PublicationAuthorityError(code, message, status);
  error.closeConnection = true;
  return error;
}

function tokenDigest(value) {
  return createHash('sha256').update(value).digest();
}

function authorized(request, expectedTokenDigest) {
  const authorizationHeaders = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === 'authorization') {
      authorizationHeaders.push(request.rawHeaders[index + 1]);
    }
  }
  if (authorizationHeaders.length !== 1) return false;
  const match = authorizationHeaders[0].match(/^Bearer ([\x21-\x7e]{16,4096})$/u);
  if (!match) return false;
  return timingSafeEqual(tokenDigest(match[1]), expectedTokenDigest);
}

function exactHeader(request, name) {
  const values = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === name) {
      values.push(request.rawHeaders[index + 1]);
    }
  }
  return values.length === 1 ? values[0] : null;
}

async function readCanonicalRequest(request, limit = 128 * 1024) {
  if (request.headers['content-type'] !== 'application/json') {
    const error = new PublicationAuthorityError(
      'SNAPBACK_PUBLICATION_CONTENT_TYPE_INVALID',
      'authority requests require content-type application/json',
      415,
    );
    if (requestCarriesBody(request)) error.closeConnection = true;
    throw error;
  }
  const declaredLength = request.headers['content-length'];
  if (
    declaredLength !== undefined
    && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > limit)
  ) {
    throw connectionClosingError(
      'SNAPBACK_PUBLICATION_REQUEST_TOO_LARGE',
      'authority request exceeds 128 KiB',
      413,
    );
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.byteLength;
    if (length > limit) {
      throw connectionClosingError(
        'SNAPBACK_PUBLICATION_REQUEST_TOO_LARGE',
        'authority request exceeds 128 KiB',
        413,
      );
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new PublicationAuthorityError(
      'SNAPBACK_PUBLICATION_JSON_INVALID',
      'authority request is not valid JSON',
      400,
    );
  }
  if (canonicalJcs(parsed) !== body) {
    throw new PublicationAuthorityError(
      'SNAPBACK_PUBLICATION_CANONICAL_BODY_REQUIRED',
      'authority request must be exact canonical JCS bytes',
      400,
    );
  }
  return parsed;
}

function requestCarriesBody(request) {
  return request.headers['transfer-encoding'] !== undefined
    || (
      request.headers['content-length'] !== undefined
      && request.headers['content-length'] !== '0'
    );
}

// @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
// — all mutable authority operations are authenticated, closed canonical
// requests; health never projects the lease head or signing material.
export function createPublicationAuthorityServer({ authority, bearerToken }) {
  if (typeof bearerToken !== 'string' || bearerToken.length < 16) {
    throw new TypeError('publication authority bearer token must contain at least 16 bytes');
  }
  const expectedTokenDigest = tokenDigest(bearerToken);
  const server = createServer({
    maxHeaderSize: 16 * 1024,
    requireHostHeader: true,
  }, async (request, response) => {
    try {
      const url = new URL(request.url, 'http://publication-authority.invalid');
      if (request.method === 'GET' && requestCarriesBody(request)) {
        sendAndClose(request, response, 400, errorBody(
          'SNAPBACK_PUBLICATION_GET_BODY_REFUSED',
          'publication authority GET requests must not carry a body',
        ));
        return;
      }
      if (url.pathname === '/healthz' && request.method === 'GET') {
        if (url.search !== '') {
          send(response, 404, errorBody(
            'SNAPBACK_PUBLICATION_ROUTE_NOT_FOUND',
            'publication authority route not found',
          ));
          return;
        }
        send(response, 200, {
          schemaVersion: 'snapback.publication-authority-health.v1',
          ready: true,
        });
        return;
      }
      if (!authorized(request, expectedTokenDigest)) {
        response.setHeader('www-authenticate', 'Bearer');
        const body = errorBody(
          'SNAPBACK_PUBLICATION_AUTH_REQUIRED',
          'valid publication authority Bearer authentication is required',
        );
        if (requestCarriesBody(request)) {
          sendAndClose(request, response, 401, body);
        } else {
          send(response, 401, body);
        }
        return;
      }
      if (url.search !== '') {
        const body = errorBody(
          'SNAPBACK_PUBLICATION_ROUTE_NOT_FOUND',
          'publication authority route not found',
        );
        if (requestCarriesBody(request)) {
          sendAndClose(request, response, 404, body);
        } else {
          send(response, 404, body);
        }
        return;
      }
      if (url.pathname === '/v1/head' && request.method === 'GET') {
        const challenge = exactHeader(request, 'x-snapback-publication-challenge');
        if (!/^[0-9a-f]{64}$/u.test(challenge ?? '')) {
          send(response, 400, errorBody(
            'SNAPBACK_PUBLICATION_HEAD_CHALLENGE_REQUIRED',
            'publication authority head reads require one fresh challenge',
          ));
          return;
        }
        send(response, 200, authority.head(challenge));
        return;
      }
      const routes = new Map([
        ['POST /v1/leases/issue', (body) => authority.issue(body)],
        ['POST /v1/leases/acquire', (body) => authority.acquire(body)],
        ['POST /v1/leases/close', (body) => authority.close(body)],
      ]);
      const handler = routes.get(`${request.method} ${url.pathname}`);
      if (!handler) {
        const body = errorBody(
          'SNAPBACK_PUBLICATION_ROUTE_NOT_FOUND',
          'publication authority route not found',
        );
        if (requestCarriesBody(request)) {
          sendAndClose(request, response, 404, body);
        } else {
          send(response, 404, body);
        }
        return;
      }
      send(response, 200, handler(await readCanonicalRequest(request)));
    } catch (error) {
      if (error instanceof PublicationAuthorityError) {
        if (error.closeConnection === true) {
          sendAndClose(
            request,
            response,
            error.status,
            errorBody(error.code, error.message),
          );
        } else {
          send(response, error.status, errorBody(error.code, error.message));
        }
      } else {
        send(response, 500, errorBody(
          'SNAPBACK_PUBLICATION_AUTHORITY_UNAVAILABLE',
          'publication authority state is unavailable',
        ));
      }
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.maxHeadersCount = 64;
  return server;
}
