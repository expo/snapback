// Unit conformance for the Channel A seam's pure pieces (LLP 0092 §0E.3):
// route matching after basePath/SPA-fallback normalization, the publicInline
// eligibility skip, and boot-payload injection. The end-to-end serving path
// (headers, degrade, first paint) is exercised by the graffiti browser
// acceptance suite (demos/graffiti/tests/acceptance/channel-a-browser.mjs).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  entryIsPublicInline,
  injectBootPayload,
  matchManifestRoute,
} from './channel-a.mjs';
import { serializeBootPayload } from './rqs-serializer.mjs';

const manifest = {
  formatVersion: 1,
  app: 'wall',
  routes: [
    { route: '/', queries: [{ function: 'listCells', args: { boardId: 'wall' } }] },
    { route: '/board/:boardId', queries: [{ function: 'listCells', args: { boardId: { $param: 'boardId' } } }] },
  ],
};

test('matches exact patterns and binds percent-decoded params', () => {
  assert.deepEqual(matchManifestRoute(manifest, '/').route, '/');
  assert.deepEqual(matchManifestRoute(manifest, '/?tab=1').route, '/');
  const bound = matchManifestRoute(manifest, '/board/b%20-7?x=1#frag');
  assert.equal(bound.route, '/board/:boardId');
  assert.deepEqual(bound.params, { boardId: 'b -7' });
  assert.equal(matchManifestRoute(manifest, '/nowhere'), null);
  assert.equal(matchManifestRoute(manifest, '/board/a/b'), null);
  // Percent-decode failure: unmatched, untransformed shell.
  assert.equal(matchManifestRoute(manifest, '/board/%zz'), null);
});

test('normalizes the fallback document and the configured base', () => {
  // The matched URL is the pre-fallback path; the literal /index.html the
  // fallback resolved to normalizes to / (LLP 0092 §0E.3 item 1).
  assert.equal(matchManifestRoute(manifest, '/index.html').route, '/');
  assert.equal(matchManifestRoute(manifest, '/app/board/wall', '/app/').route, '/board/:boardId');
  assert.equal(matchManifestRoute(manifest, '/app', '/app/').route, '/');
  assert.equal(matchManifestRoute(manifest, '/elsewhere/board/wall', '/app/'), null);
});

test('publicInline eligibility reads the codegen-compiled function fact', () => {
  const functions = {
    functions: [
      { name: 'listCells', publicInline: true },
      { name: 'listSecret' },
    ],
  };
  assert.ok(entryIsPublicInline(functions, manifest.routes[0]));
  assert.ok(!entryIsPublicInline(functions, {
    route: '/x',
    queries: [{ function: 'listSecret', args: {} }],
  }));
  assert.ok(!entryIsPublicInline(functions, { route: '/x', queries: [] }));
  assert.ok(!entryIsPublicInline({ functions: [] }, manifest.routes[0]));
});

test('injects the boot payload as a non-executable data block before </head>', () => {
  const serialized = serializeBootPayload({ rows: ['</script><script>alert(1)</script>'] });
  const html = '<!doctype html><html><head><title>t</title></head><body></body></html>';
  const out = injectBootPayload(html, serialized);
  assert.match(out, /<script type="application\/json" id="__snapback_boot">/);
  assert.ok(out.indexOf('__snapback_boot') < out.indexOf('</head>'));
  // The payload cannot terminate its element: no raw angle brackets survive.
  const inner = out.slice(out.indexOf('__snapback_boot">') + '__snapback_boot">'.length);
  const payload = inner.slice(0, inner.indexOf('</script>'));
  assert.ok(!payload.includes('<') && !payload.includes('>'));
  assert.deepEqual(JSON.parse(payload), { rows: ['</script><script>alert(1)</script>'] });
});
