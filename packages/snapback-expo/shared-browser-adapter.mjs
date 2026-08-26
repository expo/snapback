// The Expo shared development browser Adapter.
//
// This is the client half of the LLP 0151 shared development profile on Expo:
// it opens the supervisor's authorization page in an external user agent, reads
// the one-use completion code from the return URL, redeems it with the verifier
// it kept, and hands the caller the short-lived external completion. It never
// mints a session — `auth.signIn` redeems that completion through the ordinary
// coordinator.
//
// It is deliberately module-injected. `expo-web-browser` and `expo-linking` are
// not dependencies of this package: an app that never enables a provider should
// not acquire them, and an app that does gets a named refusal rather than a
// bundler error.
//
// @ref LLP 0151#shared-development-browser-adapter — the external-user-agent
// completion flow on native, the server-callback flow on web; the app holds the
// redemption verifier throughout.

import {
  createSharedDevelopmentVerifier,
  readSharedDevelopmentCallback,
  redeemSharedDevelopmentAuth,
  sharedDevelopmentAuthRefusal,
  sharedDevelopmentAuthorizationUrl,
  startSharedDevelopmentAuth,
} from '@expo/snapback-client/shared-development-auth';

/**
 * Pick the return target this runtime can actually receive.
 *
 * The supervisor allowlists a small derived set — `exp://` deep links for Expo
 * Go and `http://` origins for Expo web. The client asks its own linking module
 * what URL it would receive, and uses it only if the supervisor already
 * allowlisted it. A runtime whose URL is not in the set refuses rather than
 * asking the broker to widen its allowlist.
 */
export function selectSharedAuthReturnTarget(projection, createdUrl) {
  const allowed = projection?.returnTargets ?? [];
  if (allowed.length === 0) {
    throw sharedDevelopmentAuthRefusal(
      'return-target-missing',
      'the supervisor published no shared development return target',
    );
  }
  if (typeof createdUrl === 'string') {
    const normalized = allowed.find((candidate) => candidate === createdUrl);
    if (normalized !== undefined) return normalized;
  }
  throw sharedDevelopmentAuthRefusal(
    'return-target-not-allowlisted',
    'this runtime\'s return URL is not one the supervisor allowlisted',
    { observed: createdUrl ?? null, allowed },
  );
}

/**
 * Build the `snapback-shared-browser` Adapter for one supervised projection.
 *
 * `openAuthSession` is `WebBrowser.openAuthSessionAsync`; `createUrl` is
 * `Linking.createURL`. Both are injected so this module stays free of optional
 * native dependencies and testable without a device.
 */
export function createSharedBrowserAdapter({
  projection,
  appId,
  openAuthSession,
  createUrl,
  path = 'auth/shared',
  timeoutMs,
}) {
  if (projection?.available !== true) {
    throw sharedDevelopmentAuthRefusal(
      'projection-unavailable',
      'the supervisor did not publish an available shared development profile',
      { reason: projection?.reason ?? null },
    );
  }
  if (typeof openAuthSession !== 'function' || typeof createUrl !== 'function') {
    throw sharedDevelopmentAuthRefusal(
      'expo-modules-unavailable',
      'the shared development Adapter needs expo-web-browser and expo-linking; install them or configure app-owned credentials',
    );
  }
  const options = timeoutMs === undefined ? {} : { timeoutMs };

  return async function signInWithSharedBrowser(entry) {
    const { verifier, codeChallenge } = await createSharedDevelopmentVerifier();
    const returnTo = selectSharedAuthReturnTarget(projection, createUrl(`/${path}`));
    const started = await startSharedDevelopmentAuth(projection.origin, {
      appId,
      provider: entry.provider,
      returnTo,
      codeChallenge,
    }, options);

    const authorizationUrl = sharedDevelopmentAuthorizationUrl(projection.origin, started);
    const session = await openAuthSession(authorizationUrl, returnTo);
    if (session?.type !== 'success' || typeof session.url !== 'string') {
      // Cancellation and dismissal are the result of this attempt. There is no
      // second Adapter to try (LLP 0151 §native failures never fall back).
      throw sharedDevelopmentAuthRefusal(
        session?.type === 'cancel' || session?.type === 'dismiss'
          ? 'user-cancelled'
          : 'browser-session-failed',
        session?.type === 'cancel' || session?.type === 'dismiss'
          ? 'the shared development sign-in was cancelled'
          : 'the external user agent did not return a completion',
        { sessionType: session?.type ?? null },
      );
    }
    const { code } = readSharedDevelopmentCallback(session.url, started);
    const redeemed = await redeemSharedDevelopmentAuth(projection.origin, {
      appId,
      code,
      verifier,
    }, options);
    if (typeof redeemed?.exchange?.challengeId !== 'string'
      || typeof redeemed?.exchange?.code !== 'string') {
      throw sharedDevelopmentAuthRefusal(
        'completion-invalid',
        'the shared development broker returned no short-lived external completion',
      );
    }
    // Exactly the completion the ordinary coordinator redeems. No provider
    // token, no session credential, and no identity of any kind.
    return Object.freeze({ exchange: redeemed.exchange });
  };
}

