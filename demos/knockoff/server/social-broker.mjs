import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';

import { SnapbackClient } from '@expo/snapback-client';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract';

import {
  exchangeGoogleAuthorizationCode,
  fixtureIdentity,
  verifyAppleIdentityToken,
  verifyGoogleIdentityToken,
} from './provider-verifier.mjs';

const BODY_LIMIT = 64 * 1024;

function clientFor(config, id) {
  const coordinator = new AuthCoordinator({
    appId: config.appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  return new SnapbackClient(config.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: `knockoff-broker-${id}`,
    rqsStore: null,
  });
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new TypeError('broker request is too large');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('broker request must be an object');
  }
  return value;
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  });
  response.end(JSON.stringify(value));
}

function syntheticEmail(identity, secret) {
  const digest = createHmac('sha256', secret)
    .update(`${identity.issuer}\0${identity.subject}`)
    .digest('hex');
  return `social-${digest.slice(0, 40)}@knockoff.invalid`;
}

function suggestedProfile(identity) {
  const base = identity.displayName.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_|_$/gu, '') || identity.provider;
  const suffix = createHash('sha256').update(`${identity.issuer}\0${identity.subject}`).digest('hex').slice(0, 6);
  return Object.freeze({
    displayName: identity.displayName,
    handle: `${base.slice(0, 16)}_${suffix}`,
    avatarUrl: identity.avatarUrl || `https://api.dicebear.com/9.x/thumbs/png?seed=${encodeURIComponent(suffix)}`,
    provider: identity.provider,
  });
}

async function capturedExchange(config, identity) {
  const email = syntheticEmail(identity, config.identitySecret);
  const client = clientFor(config, createHash('sha256').update(email).digest('hex').slice(0, 12));
  try {
    const challenge = await client.auth.authRequestCode(email);
    const mailboxResponse = await fetch(
      `${config.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(challenge.challengeId)}`,
      {
        headers: {
          'x-snapback-admin-token': config.adminToken,
          'x-snapback-impersonation-capability': config.impersonationCapability,
        },
      },
    );
    const mailbox = await mailboxResponse.json();
    if (
      !mailboxResponse.ok
      || mailbox.challengeId !== challenge.challengeId
      || mailbox.canonicalAddress !== email
      || typeof mailbox.code !== 'string'
    ) throw new Error('Snapback capture mailbox refused the social broker');
    return Object.freeze({ challengeId: challenge.challengeId, code: mailbox.code });
  } finally {
    await client.closeAuth();
  }
}

export function createKnockoffSocialBroker(input) {
  const config = Object.freeze({ ...input });
  for (const field of ['baseUrl', 'adminToken', 'impersonationCapability', 'appId', 'identitySecret']) {
    if (typeof config[field] !== 'string' || config[field].length === 0) {
      throw new TypeError(`Knockoff broker requires ${field}`);
    }
  }

  async function complete(identity) {
    return Object.freeze({
      exchange: await capturedExchange(config, identity),
      profile: suggestedProfile(identity),
    });
  }

  async function route(request) {
    const url = new URL(request.url ?? '/', 'http://knockoff.local');
    if (request.method === 'OPTIONS') return { status: 204, body: null };
    if (request.method !== 'POST') throw new TypeError('broker routes require POST');
    const body = await readJson(request);
    if (url.pathname === '/v1/fixture/login') {
      if (config.allowFixtures !== true) throw new TypeError('fixture login is disabled');
      return { status: 200, body: await complete(fixtureIdentity(body.provider)) };
    }
    if (url.pathname === '/v1/apple/native') {
      const identity = await verifyAppleIdentityToken(body.identityToken, {
        audience: config.appleClientId,
        nonce: body.nonce,
        displayName: body.displayName,
      });
      return { status: 200, body: await complete(identity) };
    }
    if (url.pathname === '/v1/google/native') {
      const identity = await verifyGoogleIdentityToken(body.idToken, {
        audience: config.googleClientId,
        nonce: body.nonce,
      });
      return { status: 200, body: await complete(identity) };
    }
    if (url.pathname === '/v1/google/code') {
      const identity = await exchangeGoogleAuthorizationCode({
        code: body.code,
        codeVerifier: body.codeVerifier,
        redirectUri: body.redirectUri,
        clientId: config.googleClientId,
      });
      return { status: 200, body: await complete(identity) };
    }
    return { status: 404, body: { diagnostic: { code: 'KNOCKOFF_AUTH_ROUTE_UNKNOWN', message: 'Unknown broker route.' } } };
  }

  return Object.freeze({
    async handle(request, response) {
      try {
        const result = await route(request);
        if (result.status === 204) {
          response.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'content-type',
            'access-control-allow-methods': 'POST, OPTIONS',
          });
          response.end();
          return;
        }
        sendJson(response, result.status, result.body);
      } catch (error) {
        sendJson(response, 400, {
          diagnostic: {
            code: 'KNOCKOFF_AUTH_REFUSED',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },
    listen({ host = '127.0.0.1', port = 0 } = {}) {
      const server = createServer((request, response) => { void this.handle(request, response); });
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const address = server.address();
          resolve(Object.freeze({
            origin: `http://${host}:${address.port}`,
            close: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())),
          }));
        });
      });
    },
  });
}
