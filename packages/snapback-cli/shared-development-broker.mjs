// The supervised shared development auth broker.
//
// `snapback dev` mounts this on the origin the Expo client already discovers,
// so a new app gets working development sign-in with no second terminal, no
// broker origin to configure, and no `EXPO_PUBLIC_*` variable to set. The
// origin and the exact return target travel to the client inside the ordinary
// bootstrap exchange, which is credential-free.
//
// The identities it issues are hermetic rehearsal identities produced by this
// process. They are **not** Apple or Google logins: nothing here contacts a
// provider, and the issuer names its own provenance so nothing downstream can
// mistake it for one.
//
// The completion path is the ordinary one. The broker mints a short-lived
// external code through the running deployment's own capture mailbox and hands
// the client `{ challengeId, code }`; the client redeems it through
// `auth.signIn`, and the ordinary coordinator issues and owns the session. No
// provider token and no Snapback session credential ever crosses a URL.
//
// @ref LLP 0151#shared-development-browser-adapter — mechanism lives here;
// admission is repeated from server-held state on every transaction.

import { SnapbackClient } from '@expo/snapback-client';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';
import {
  SHARED_DEVELOPMENT_AUTH_ROUTES,
  sharedDevelopmentAuthRefusal as refuse,
} from '@expo/snapback-client/shared-development-auth';

import {
  createSharedDevelopmentAuth,
  sharedDevelopmentAuthAdmitted,
  sharedDevelopmentIdentityKey,
  sharedDevelopmentRehearsalIdentity,
} from './shared-development-auth.mjs';

const BODY_LIMIT_BYTES = 64 * 1024;

/// A rehearsal identity's mailbox address. Derived from the app-scoped identity
/// key, so it is stable per (app, provider installation, provider subject) and
/// carries no personal data. The `.invalid` TLD cannot resolve, so nothing
/// here can accidentally send mail.
function rehearsalMailbox(identity, { appId, providerInstallationId }) {
  const key = sharedDevelopmentIdentityKey({
    appId,
    providerInstallationId,
    issuer: identity.issuer,
    subject: identity.subject,
  });
  return `snapback-rehearsal-${key.slice(0, 40)}@shared-development.invalid`;
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > BODY_LIMIT_BYTES) {
      throw refuse('request-too-large', 'shared development auth request body exceeded its limit');
    }
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw refuse('request-body-invalid', 'shared development auth request body must be JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw refuse('request-body-invalid', 'shared development auth request body must be an object');
  }
  return value;
}

/**
 * Mint one short-lived external completion for a rehearsal identity through the
 * running deployment's own capture mailbox.
 *
 * This is the ordinary email-code completion path, used with an address that
 * cannot receive mail. The broker never mints a session itself: it hands the
 * client a code the client redeems, so custody and authority replacement stay
 * with the ordinary coordinator.
 */
async function captureExternalCompletion({
  serverOrigin,
  adminToken,
  impersonationCapability,
  appId,
  address,
  fetchImpl = fetch,
}) {
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(serverOrigin, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: `snapback-shared-development-broker-${address.slice(0, 24)}`,
    rqsStore: null,
  });
  try {
    const challenge = await client.auth.authRequestCode(address);
    const response = await fetchImpl(
      `${serverOrigin}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(challenge.challengeId)}`,
      {
        headers: {
          'x-snapback-admin-token': adminToken,
          'x-snapback-impersonation-capability': impersonationCapability,
        },
      },
    );
    const mailbox = await response.json();
    if (!response.ok
      || mailbox.challengeId !== challenge.challengeId
      || mailbox.canonicalAddress !== address
      || typeof mailbox.code !== 'string') {
      throw refuse(
        'capture-mailbox-refused',
        'the development capture mailbox refused the shared development broker',
        { status: response.status },
      );
    }
    return Object.freeze({ challengeId: challenge.challengeId, code: mailbox.code });
  } finally {
    await client.closeAuth();
  }
}

function authorizationPage(provider) {
  const label = provider === 'apple' ? 'Apple' : 'Google';
  const completePath = SHARED_DEVELOPMENT_AUTH_ROUTES.complete;
  return { label, completePath };
}

function renderAuthorizationPage(transactionId, provider) {
  const { label, completePath } = authorizationPage(provider);
  const target = `${completePath}?transaction=${encodeURIComponent(transactionId)}`;
  // No inline script and no third-party origin. `default-src 'none'` plus a
  // `form-action` limited to this origin and the supervisor's own allowlisted
  // return targets means this page can only post back here, and the completion
  // it triggers can only land on a target the supervisor already derived.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>Snapback development sign-in</title>`
    + `<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f3ef;color:#191715;display:grid;min-height:100vh;margin:0;place-items:center}`
    + `main{max-width:26rem;padding:2rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .75rem}`
    + `p{color:#68625d;line-height:1.5}button{background:#191715;border:0;border-radius:.875rem;color:#fff;font:inherit;font-weight:700;margin-top:1.25rem;padding:1rem 1.5rem;width:100%}`
    + `.note{font-size:.75rem;margin-top:1.5rem}</style></head><body><main>`
    + `<h1>Snapback development sign-in</h1>`
    + `<p>Continuing with the shared ${label} development profile.</p>`
    + `<form method="post" action="${target}"><button type="submit">Continue with ${label}</button></form>`
    + `<p class="note">This is a hermetic rehearsal identity, not a real ${label} account. `
    + `It cannot enter a staging or production deployment.</p>`
    + `</main></body></html>`;
}

