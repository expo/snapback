// Graffiti wall — widget-shaped read-mode Channel C acceptance (LLP 0090 D4
// rollout step 7, ENG-25458; contracts LLP 0092 §0D + the LLP 0031
// DeclaredPublicApplicationData lane).
//
// Proves the socket-less widget surface end to end against a live local
// server:
//   - the widget renders the current wall from exactly ONE anonymous HTTP
//     request — no WebSocket is ever constructed (the global constructor is
//     poisoned for the whole run), and the response is `no-store`;
//   - the request is the D4 deep-link case: a cold start into the
//     parameterized `/board/:boardId` route with params-v1 binding the board
//     id — a different board id renders that board from one request;
//   - the public (`publicInline`-class) entry is rqsEligible, so the widget
//     receives a resume token it could hand a future socketed session;
//   - an anonymous register-mode request on this surface refuses
//     `SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL` and the widget retries
//     with an explicit READ request — never a silent mode substitution;
//   - the CLI widget lifecycle is fetch → render → exit: the child process
//     terminates on its own with the rendered wall on stdout.
//
// Run: node demos/graffiti/tests/acceptance/widget-read-mode.mjs

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSuite, runAcceptance, assert, assertEqual } from '../../../_kit/harness.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { renderWidgetBundle } from '../../surfaces/widget/render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const widgetCli = join(here, '..', '..', 'surfaces', 'widget', 'render.mjs');
const gen = (file) => JSON.parse(readFileSync(join(backendDir, 'generated', file), 'utf8'));

const schemaManifest = gen('schema.manifest.json');
const functionsManifest = gen('functions.manifest.json');
const routesManifest = gen('routes.manifest.json');
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));
const SEED_MARKS = seed.tables.cells.length;

// ---------------------------------------------------------------------------
// Socket-less by construction: any WebSocket construction anywhere in this
// process is a failure, and every HTTP request is counted.
// ---------------------------------------------------------------------------
let websocketConstructions = 0;
const RealWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class {
  constructor(url) {
    websocketConstructions += 1;
    throw new Error(`the widget surface must never open a socket (attempted: ${url})`);
  }
};

const httpLog = [];
const realFetch = globalThis.fetch;
const countingFetch = async (input, init = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? input);
  const record = { url, body: null, cacheControl: null, status: null };
  try { record.body = init.body ? JSON.parse(init.body) : null; } catch { record.body = null; }
  httpLog.push(record);
  const response = await realFetch(input, init);
  record.status = response.status;
  record.cacheControl = response.headers.get('cache-control');
  return response;
};

const EXPECTED_CHECKS = 5;
const suite = createSuite('graffiti widget read-mode (LLP 0090 step 7)', {
  expectedChecks: EXPECTED_CHECKS,
});
const cleanups = [() => { globalThis.WebSocket = RealWebSocket; }];

async function main() {
  await runAcceptance(suite, async () => {
    const server = await startServer({
      port: 0,
      db: ':memory:',
      cwd: repoRoot,
      provenance: {
        appId: 'graffiti',
        artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
      },
    });
    cleanups.push(() => server.stop());
    const apiUrl = server.baseUrl;

    await suite.check('one ensure provisions schema + functions + seed + routes', async () => {
      const client = new SnapbackClient(apiUrl, server.clientOptions);
      const outcome = await client.ensureApp({
        schema: schemaManifest,
        functions: functionsManifest,
        seed,
        routes: routesManifest,
      });
      assertEqual(outcome.routes, 'provisioned', 'routes manifest outcome');
      return outcome;
    });

    await suite.check('widget renders the current wall from ONE anonymous no-store request, no socket', async () => {
      const before = httpLog.length;
      const rendered = await renderWidgetBundle({
        apiUrl,
        boardId: 'wall',
        fetchImpl: countingFetch,
      });
      const requests = httpLog.slice(before);
      assertEqual(requests.length, 1, 'exactly one HTTP request');
      assert(
        (requests[0].cacheControl ?? '').includes('no-store'),
        `read-mode public bundles serve no-store, got ${requests[0].cacheControl}`,
      );
      assertEqual(websocketConstructions, 0, 'no WebSocket was ever constructed');
      assertEqual(rendered.marks, SEED_MARKS, 'every seeded mark arrived');
      assert(rendered.painted > 0, 'the wall painted');
      assert(rendered.text.includes('B'), 'the seeded red cells render (palette glyph B)');
      // publicInline entries are rqsEligible: the widget holds a resume
      // token it could hand a future socketed session (unused here).
      assert(typeof rendered.resumeToken === 'string', 'public entry carries a resume token');
      return { marks: rendered.marks, painted: rendered.painted };
    });

    await suite.check('deep-link cold start: params-v1 binds the board id from the route', async () => {
      const wallRequest = httpLog.find((record) => record.url.endsWith('/app/bundle'));
      assertEqual(wallRequest.body.route, '/board/:boardId', 'the parameterized route pattern rides the request');
      assertEqual(wallRequest.body.params, { boardId: 'wall' }, 'the board id rides as a param');
      // A different board deep-links to ITS wall — empty, one request.
      const before = httpLog.length;
      const other = await renderWidgetBundle({
        apiUrl,
        boardId: 'some-other-board',
        fetchImpl: countingFetch,
      });
      assertEqual(httpLog.length - before, 1, 'one request for the other board');
      assertEqual(other.marks, 0, 'the other board has no marks');
      assertEqual(other.painted, 0, 'the other board renders empty');
      return { params: wallRequest.body.params };
    });

    await suite.check('anonymous register mode refuses to read mode — explicit, never silent', async () => {
      const before = httpLog.length;
      const rendered = await renderWidgetBundle({
        apiUrl,
        boardId: 'wall',
        mode: 'register',
        fetchImpl: countingFetch,
      });
      const requests = httpLog.slice(before);
      assertEqual(
        rendered.refusedRegister,
        'SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL',
        'the refusal code surfaces to the widget',
      );
      assertEqual(requests.length, 2, 'coded refusal + one explicit read retry');
      assertEqual(requests[0].body.mode, 'register', 'the refused request asked for register');
      assertEqual(requests[1].body.mode, 'read', 'the retry is an explicit read request');
      assertEqual(requests[1].body.idempotencyKey, undefined, 'the read retry carries no idempotency key');
      assertEqual(rendered.marks, SEED_MARKS, 'the read fallback still renders the wall');
      assertEqual(websocketConstructions, 0, 'still no socket');
      return { refusal: rendered.refusedRegister };
    });

    await suite.check('CLI lifecycle is fetch → render → exit', async () => {
      const child = spawn(process.execPath, [widgetCli, apiUrl, 'wall'], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      const exitCode = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('the widget process did not exit on its own (a held socket?)'));
        }, 20_000);
        child.on('exit', (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
      assertEqual(exitCode, 0, `widget CLI failed: ${stderr}`);
      assert(stdout.includes('B'), 'the rendered wall reached stdout');
      assert(stdout.includes(`${SEED_MARKS} marks`), 'the summary line reports the marks');
      return { exitCode, bytes: stdout.length };
    });
  }, { cleanups });
}

await main();
