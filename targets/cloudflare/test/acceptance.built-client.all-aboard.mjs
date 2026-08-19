// ENG-24993 acceptance: EXECUTE the built All Aboard production client against
// a stub gateway, rather than exercising the source client factory and
// grepping the bundle for a guard literal.
//
// The pre-auth Cloudflare proof ships a browser/native artifact whose client
// is selected at build time by `__SNAPBACK_TARGET_PROFILE__` (compiled into
// the separate web-target.ts and snapback-target.ts adapters consumed by
// main.ts and native.ts). A Vite `define` or target-entry wiring regression
// could keep the pre-auth factory's guard literal in the bundle while actually
// executing the auth-capable local branch — so the DEPLOYED browser would
// probe the unsupported `/auth/session` handshake. A text search over the
// bundle cannot see that: only running the compiled client can.
//
// This suite compiles the REAL production target-selection module and the REAL
// kit client with the exact production target-profile define (the same
// SNAPBACK_ALL_ABOARD_TARGET_PROFILE contract vite.config.ts consumes), boots
// the compiled client against an intercepted stub gateway, drives a query, and
// asserts runtime behavior. It builds BOTH the cloudflare and the local
// profiles so the assertions are execution evidence. The Cloudflare branch
// returns explicit nulls for all four axes, while the local branch leaves them
// unconfigured: protocol 1 may be enabled only by supplying a real
// AuthCoordinator. That runtime shape distinguishes the folded branches
// without reintroducing an independent bearer/protocol owner.
//
// @ref LLP 0040#capability-report — external auth is an explicit Cloudflare gap.
// @ref LLP 0058#kit-ordering — auth probing is selected by target, never by a
//   failed network probe; the executed client must offer every auth axis null.
//
// Run: node targets/cloudflare/test/acceptance.built-client.all-aboard.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const surfaceRoot = path.join(repoRoot, 'demos/all-aboard/surfaces/contract');
const webTargetModule = path.join(surfaceRoot, 'web-target.ts');
const nativeTargetModule = path.join(surfaceRoot, 'snapback-target.ts');
const webEntryModule = path.join(surfaceRoot, 'main.ts');
const kitClientModule = path.join(repoRoot, 'demos/_kit/client.mjs');

const CLOUDFLARE_PROFILE = 'cloudflare-do-sqlite-v8';
const LOCAL_PROFILE = 'local-dev-sqlite-ibex';

// The four independently negotiated auth protocol axes and their wire headers.
const AUTH_PROTOCOL_AXES = Object.freeze([
  'authClient',
  'authInvalidation',
  'authorityDescriptor',
  'authorizedLease',
]);
const AUTH_PROTOCOL_HEADERS = Object.freeze([
  'x-snapback-auth-client-protocol',
  'x-snapback-auth-invalidation-protocol',
  'x-snapback-authority-descriptor-protocol',
  'x-snapback-authorized-lease-protocol',
]);

let checks = 0;
function check(label, condition) {
  assert.ok(condition, `built-client acceptance failed: ${label}`);
  checks += 1;
}

// A production-shaped entry that constructs the client EXACTLY as the shipped
// web (main.ts) and native (native.ts) entries do:
//   new SnapbackClient(<surface base url>, snapbackTargetClientOptions())
// The client-selection and base-url resolution both run through the real
// surface-specific adapters, so a wiring regression is executed here, not
// merely searched for.
function entrySource() {
  return `
import {
  snapbackTargetClientOptions as webTargetClientOptions,
  snapbackWebBaseUrl,
} from ${JSON.stringify(webTargetModule)};
import {
  snapbackTargetClientOptions as nativeTargetClientOptions,
  snapbackNativeBaseUrl,
} from ${JSON.stringify(nativeTargetModule)};
import { SnapbackClient } from ${JSON.stringify(kitClientModule)};

export function targetClientOptions(surface) {
  return surface === 'web' ? webTargetClientOptions() : nativeTargetClientOptions();
}

// Mirrors main.ts — the shipped web entry's client construction.
export function bootWebClient(serverOrigin) {
  const base = snapbackWebBaseUrl('same-origin', serverOrigin);
  return { base, client: new SnapbackClient(base, webTargetClientOptions()) };
}

// Mirrors native.ts — the shipped static native entry's client construction.
export function bootNativeClient(serverOrigin) {
  const base = snapbackNativeBaseUrl('same-origin', serverOrigin);
  return { base, client: new SnapbackClient(base, nativeTargetClientOptions()) };
}
`;
}