/**
 * Build the supervised broker for one app.
 *
 * `deployment` and the preview facts come from server-held supervisor state,
 * never from a client claim. When admission fails, `available` is false and
 * every route refuses — the client then resolves to a blocked entry with a next
 * action rather than a silent shared sign-in.
 */
export function createSharedDevelopmentBroker({
  appId,
  serverOrigin,
  adminToken,
  impersonationCapability,
  returnTargets,
  deploymentProfile = 'development',
  allowSharedDevelopment = true,
  previewOwnerAuthenticated = false,
  previewExpiresAt = null,
  userLimit,
  fetchImpl = fetch,
  now = () => Date.now(),
}) {
  const admissionConfig = Object.freeze({
    allowSharedDevelopment,
    deploymentProfile,
    previewOwnerAuthenticated,
    previewExpiresAt,
  });
  const admitted = sharedDevelopmentAuthAdmitted(admissionConfig, now());
  if (!admitted) {
    return Object.freeze({
      available: false,
      deploymentProfile,
      returnTargets: Object.freeze([...(returnTargets ?? [])]),
      routes: SHARED_DEVELOPMENT_AUTH_ROUTES,
      handle: () => false,
    });
  }
  const providerInstallationFor = (provider) => `shared-development:${appId}:${provider}:v1`;
  const transactions = createSharedDevelopmentAuth({
    appId,
    returnTargets,
    ...(userLimit === undefined ? {} : { userLimit }),
    now,
    identityFor: (provider) => sharedDevelopmentRehearsalIdentity(provider, { appId }),
    completeIdentity: async (identity) => {
      const providerInstallationId = providerInstallationFor(identity.provider);
      const exchange = await captureExternalCompletion({
        serverOrigin,
        adminToken,
        impersonationCapability,
        appId,
        address: rehearsalMailbox(identity, { appId, providerInstallationId }),
        fetchImpl,
      });
      return Object.freeze({
        // Exactly the short-lived external completion. No provider token, no
        // Snapback session credential, no email address.
        exchange,
        entry: Object.freeze({
          provider: identity.provider,
          adapter: 'snapback-shared-browser',
          identityRealm: 'rehearsal',
          providerInstallationId,
        }),
      });
    },
  });

  // The exact origins a supervised browser client can call these JSON routes
  // from: the http(s) half of the return-target allowlist the supervisor
  // already derived from its own client port. On Expo Go the app is a React
  // Native runtime and sends no `Origin` at all; on Expo web it is a page on
  // the Metro front origin, which is a different origin from this broker, so
  // without an exact-origin projection the browser blocks its own request
  // before the route ever runs.
  //
  // @ref LLP 0151#shared-development-browser-adapter — external user agent on
  // native, server callback on web. Nothing here widens the allowlist: an
  // origin the supervisor did not derive gets no headers and stays blocked.
  const browserOrigins = new Set((returnTargets ?? []).flatMap((target) => {
    try {
      const { protocol, origin } = new URL(target);
      return protocol === 'http:' || protocol === 'https:' ? [origin] : [];
    } catch {
      return [];
    }
  }));

  function presentedBrowserOrigin(request) {
    const origin = request?.headers?.origin;
    return typeof origin === 'string' ? origin : null;
  }

  function admittedBrowserOrigin(request) {
    const origin = presentedBrowserOrigin(request);
    return origin !== null && browserOrigins.has(origin) ? origin : null;
  }

  function corsHeaders(origin) {
    return origin === null ? {} : {
      'access-control-allow-origin': origin,
      vary: 'Origin',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    };
  }

  function sendJson(response, status, body, origin = null) {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      ...corsHeaders(origin),
    });
    response.end(JSON.stringify(body));
  }

  function sendRefusal(response, error, origin = null) {
    sendJson(response, 400, {
      ok: false,
      diagnostic: error?.diagnostic ?? {
        code: 'SNAPBACK_AUTH_SHARED_DEVELOPMENT_REFUSED',
        message: error?.message ?? 'shared development auth refused',
        details: { reason: 'unknown' },
      },
    }, origin);
  }

  /**
   * Handle one request if it belongs to this broker. Returns false when the
   * path is not ours, so the host listener keeps its own routing.
   */
  async function handle(request, response, url) {
    const { pathname } = url;
    if (!pathname.startsWith('/v1/shared/')) return false;
    // Cross-origin browser calls reach the JSON routes only from an origin the
    // supervisor itself derived; the HTML route is same-origin by construction.
    if (pathname === SHARED_DEVELOPMENT_AUTH_ROUTES.start
      || pathname === SHARED_DEVELOPMENT_AUTH_ROUTES.redeem) {
      const presentedOrigin = presentedBrowserOrigin(request);
      const origin = admittedBrowserOrigin(request);
      // CORS hides an unadmitted response; it does not prevent a foreign page
      // from sending a simple request. Refuse any present-but-unadmitted
      // Origin before reading the body or creating/redeeming a transaction.
      // Originless native and server-side clients retain their existing path.
      if (presentedOrigin !== null && origin === null) {
        sendRefusal(
          response,
          refuse(
            'origin-not-allowlisted',
            'shared development auth request origin is not allowlisted',
          ),
        );
        return true;
      }
      // A JSON body makes the browser preflight before it will send the call.
      if (request.method === 'OPTIONS' && origin !== null) {
        response.writeHead(204, {
          ...corsHeaders(origin),
          'access-control-max-age': '600',
          'cache-control': 'no-store',
        });
        response.end();
        return true;
      }
      if (request.method !== 'POST') {
        sendRefusal(response, refuse('method-not-allowed', `${pathname} requires POST`), origin);
        return true;
      }
      try {
        const body = await readJsonBody(request);
        const result = pathname === SHARED_DEVELOPMENT_AUTH_ROUTES.start
          ? transactions.start(body)
          : await transactions.redeem(body);
        sendJson(response, 200, result, origin);
      } catch (error) {
        sendRefusal(response, error, origin);
      }
      return true;
    }
    if (pathname === SHARED_DEVELOPMENT_AUTH_ROUTES.authorize && request.method === 'GET') {
      try {
        const transactionId = url.searchParams.get('transaction');
        const { provider } = transactions.inspect(transactionId);
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          // `form-action` governs where a submission may *end up*, redirects
          // included, so the completion's 303 to the app's own origin needs
          // that origin named here. Anything the supervisor did not derive is
          // still refused, by this policy and by the route itself.
          'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${["'self'", ...browserOrigins].join(' ')}; base-uri 'none'; frame-ancestors 'none'`,
        });
        response.end(renderAuthorizationPage(transactionId, provider));
      } catch (error) {
        sendRefusal(response, error);
      }
      return true;
    }
    if (pathname === SHARED_DEVELOPMENT_AUTH_ROUTES.complete && request.method === 'POST') {
      try {
        // Consume the body so the connection is not left half-read.
        for await (const chunk of request) void chunk;
        const location = transactions.authorize(url.searchParams.get('transaction'));
        response.writeHead(303, { location, 'cache-control': 'no-store' });
        response.end();
      } catch (error) {
        sendRefusal(response, error);
      }
      return true;
    }
    sendRefusal(response, refuse('route-unknown', `${pathname} is not a shared development auth route`));
    return true;
  }

  return Object.freeze({
    available: true,
    deploymentProfile,
    returnTargets: Object.freeze([...returnTargets]),
    routes: SHARED_DEVELOPMENT_AUTH_ROUTES,
    userLimit: transactions.userLimit,
    admittedUserCount: transactions.admittedUserCount,
    handle,
  });
}

