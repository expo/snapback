// RQS on the Cloudflare arm — rollout step 4 acceptance (LLP 0090 D2/D1.1,
// LLP 0091 0A/0B, LLP 0092 0C/0D/0E; ENG-25455).
//
// What this local (Miniflare) harness proves — and what it cannot:
//   PROVEN here: coordinator resume admission (rungs 1 & 3) with per-cause
//   SNAPBACK_RESUME_* refusals over genuinely MAC'd tokens; token mint +
//   refresh on the live path; the read-mode bundle endpoint against the
//   compiled routes manifest; gateway Channel A composition (inline, degrade,
//   response mechanics); byte-exact serializer conformance; keyring rows in
//   DO SQLite surviving the /_snapback/api/object/evict in-memory-state clear (the ring is
//   storage-resident by construction); versionStream rotation across /_snapback/api/app/reset
//   refusing outstanding tokens.
//   NOT provable here: real platform eviction/machine moves (the keyring uses
//   the same DO SQLite class the subscription registry's remote eviction
//   evidence covers), a real deploy rotating `generation` (deploy identity is
//   compile-time; stale-generation admission is exercised via the
//   testing-gated mint override instead), and edge compression/caching.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProof } from './harness.mjs';
import { serializeBootPayload } from '../../../packages/snapback-vite/rqs-serializer.mjs';
import {
  functionRouteNestedArgTypes,
  substituteParamsV1,
  validateRoutesManifest,
} from '../src/rqs-host.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const ASSETS_DIR = path.join(here, 'fixtures/rqs-web');

let passed = 0;
let total = 0;
const failures = [];
function check(name, ok, detail = '') {
  total += 1;
  if (ok) {
    passed += 1;
  } else {
    failures.push({ name, detail });
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const BOOT_BLOCK = /<script type="application\/json" id="__snapback_boot">([^<]*)<\/script>/;

function extractBoot(html) {
  const match = html.match(BOOT_BLOCK);
  if (!match) return null;
  return { raw: match[1], parsed: JSON.parse(match[1]) };
}

// --- params-v1 structured-object admission and substitution ---------------
{
  const nestedFunction = {
    name: 'nestedBoard',
    kind: 'Query',
    argsContract: {
      fields: [{
        name: 'context',
        required: true,
        value: {
          kind: 'object',
          allowExtra: false,
          fields: [
            { name: 'boardId', required: true, value: { kind: 'string', maxBytes: 256 } },
            { name: 'rank', required: false, value: { kind: 'integer', min: 0, max: 100 } },
          ],
        },
      }],
    },
  };
  const mapping = { context: { boardId: { $param: 'boardId' } } };
  const positiveManifest = {
    formatVersion: 1,
    routes: [{
      route: '/nested/:boardId',
      queries: [{ function: 'nestedBoard', args: mapping }],
    }],
  };
  const functionsByName = (name) => (name === nestedFunction.name ? nestedFunction : null);
  check(
    'nested object-reachable route params admit from argsContract',
    validateRoutesManifest(positiveManifest, functionsByName, new Map()) === null,
  );
  const nestedTypes = functionRouteNestedArgTypes(nestedFunction);
  const substituted = substituteParamsV1(mapping, { boardId: 'wall' }, new Map(), nestedTypes);
  check(
    'nested object-reachable route params materialize before host evaluation',
    JSON.stringify(substituted.args) === JSON.stringify({ context: { boardId: 'wall' } }),
    JSON.stringify(substituted),
  );
  const arrayManifest = {
    formatVersion: 1,
    routes: [{
      route: '/nested-array/:boardId',
      queries: [{
        function: 'nestedBoard',
        args: { context: { values: [{ $param: 'boardId' }] } },
      }],
    }],
  };
  check(
    'a route param inside an array literal refuses host admission',
    /array literal/u.test(validateRoutesManifest(arrayManifest, functionsByName, new Map()) ?? ''),
  );
}

// --- serializer fixtures: the same corpus, byte-for-byte, through the same
// module the gateway Worker bundles (LLP 0092 §0E.2's Cloudflare test home).
{
  const fixtureDir = path.join(repoRoot, 'tests/fixtures/rqs-serializer');
  const index = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'cases.json'), 'utf8'));
  let mismatches = [];
  for (const testCase of index.cases) {
    const input = JSON.parse(fs.readFileSync(path.join(fixtureDir, testCase.input), 'utf8'));
    const expected = fs.readFileSync(path.join(fixtureDir, testCase.expected));
    const actual = Buffer.from(serializeBootPayload(input), 'utf8');
    if (!actual.equals(expected)) mismatches.push(testCase.name);
  }
  check(
    `serializer fixtures byte-exact on the Cloudflare assembler (${index.cases.length} cases)`,
    mismatches.length === 0,
    mismatches.join(', ')
  );
}