// Compile the production entry with the target-profile define folded in, the
// same way the production `vite build` folds SNAPBACK_ALL_ABOARD_TARGET_PROFILE
// into __SNAPBACK_TARGET_PROFILE__.
function buildEntry(tempDir, profile) {
  const entryPath = path.join(tempDir, `entry.${profile}.mjs`);
  const outPath = path.join(tempDir, `built.${profile}.mjs`);
  fs.writeFileSync(entryPath, entrySource());
  const result = spawnSync(
    'bun',
    [
      'build',
      entryPath,
      '--define',
      `__SNAPBACK_TARGET_PROFILE__=${JSON.stringify(profile)}`,
      '--target=node',
      '--format=esm',
      '--outfile',
      outPath,
    ],
    { cwd: repoRoot, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(
    result.status,
    0,
    `built-client build failed for ${profile}:\n${result.stdout}${result.stderr}`,
  );
  // The build must actually fold the define to a constant target, not leave the
  // undefined identifier (which silently falls back to the auth-capable local
  // profile). This is a build-integrity guard, not the execution evidence.
  const built = fs.readFileSync(outPath, 'utf8');
  assert.doesNotMatch(
    built,
    /typeof __SNAPBACK_TARGET_PROFILE__/,
    `${profile} build did not fold the target-profile define`,
  );
  return outPath;
}

// A stub gateway: record every requested path and the headers of the driven
// query, and answer just enough for the kit client to complete a query. It is
// never a real server and never the live deployment.
function installStubGateway() {
  const requestedPaths = [];
  const queryHeaders = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const pathname = new URL(url, 'http://stub.gateway.local').pathname;
    requestedPaths.push(pathname);
    const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined));
    if (pathname.endsWith('/query/stationsQuery')) {
      queryHeaders.push(headers);
    }
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (pathname.endsWith('/inspect')) return json({ ok: true, supportedAuthModes: ['dev'] });
    if (pathname.endsWith('/query/stationsQuery')) {
      return json({ ok: true, rows: [{ stationId: 'san-francisco' }], version: 1 });
    }
    // Present only so an accidentally auth-capable client's handshake does not
    // crash before we can observe that it probed the endpoint at all.
    if (pathname.endsWith('/auth/session')) {
      return json({ protocol: 1, availability: { onlineRequestResponse: 'available' } });
    }
    return json({ ok: true });
  };
  return {
    requestedPaths,
    queryHeaders,
    restore() {
      globalThis.fetch = nativeFetch;
    },
  };
}

async function driveClient(builtPath, surface) {
  const mod = await import(pathToFileURL(builtPath).href);
  const options = mod.targetClientOptions(surface);
  const gateway = installStubGateway();
  let booted;
  let queryError = null;
  try {
    booted = surface === 'web'
      ? mod.bootWebClient(undefined)
      : mod.bootNativeClient('http://gateway.example');
    try {
      await booted.client.query('stationsQuery', {});
    } catch (error) {
      // A regressed auth-capable client may fail its handshake against the
      // stub; the request paths still record what it attempted.
      queryError = error;
    }
  } finally {
    gateway.restore();
  }
  return {
    options,
    authProtocols: booted?.client?.authProtocols ?? null,
    base: booted?.base,
    requestedPaths: gateway.requestedPaths,
    queryHeaders: gateway.queryHeaders,
    queryError,
  };
}

function probedAuthSession(requestedPaths) {
  return requestedPaths.some((pathname) => pathname.endsWith('/auth/session'));
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapback-built-client-'));
  try {
    const webEntrySource = fs.readFileSync(webEntryModule, 'utf8');
    check(
      'the shipped web entry imports the proxy-safe web target adapter',
      /from\s+['"]\.\/web-target['"]/.test(webEntrySource),
    );
    check(
      'the shipped web entry never imports the native /snapback-target module',
      !/from\s+['"]\.\/snapback-target['"]/.test(webEntrySource),
    );

    const cloudflareBuild = buildEntry(tempDir, CLOUDFLARE_PROFILE);
    const localBuild = buildEntry(tempDir, LOCAL_PROFILE);

    for (const surface of ['web', 'native']) {
      // --- the shipped pre-auth Cloudflare artifact -----------------------
      const cf = await driveClient(cloudflareBuild, surface);
      check(
        `${surface}: built Cloudflare client offers all four auth protocol axes as null`,
        cf.authProtocols !== null &&
          AUTH_PROTOCOL_AXES.every((axis) => cf.authProtocols[axis] === null),
      );
      check(
        `${surface}: built Cloudflare target options declare every auth axis null`,
        AUTH_PROTOCOL_AXES.every((axis) => cf.options[`${axis}Protocol`] === null),
      );
      check(
        `${surface}: built Cloudflare client completes a query with no error`,
        cf.queryError === null && cf.requestedPaths.some((p) => p.endsWith('/query/stationsQuery')),
      );
      check(
        `${surface}: built Cloudflare client never probes /auth/session`,
        !probedAuthSession(cf.requestedPaths),
      );
      check(
        `${surface}: built Cloudflare query sends no auth-protocol wire headers`,
        cf.queryHeaders.length > 0 &&
          cf.queryHeaders.every((headers) =>
            AUTH_PROTOCOL_HEADERS.every((name) => !headers.has(name)),
          ),
      );

      // --- discriminator: the coordinator-neutral local artifact ----------
      // Proves the assertions above are EXECUTION evidence. Protocol 1 no
      // longer has an implicit local default: a real surface must provide its
      // AuthCoordinator. The local branch is therefore distinguishable by
      // absent option members rather than a forbidden coordinator-free offer.
      const local = await driveClient(localBuild, surface);
      check(
        `${surface}: built local target leaves auth axes unconfigured for explicit coordinator custody`,
        AUTH_PROTOCOL_AXES.every((axis) => local.options[`${axis}Protocol`] === undefined),
      );
      check(
        `${surface}: coordinator-free local client does not forge a protocol-1 handshake`,
        local.authProtocols?.authClient === null && !probedAuthSession(local.requestedPaths),
      );
    }

    console.log(`all-aboard built-client acceptance: ${checks}/${checks} checks passed`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