/**
 * The credential-free projection that travels to the client in the ordinary
 * bootstrap exchange: where the broker is, and the exact return target it will
 * accept. Nothing here is a secret, and there is nothing for an author to set.
 *
 * @ref LLP 0223#decision — auto-inject, do not auto-write. The supervised
 * origin is process-scoped supervisor state, not durable public configuration.
 */
export function sharedDevelopmentAuthProjection(broker, origin) {
  if (broker === null || broker.available !== true) {
    return Object.freeze({
      format: 'snapback.shared-development-auth-projection.v1',
      available: false,
      reason: broker === null
        ? 'no-broker'
        : `deployment-not-admitted:${broker.deploymentProfile}`,
    });
  }
  return Object.freeze({
    format: 'snapback.shared-development-auth-projection.v1',
    available: true,
    origin,
    returnTargets: broker.returnTargets,
    routes: broker.routes,
    identityRealm: 'rehearsal',
    userLimit: broker.userLimit,
    nonclaim: 'Hermetic rehearsal identities issued by the local supervisor, not Apple or Google logins.',
  });
}

/**
 * The exact return targets a supervised Expo client can actually receive,
 * derived from the supervised Metro port the supervisor already owns.
 *
 * Expo Go delivers `exp://<host>:<port>/--/<path>` deep links without a custom
 * development build, and Expo web returns to its own origin. Deriving the set
 * keeps exact allowlisting intact: the broker still refuses any callback URL it
 * was not given, and there is nothing for an author to register.
 *
 * @ref LLP 0151#shared-development-browser-adapter — the broker accepts a
 * generated app binding and a fixed provider name, never an arbitrary callback
 * URL.
 */
export function supervisedSharedAuthReturnTargets(metroPort, path = 'auth/shared') {
  if (!Number.isSafeInteger(metroPort) || metroPort < 1 || metroPort > 65_535) {
    throw refuse(
      'return-target-invalid',
      'supervised shared auth return targets need the supervised client port',
      { metroPort },
    );
  }
  const hosts = ['127.0.0.1', 'localhost'];
  return Object.freeze([
    ...hosts.map((host) => `exp://${host}:${metroPort}/--/${path}`),
    ...hosts.map((host) => `http://${host}:${metroPort}/${path}`),
  ]);
}