const proof = await startProof({ app: 'notes', assetsDirectory: ASSETS_DIR });
let degradedProof = null;
try {
  const DANGEROUS_TEXT = '</script><b>&amp; ';
  await proof.mutation('addNote', { boardId: 'b1', text: DANGEROUS_TEXT });

  // --- Channel A: manifested pageload serves inlined rows -----------------
  const page = await proof.raw('/board/b1', { headers: { accept: 'text/html' } });
  const pageHtml = await page.text();
  const boot = extractBoot(pageHtml);
  check('manifested pageload serves the boot payload', page.status === 200 && boot !== null, pageHtml.slice(0, 200));
  // Miniflare's dispatch transport re-encodes the body (mf-content-encoding
  // + chunked), so the Worker-set Content-Length is not observable here; when
  // the transport does surface one it must match the final bytes. no-store
  // and dropped validators are asserted directly.
  const surfacedLength = page.headers.get('content-length');
  check(
    'transformed document is no-store with dropped validators and a coherent length',
    page.headers.get('cache-control') === 'no-store'
      && page.headers.get('etag') === null
      && page.headers.get('last-modified') === null
      && (surfacedLength === null || Number(surfacedLength) === Buffer.byteLength(pageHtml, 'utf8')),
    JSON.stringify([...page.headers])
  );
  if (boot) {
    check(
      'boot payload carries the matched route, attestation facts, and inlined rows',
      boot.parsed.route === '/board/:boardId'
        && typeof boot.parsed.commitVersion === 'number'
        && String(boot.parsed.generation).startsWith('gen1:')
        && typeof boot.parsed.versionStream === 'string'
        && boot.parsed.entries.length === 1
        && boot.parsed.entries[0].function === 'boardNotes'
        && boot.parsed.entries[0].rows.length === 1
        && boot.parsed.entries[0].rows[0].text === DANGEROUS_TEXT,
      JSON.stringify(boot.parsed).slice(0, 300)
    );
    check(
      'embedded token is a resume envelope minted at the bundle commit',
      String(boot.parsed.entries[0].resume?.token).startsWith('sbrt1.')
        && boot.parsed.entries[0].resume.meta.version === boot.parsed.commitVersion
        && String(boot.parsed.entries[0].resume.meta.contentDigest).startsWith('mset1:'),
      JSON.stringify(boot.parsed.entries[0].resume)
    );
    check(
      'serialized payload obeys the whole-output byte property (no raw angle brackets)',
      !boot.raw.includes('<') && !boot.raw.includes('>') && boot.raw.includes('\\u003c'),
      boot.raw.slice(0, 120)
    );
  } else {
    check('boot payload facts (skipped: no payload)', false);
    check('boot payload token (skipped: no payload)', false);
    check('boot payload byte property (skipped: no payload)', false);
  }

  // --- Channel A: ineligible / unmanifested pageloads degrade -------------
  const privatePage = await proof.raw('/private', { headers: { accept: 'text/html' } });
  const privateHtml = await privatePage.text();
  check(
    'a route naming a non-publicInline query serves the untransformed shell',
    privatePage.status === 200 && !privateHtml.includes('__snapback_boot'),
    privateHtml.slice(0, 120)
  );
  const unmanifested = await proof.raw('/nowhere/at/all', { headers: { accept: 'text/html' } });
  const unmanifestedHtml = await unmanifested.text();
  check(
    'an unmanifested route serves the plain SPA shell untouched',
    unmanifested.status === 200 && !unmanifestedHtml.includes('__snapback_boot'),
    String(unmanifested.status)
  );

  // App-data namespaces are not web routes. Workers Assets may answer a miss
  // with the SPA index and HTTP 200, so the gateway must detect that fallback
  // across every reserved app-data prefix and return a typed target refusal.
  const appDataPrefixes = [
    '/auth', '/assets', '/ephemeral', '/push', '/app-api', '/client-mutations',
    '/live', '/outbox', '/query', '/mutation', '/action', '/connection',
  ];
  const appDataFallbacks = [];
  for (const prefix of appDataPrefixes) {
    const response = await proof.raw(`${prefix}/unsupported/extra`, {
      headers: { accept: 'text/html' },
    });
    const body = await response.json();
    appDataFallbacks.push({ prefix, status: response.status, body });
  }
  check(
    'every app-data-prefix SPA fallback becomes a versioned unsupported-target error',
    appDataFallbacks.every(({ status, body }) =>
      status === 501
      && body.formatVersion === 'snapback.error-response.v1'
      && body.diagnostic?.code === 'SNAPBACK_ROUTE_UNSUPPORTED_ON_TARGET'
      && body.diagnostic?.details?.target === 'cloudflare'),
    JSON.stringify(appDataFallbacks).slice(0, 1200),
  );
  const nonHtml = await proof.raw('/board/b1', { headers: { accept: 'application/json' } });
  const nonHtmlText = await nonHtml.text();
  check(
    'a non-HTML accept never transforms',
    !nonHtmlText.includes('__snapback_boot'),
    nonHtmlText.slice(0, 80)
  );

  // --- bundle endpoint (read mode) ----------------------------------------
  const bundlePost = async (body) => {
    const response = await proof.raw('/app/bundle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const readBundle = await bundlePost({ route: '/board/:boardId', params: { boardId: 'b1' }, mode: 'read' });
  check(
    'read-mode bundle answers rows + resume at one commit',
    readBundle.status === 200
      && readBundle.body.entries?.length === 1
      && readBundle.body.entries[0].rows.length === 1
      && readBundle.body.entries[0].resume?.meta?.version === readBundle.body.commitVersion
      && String(readBundle.body.generation).startsWith('gen1:'),
    JSON.stringify(readBundle).slice(0, 300)
  );
  const registerBundle = await bundlePost({
    route: '/board/:boardId',
    params: { boardId: 'b1' },
    mode: 'register',
    idempotencyKey: 'boot-1',
  });
  check(
    'register mode refuses to read mode on this arm (no credentialed caller class)',
    registerBundle.status === 403
      && registerBundle.body.diagnostic?.code === 'SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL',
    JSON.stringify(registerBundle)
  );
  const unknownRoute = await bundlePost({ route: '/missing/:x', params: { x: '1' }, mode: 'read' });
  check(
    'an unknown route pattern refuses ROUTE_UNKNOWN',
    unknownRoute.status === 404 && unknownRoute.body.diagnostic?.code === 'SNAPBACK_BUNDLE_ROUTE_UNKNOWN',
    JSON.stringify(unknownRoute)
  );
  const notPublic = await bundlePost({ route: '/private', params: {}, mode: 'read' });
  check(
    'an anonymous read of a non-publicInline route refuses NOT_PUBLIC',
    notPublic.status === 403 && notPublic.body.diagnostic?.code === 'SNAPBACK_BUNDLE_NOT_PUBLIC',
    JSON.stringify(notPublic)
  );
  const missingParam = await bundlePost({ route: '/board/:boardId', params: {}, mode: 'read' });
  check(
    'a missing route param refuses PARAMS_INVALID',
    missingParam.status === 400 && missingParam.body.diagnostic?.code === 'SNAPBACK_BUNDLE_PARAMS_INVALID',
    JSON.stringify(missingParam)
  );
  const badMode = await bundlePost({ route: '/board/:boardId', params: { boardId: 'b1' }, mode: 'stream' });
  check(
    'an unknown mode refuses MODE_INVALID',
    badMode.status === 400 && badMode.body.diagnostic?.code === 'SNAPBACK_BUNDLE_MODE_INVALID',
    JSON.stringify(badMode)
  );

  // --- resume ladder over the live socket (rungs 1 & 3) -------------------
  const socket = await proof.openLiveSocket();
  socket.send({ type: 'subscribe', name: 'boardNotes', args: { boardId: 'b1' } });
  const snapshot = await socket.waitFor('snapshot');
  check(
    'an rqsEligible subscription snapshot carries a fresh resume token',
    String(snapshot.resume?.token).startsWith('sbrt1.')
      && String(snapshot.resume?.meta?.contentDigest).startsWith('mset1:')
      && snapshot.resume?.meta?.version === snapshot.version,
    JSON.stringify(snapshot.resume)
  );
  const resumeWith = async (resume, { name = 'boardNotes', args = { boardId: 'b1' } } = {}) => {
    const rSocket = await proof.openLiveSocket();
    rSocket.send({ type: 'subscribe', name, args, resumeFromToken: { resume } });
    const frame = await rSocket.next();
    rSocket.close();
    return frame;
  };
  const idleResume = await resumeWith(snapshot.resume);
  check(
    'an idle resume answers CurrentAsOf without re-sending rows (rung 1)',
    idleResume.type === 'current_as_of'
      && idleResume.version === snapshot.version
      && String(idleResume.resume?.token).startsWith('sbrt1.')
      && idleResume.rows === undefined,
    JSON.stringify(idleResume).slice(0, 300)
  );
  await proof.mutation('addNote', { boardId: 'b1', text: 'second note' });
  const replace = await socket.waitFor('live_replace');
  check(
    'the live path refreshes the token on every result change',
    String(replace.resume?.token).startsWith('sbrt1.')
      && replace.resume.meta.version === replace.version
      && replace.resume.meta.version > snapshot.version,
    JSON.stringify(replace.resume)
  );
  const staleVersionResume = await resumeWith(snapshot.resume);
  check(
    'a behind-head token answers a fresh snapshot (rung 3, no refusal code)',
    staleVersionResume.type === 'snapshot'
      && staleVersionResume.rows.length === 2
      && staleVersionResume.resumeRefusal === undefined,
    JSON.stringify({ type: staleVersionResume.type, refusal: staleVersionResume.resumeRefusal })
  );
  const refreshedResume = await resumeWith(replace.resume);
  check(
    'the refreshed token resumes CurrentAsOf at the new head',
    refreshedResume.type === 'current_as_of' && refreshedResume.version === replace.version,
    JSON.stringify(refreshedResume).slice(0, 200)
  );
  const orderedSocket = await proof.openLiveSocket();
  orderedSocket.send({ type: 'subscribe', name: 'boardNotesOrdered', args: { boardId: 'b1' } });
  const orderedSnapshot = await orderedSocket.waitFor('snapshot');
  orderedSocket.close();
  const orderedResume = await resumeWith(orderedSnapshot.resume, { name: 'boardNotesOrdered' });
  check(
    'an ordered (seq1) query mints seq1 digests and resumes CurrentAsOf when idle',
    String(orderedSnapshot.resume?.meta?.contentDigest).startsWith('seq1:')
      && orderedResume.type === 'current_as_of',
    JSON.stringify({ digest: orderedSnapshot.resume?.meta?.contentDigest, type: orderedResume.type })
  );

  // --- per-cause refusals over genuinely MAC'd tokens ---------------------
  const testMint = async (body) => {
    const response = await proof.raw('/_snapback/test/rqs-mint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.json();
  };
  const expectRefusal = async (mint, expectedCode, options) => {
    const frame = await resumeWith({ token: mint.token, meta: {} }, options);
    return frame.type === 'snapshot' && frame.resumeRefusal === expectedCode;
  };
  const staleGeneration = await testMint({
    function: 'boardNotes',
    args: { boardId: 'b1' },
    overrides: { generation: `gen1:${'0'.repeat(64)}` },
  });
  check(
    'a stale generation refuses SNAPBACK_RESUME_GENERATION_STALE',
    await expectRefusal(staleGeneration, 'SNAPBACK_RESUME_GENERATION_STALE'),
    JSON.stringify(staleGeneration.body)
  );
  const rotatedStream = await testMint({
    function: 'boardNotes',
    args: { boardId: 'b1' },
    overrides: { versionStream: 'rotated-away-stream' },
  });
  check(
    'a rotated version stream refuses SNAPBACK_RESUME_STREAM_MISMATCH',
    await expectRefusal(rotatedStream, 'SNAPBACK_RESUME_STREAM_MISMATCH')
  );
  const expired = await testMint({
    function: 'boardNotes',
    args: { boardId: 'b1' },
    overrides: { issuedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 },
  });
  check(
    'an over-age token refuses SNAPBACK_RESUME_TOKEN_EXPIRED (staleness backstop)',
    await expectRefusal(expired, 'SNAPBACK_RESUME_TOKEN_EXPIRED')
  );
  const honest = await testMint({ function: 'boardNotes', args: { boardId: 'b1' } });
  // Tamper the FIRST character of the MAC segment (the last dot-part): the
  // trailing character carries non-canonical padding bits, which the decoder
  // rejects as MALFORMED before any MAC comparison.
  const tamperedParts = honest.token.split('.');
  tamperedParts[3] = (tamperedParts[3][0] === 'A' ? 'B' : 'A') + tamperedParts[3].slice(1);
  const tamperedToken = tamperedParts.join('.');
  const tampered = await resumeWith({ token: tamperedToken, meta: {} });
  check(
    'a tampered MAC refuses SNAPBACK_RESUME_MAC_INVALID',
    tampered.type === 'snapshot' && tampered.resumeRefusal === 'SNAPBACK_RESUME_MAC_INVALID',
    JSON.stringify(tampered.resumeRefusal)
  );
  const wrongArgs = await resumeWith({ token: honest.token, meta: {} }, { args: { boardId: 'b2' } });
  check(
    'a token for different args refuses SNAPBACK_RESUME_QUERY_MISMATCH',
    wrongArgs.type === 'snapshot' && wrongArgs.resumeRefusal === 'SNAPBACK_RESUME_QUERY_MISMATCH',
    JSON.stringify(wrongArgs.resumeRefusal)
  );
  const ineligibleMint = await testMint({ function: 'listNotes', args: { boardId: 'b1' } });
  const ineligible = await resumeWith(
    { token: ineligibleMint.token, meta: {} },
    { name: 'listNotes' }
  );
  check(
    'a token naming a non-rqsEligible query refuses SNAPBACK_RESUME_NOT_ELIGIBLE',
    ineligible.type === 'snapshot' && ineligible.resumeRefusal === 'SNAPBACK_RESUME_NOT_ELIGIBLE',
    JSON.stringify(ineligible.resumeRefusal)
  );
  const malformed = await resumeWith({ token: 'sbrt1.not.a.token', meta: {} });
  check(
    'a malformed token refuses SNAPBACK_RESUME_TOKEN_MALFORMED',
    malformed.type === 'snapshot' && malformed.resumeRefusal === 'SNAPBACK_RESUME_TOKEN_MALFORMED',
    JSON.stringify(malformed.resumeRefusal)
  );

  // --- kit HTTP subscribe path (the KIT_ROUTE forwarding obligation) ------
  const opened = await (await proof.raw('/connection/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ connectionId: 'rqs-kit' }),
  })).json();
  const kitUpgrade = await proof.raw(`/live/${opened.connectionId}/stream`, {
    headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'snapback.v1', 'x-snapback-connection-token': opened.connectionToken },
  });
  const kitWs = kitUpgrade.webSocket;
  kitWs.accept();
  const kitFrames = [];
  kitWs.addEventListener('message', (event) => kitFrames.push(JSON.parse(event.data)));
  const kitSubscribe = async (input, operation = {}) => {
    const response = await proof.raw('/live/boardNotes/subscribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-snapback-connection-token': opened.connectionToken,
      },
      body: JSON.stringify({ connection_id: opened.connectionId, input, ...operation }),
    });
    return response.json();
  };
  const kitFirst = await kitSubscribe({ args: { boardId: 'b1' } });
  check(
    'a kit HTTP subscribe returns the snapshot with a resume token',
    kitFirst.snapshot?.rows?.length === 2 && String(kitFirst.resume?.token).startsWith('sbrt1.'),
    JSON.stringify(kitFirst).slice(0, 300)
  );
  const kitSuperseded = await kitSubscribe(
    { args: { boardId: 'b1' } },
    { supersedes: kitFirst.subscription_id }
  );
  check(
    'a hosted supersedes request witnesses the exact disposed predecessor',
    kitSuperseded.superseded === kitFirst.subscription_id
      && kitSuperseded.subscription_id !== kitFirst.subscription_id
      && kitSuperseded.supersessionRefusal === undefined,
    JSON.stringify(kitSuperseded).slice(0, 300)
  );
  const kitAlreadyAbsent = await kitSubscribe(
    { args: { boardId: 'b1' } },
    { supersedes: 'sub_already_absent' }
  );
  check(
    'a hosted supersedes request witnesses an already-absent predecessor',
    kitAlreadyAbsent.superseded === undefined
      && kitAlreadyAbsent.supersessionRefusal === 'SNAPBACK_LIVE_SUPERSESSION_TARGET_UNKNOWN',
    JSON.stringify(kitAlreadyAbsent).slice(0, 300)
  );
  const kitResumed = await kitSubscribe({
    args: { boardId: 'b1' },
    resumeFromToken: { resume: kitSuperseded.resume },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  check(
    'a kit subscribe carrying resumeFromToken reaches coordinator admission and answers CurrentAsOf',
    kitResumed.snapshot === null
      && kitResumed.current_as_of?.version === kitSuperseded.snapshot.version
      && kitFrames.some((frame) => frame.kind === 'current_as_of'),
    JSON.stringify({ kitResumed, kitFrames }).slice(0, 300)
  );
  try { kitWs.close(); } catch (_) {}

  // --- reattach stays local-arm-only (LLP 0091 §0B.5) ---------------------
  const reattach = await proof.raw('/live/boardNotes/resume', { method: 'POST' });
  check(
    'the reattach route keeps failing on the Cloudflare arm exactly as today',
    reattach.status >= 400,
    String(reattach.status)
  );

  // --- keyring custody + restart surrogate --------------------------------
  const stats = await (await proof.raw('/_snapback/test/rqs-stats', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })).json();
  check(
    'the resume keyring lives in DO storage and counters record the ladder',
    stats.keyCount >= 1
      && String(stats.generation).startsWith('gen1:')
      && stats.stats.currentAsOfAnswers >= 2
      && stats.stats.tokensMinted >= 4
      && stats.routesError === null,
    JSON.stringify(stats)
  );
  const preEvict = await testMint({ function: 'boardNotes', args: { boardId: 'b1' } });
  await proof.evict();
  const postEvict = await resumeWith({ token: preEvict.token, meta: {} });
  check(
    'a token minted before /_snapback/api/object/evict still verifies after (storage-resident keyring)',
    postEvict.type === 'current_as_of',
    JSON.stringify(postEvict).slice(0, 200)
  );

  // --- reset rotates the version stream, refusing outstanding tokens ------
  const preReset = await testMint({ function: 'boardNotes', args: { boardId: 'b1' } });
  await proof.reset();
  const postReset = await resumeWith({ token: preReset.token, meta: {} });
  check(
    'destructive reset rotates versionStream and outstanding tokens refuse STREAM_MISMATCH',
    postReset.type === 'snapshot'
      && postReset.rows.length === 0
      && postReset.resumeRefusal === 'SNAPBACK_RESUME_STREAM_MISMATCH',
    JSON.stringify({ type: postReset.type, refusal: postReset.resumeRefusal })
  );

  // --- keyring survives a real DO restart (persisted storage) -------------
  {
    const persistRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'snapback-rqs-persist-'));
    let restartProof = await startProof({ app: 'notes', persistRoot });
    let restartOk = false;
    let restartDetail = '';
    try {
      const mint = await (await restartProof.raw('/_snapback/test/rqs-mint', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ function: 'boardNotes', args: { boardId: 'b1' } }),
      })).json();
      await restartProof.dispose();
      restartProof = await startProof({ app: 'notes', persistRoot });
      const rSocket = await restartProof.openLiveSocket();
      rSocket.send({
        type: 'subscribe',
        name: 'boardNotes',
        args: { boardId: 'b1' },
        resumeFromToken: { resume: { token: mint.token } },
      });
      const frame = await rSocket.next();
      rSocket.close();
      restartOk = frame.type === 'current_as_of';
      restartDetail = JSON.stringify(frame).slice(0, 200);
    } finally {
      await restartProof.dispose();
      fs.rmSync(persistRoot, { recursive: true, force: true });
    }
    check('the resume keyring survives a real DO restart (persisted storage)', restartOk, restartDetail);
  }

  // --- bundle failure degrades the pageload to the plain shell ------------
  degradedProof = await startProof({
    app: 'notes',
    assetsDirectory: ASSETS_DIR,
    bindings: { SNAPBACK_TEST_BUNDLE_FAIL: '1' },
  });
  const degradedBundle = await degradedProof.raw('/app/bundle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ route: '/board/:boardId', params: { boardId: 'b1' }, mode: 'read' }),
  });
  check(
    'an injected bundle failure is an atomic coded refusal',
    degradedBundle.status === 500
      && (await degradedBundle.json()).diagnostic?.code === 'SNAPBACK_BUNDLE_QUERY_FAILED'
  );
  const degradedPage = await degradedProof.raw('/board/b1', { headers: { accept: 'text/html' } });
  const degradedHtml = await degradedPage.text();
  check(
    'bundle failure degrades the pageload to the unhydrated shell, never a failure',
    degradedPage.status === 200 && !degradedHtml.includes('__snapback_boot'),
    String(degradedPage.status)
  );

  socket.close();
} finally {
  await proof.dispose();
  if (degradedProof) await degradedProof.dispose();
}

if (failures.length > 0) {
  console.error(`cloudflare rqs acceptance: ${passed}/${total} checks passed`);
  process.exit(1);
}
console.log(`cloudflare rqs acceptance: ${passed}/${total} checks passed`);