/**
 * Resolve `expo-web-browser` and `expo-linking` if this app installed them.
 *
 * Returns null when either is absent, so the caller can carry on without the
 * shared Adapter instead of failing to boot. The app that then calls
 * `auth.signIn` gets a named refusal from the dispatcher.
 */
function loadOptionalExpoSharedBrowserModule(specifier) {
  // @ref LLP 0181#metro-and-package-closure — the shipped Expo tuple must
  // transform every client module while optional Expo adapters stay optional.
  // Metro requires a literal dynamic-import target. Keeping the rejection
  // handler on each import also tells Expo's Metro transformer that these are
  // optional dependencies: apps without provider auth still bundle, while an
  // app that installs the modules gets the ordinary ESM namespace in Metro,
  // Node, and other headless ESM runtimes.
  if (specifier === 'expo-web-browser') {
    return import('expo-web-browser').catch((error) => Promise.reject(error));
  }
  if (specifier === 'expo-linking') {
    return import('expo-linking').catch((error) => Promise.reject(error));
  }
  return Promise.reject(new TypeError(`unsupported Expo shared browser module: ${specifier}`));
}

export async function resolveExpoSharedBrowserModules(load = loadOptionalExpoSharedBrowserModule) {
  try {
    const [webBrowser, linking] = await Promise.all([
      load('expo-web-browser'),
      load('expo-linking'),
    ]);
    // On web the completion lands in the popup, which loads this same app
    // bundle at the return target. `maybeCompleteAuthSession` is what tells the
    // opener the callback arrived and closes that popup; without it the
    // redirect succeeds and the attempt still hangs. Calling it here keeps the
    // one-method promise intact — an app does not have to know this incantation
    // to use `auth.signIn`. It is a no-op off web and when there is nothing to
    // complete.
    const maybeComplete = webBrowser?.maybeCompleteAuthSession
      ?? webBrowser?.default?.maybeCompleteAuthSession;
    if (typeof maybeComplete === 'function' && typeof globalThis.location?.href === 'string') {
      try {
        maybeComplete();
      } catch {
        // A runtime that cannot complete a session here still gets the Adapter;
        // the attempt reports its own refusal rather than failing to boot.
      }
    }
    const openAuthSession = webBrowser?.openAuthSessionAsync ?? webBrowser?.default?.openAuthSessionAsync;
    const createUrl = linking?.createURL ?? linking?.default?.createURL;
    if (typeof openAuthSession !== 'function' || typeof createUrl !== 'function') return null;
    return Object.freeze({
      openAuthSession: (...args) => openAuthSession(...args),
      createUrl: (...args) => createUrl(...args),
    });
  } catch {
    return null;
  }
}
