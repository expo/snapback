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

async function readCanonicalRequest(request, limit = 128 * 1024) {
  if (request.headers['content-type'] !== 'application/json') {
    throw new PublicationAuthorityError(
      'SNAPBACK_PUBLICATION_CONTENT_TYPE_INVALID',
      'authority requests require content-type application/json',
      415,
    );
  }
  const declaredLength = request.headers['content-length'];
  if (
    declaredLength !== undefined
    && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > limit)
  ) {
    request.resume();
    throw new PublicationAuthorityError(
      'SNAPBACK_PUBLICATION_REQUEST_TOO_LARGE',
      'authority request exceeds 128 KiB',
      413,
    );
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.byteLength;
    if (length > limit) {
      throw new PublicationAuthorityError(
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

function getCarriesBody(request) {
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
      if (request.method === 'GET' && getCarriesBody(request)) {
        request.resume();
        send(response, 400, errorBody(
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
        request.resume();
        response.setHeader('www-authenticate', 'Bearer');
        send(response, 401, errorBody(
          'SNAPBACK_PUBLICATION_AUTH_REQUIRED',
          'valid publication authority Bearer authentication is required',
        ));
        return;
      }
      if (url.search !== '') {
        send(response, 404, errorBody(
          'SNAPBACK_PUBLICATION_ROUTE_NOT_FOUND',
          'publication authority route not found',
        ));
        return;
      }
      if (url.pathname === '/v1/head' && request.method === 'GET') {
        send(response, 200, authority.head());
        return;
      }
      const routes = new Map([
        ['POST /v1/leases/issue', (body) => authority.issue(body)],
        ['POST /v1/leases/acquire', (body) => authority.acquire(body)],
        ['POST /v1/leases/close', (body) => authority.close(body)],
      ]);
      const handler = routes.get(`${request.method} ${url.pathname}`);
      if (!handler) {
        send(response, 404, errorBody(
          'SNAPBACK_PUBLICATION_ROUTE_NOT_FOUND',
          'publication authority route not found',
        ));
        return;
      }
      send(response, 200, handler(await readCanonicalRequest(request)));
    } catch (error) {
      if (error instanceof PublicationAuthorityError) {
        send(response, error.status, errorBody(error.code, error.message));
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
