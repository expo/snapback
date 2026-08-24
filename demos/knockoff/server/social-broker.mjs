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
import {
  createSharedDevelopmentAuth,
  sharedDevelopmentAuthAdmitted,
} from './shared-development-auth.mjs';

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

function syntheticEmail(identity, secret, entry, appId) {
  const digest = createHmac('sha256', secret)
    .update(`${entry.identityRealm}\0${entry.providerInstallationId}\0${appId}\0${identity.issuer}\0${identity.subject}`)
    .digest('hex');
  return `social-${digest.slice(0, 40)}@knockoff.invalid`;
}

function suggestedProfile(identity, entry, appId) {
  const base = identity.displayName.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_|_$/gu, '') || identity.provider;
  const suffix = createHash('sha256')
    .update(`${entry.identityRealm}\0${entry.providerInstallationId}\0${appId}\0${identity.issuer}\0${identity.subject}`)
    .digest('hex')
    .slice(0, 6);
  return Object.freeze({
    displayName: identity.displayName,
    handle: `${base.slice(0, 16)}_${suffix}`,
    avatarUrl: identity.avatarUrl || `https://api.dicebear.com/9.x/thumbs/png?seed=${encodeURIComponent(suffix)}`,
    provider: identity.provider,
  });
}

async function capturedExchange(config, identity, entry) {
  const email = syntheticEmail(identity, config.identitySecret, entry, config.appId);
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

  function entry(provider, adapter, identityRealm) {
    return Object.freeze({
      provider,
      adapter,
      identityRealm,
      providerInstallationId: identityRealm === 'rehearsal'
        ? `shared-development:${config.appId}:${provider}:v1`
        : `app-owned:${config.appId}:${provider}:v1`,
      authProfileGeneration: `${identityRealm}:${adapter}:${provider}:v1`,
    });
  }

  async function complete(identity, resolvedEntry) {
    return Object.freeze({
      exchange: await capturedExchange(config, identity, resolvedEntry),
      profile: suggestedProfile(identity, resolvedEntry, config.appId),
      entry: resolvedEntry,
    });
  }

  const shared = sharedDevelopmentAuthAdmitted(config)
    ? createSharedDevelopmentAuth({
        appId: config.appId,
        returnTargets: config.sharedReturnTargets,
        identityFor: fixtureIdentity,
        userLimit: config.sharedUserLimit ?? 100,
        completeIdentity: (identity) => complete(
          identity,
          entry(identity.provider, 'snapback-shared-browser', 'rehearsal'),
        ),
      })
    : null;

  function sendHtml(response, status, html) {
    response.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(html);
  }

  function sharedPage(transactionId) {
    const { provider } = shared.inspect(transactionId);
    const label = provider === 'apple' ? 'Apple' : 'Google';
    const completePath = `/v1/shared/complete?transaction=${encodeURIComponent(transactionId)}`;
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="1;url=${completePath}"><title>Snapback Development Auth</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f3ef;color:#191715;display:grid;min-height:100vh;margin:0;place-items:center}.panel{max-width:360px;padding:32px;text-align:center}.mark{background:#ef4c3e;border-radius:24px;color:white;display:grid;font-size:42px;font-weight:900;height:76px;margin:0 auto 24px;place-items:center;transform:rotate(-5deg);width:76px}h1{font-size:28px;margin:0 0 12px}p{color:#68625d;line-height:1.5}a{background:#191715;border:0;border-radius:14px;color:white;display:block;font-size:17px;font-weight:700;margin-top:18px;padding:16px 22px;text-decoration:none}.note{font-size:12px;margin-top:20px}</style></head><body><main class="panel"><div class="mark">S</div><h1>Snapback Development Auth</h1><p>Continuing with the shared ${label} development profile for Knockoff.</p><a href="${completePath}">Continue with ${label}</a><p class="note">Development identity only. It cannot enter staging or production.</p></main></body></html>`;
  }

  async function routeJson(request, url) {
    if (request.method !== 'POST') throw new TypeError('broker routes require POST');
    const body = await readJson(request);
    if (url.pathname === '/v1/fixture/login') {
      if (config.allowFixtures !== true) throw new TypeError('fixture login is disabled');
      const identity = fixtureIdentity(body.provider);
      return { status: 200, body: await complete(
        identity,
        entry(identity.provider, 'synthetic', 'rehearsal'),
      ) };
    }
    if (url.pathname === '/v1/shared/start') {
      if (!shared) throw new TypeError('shared development auth is disabled');
      return { status: 200, body: shared.start(body) };
    }
    if (url.pathname === '/v1/shared/redeem') {
      if (!shared) throw new TypeError('shared development auth is disabled');
      return { status: 200, body: await shared.redeem(body) };
    }
    if (url.pathname === '/v1/apple/native') {
      const identity = await verifyAppleIdentityToken(body.identityToken, {
        audience: config.appleClientId,
        nonce: body.nonce,
        displayName: body.displayName,
      });
      return { status: 200, body: await complete(
        identity,
        entry('apple', 'app-owned-native', 'application'),
      ) };
    }
    if (url.pathname === '/v1/google/native') {
      const identity = await verifyGoogleIdentityToken(body.idToken, {
        audience: config.googleClientId,
        nonce: body.nonce,
      });
      return { status: 200, body: await complete(
        identity,
        entry('google', 'app-owned-native', 'application'),
      ) };
    }
    if (url.pathname === '/v1/google/code') {
      const identity = await exchangeGoogleAuthorizationCode({
        code: body.code,
        codeVerifier: body.codeVerifier,
        redirectUri: body.redirectUri,
        clientId: config.googleClientId,
      });
      return { status: 200, body: await complete(
        identity,
        entry('google', 'app-owned-browser', 'application'),
      ) };
    }
    return { status: 404, body: { diagnostic: { code: 'KNOCKOFF_AUTH_ROUTE_UNKNOWN', message: 'Unknown broker route.' } } };
  }

  return Object.freeze({
    async handle(request, response) {
      try {
        const url = new URL(request.url ?? '/', 'http://knockoff.local');
        if (request.method === 'OPTIONS') {
          response.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'content-type',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
          });
          response.end();
          return;
        }
        if (url.pathname === '/v1/shared/authorize' && request.method === 'GET') {
          if (!shared) throw new TypeError('shared development auth is disabled');
          sendHtml(response, 200, sharedPage(url.searchParams.get('transaction')));
          return;
        }
        if (url.pathname === '/v1/shared/complete' && request.method === 'GET') {
          if (!shared) throw new TypeError('shared development auth is disabled');
          response.writeHead(302, {
            location: shared.authorize(url.searchParams.get('transaction')),
            'cache-control': 'no-store',
          });
          response.end();
          return;
        }
        if (url.pathname === '/v1/shared/authorize' && request.method === 'POST') {
          if (!shared) throw new TypeError('shared development auth is disabled');
          const chunks = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > BODY_LIMIT) throw new TypeError('broker request is too large');
            chunks.push(chunk);
          }
          const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
          response.writeHead(302, {
            location: shared.authorize(form.get('transaction')),
            'cache-control': 'no-store',
          });
          response.end();
          return;
        }
        const result = await routeJson(request, url);
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
