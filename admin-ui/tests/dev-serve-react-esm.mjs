// ENG-22600 regression smoke: boot the admin dev serve and prove the browser
// module path either stays React-free or gets ESM React from the dep optimizer,
// never the installed Exact graph's raw CJS react/index.js (which has no named
// exports and crashes the boot with "does not provide an export named
// 'isValidElement'").
//
// @ref LLP 0023#shared-vite-config-the-anti-drift-move — guards the
// conditional-dedupe seam in @expo/snapback-contract's contractViteBaseConfig.
//
// Needs bun because the published Exact packages ship TypeScript sources.
// Run directly (`node tests/dev-serve-react-esm.mjs` re-executes itself under
// bun) or via `npm test` in admin-ui/.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const adminRoot = resolve(here, '..');
const required = process.env.SNAPBACK_REQUIRE_EXACT === '1';

function skip(reason) {
  if (required) {
    console.error(`admin dev-serve react-esm smoke: FAIL (required): ${reason}`);
    process.exit(1);
  }
  console.log(`admin dev-serve react-esm smoke: SKIP: ${reason}`);
  process.exit(0);
}

if (!existsSync(resolve(adminRoot, 'node_modules', '@exact', 'contract', 'package.json'))) {
  skip(`admin-ui Exact packages are not installed (run bun install --frozen-lockfile --cwd ${adminRoot})`);
}
if (!existsSync(resolve(adminRoot, 'node_modules', 'vite'))) {
  skip(`admin-ui has no Vite install (run bun install --frozen-lockfile --cwd ${adminRoot})`);
}

// Exact's vite plugins are TypeScript sources; re-exec under bun when needed.
if (typeof Bun === 'undefined') {
  const { spawnSync } = await import('node:child_process');
  const bun = process.env.BUN ?? 'bun';
  const result = spawnSync(bun, [fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error?.code === 'ENOENT') {
    skip('bun not found (needed to import Exact .ts plugin sources)');
  }
  process.exit(result.status ?? 1);
}

const { serveSnapbackContractApp } = await import(
  pathToFileURL(resolve(adminRoot, '..', 'packages', 'snapback-contract', 'build-preset.mjs')).href
);

const { server } = await serveSnapbackContractApp({
  root: adminRoot,
  entry: '/src/main.ts',
  routeRegistry: 'src/app/routes.ts',
  port: 5341,
  logLevel: 'silent',
});

const address = server.httpServer?.address();
if (!address || typeof address !== 'object') {
  console.error('admin dev-serve react-esm smoke: FAIL: dev server did not bind');
  process.exit(1);
}
const origin = `http://127.0.0.1:${address.port}`;

const importRe =
  /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;

// Crawl the served module graph breadth-first, the way a browser would.
// Returns { reactSpecifiers, rawCjsModules }.
async function crawl() {
  const seen = new Set();
  const queue = ['/src/main.ts'];
  const reactSpecifiers = new Set();
  const rawCjsModules = [];
  while (queue.length > 0 && seen.size < 800) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    let response;
    try {
      response = await fetch(origin + url, { headers: { accept: '*/*' } });
    } catch {
      continue;
    }
    if (!response.ok) continue;
    const text = await response.text();
    const head = text.slice(0, 4000);
    if (/module\.exports\s*=|=\s*require\(/.test(head) && !/__vite/.test(head.slice(0, 200))) {
      rawCjsModules.push(url);
    }
    for (const match of text.matchAll(importRe)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) continue;
      if (/\breact\b/.test(specifier)) reactSpecifiers.add(specifier);
      if (specifier.startsWith('/') && !seen.has(specifier)) queue.push(specifier);
    }
  }
  return { reactSpecifiers, rawCjsModules };
}

// The first pass can race the dep optimizer's discovery re-bundle; retry a
// couple of times until react shows up optimized.
let reactSpecifiers = new Set();
let rawCjsModules = [];
for (let attempt = 0; attempt < 3; attempt++) {
  ({ reactSpecifiers, rawCjsModules } = await crawl());
  const optimized = [...reactSpecifiers].some((specifier) =>
    specifier.startsWith('/node_modules/.vite/deps/'),
  );
  if (optimized && rawCjsModules.length === 0) break;
  await new Promise((resolvePause) => setTimeout(resolvePause, 1000));
}

const failures = [];
const unoptimized = [...reactSpecifiers].filter(
  (specifier) => !specifier.startsWith('/node_modules/.vite/deps/'),
);
if (unoptimized.length > 0) {
  failures.push(`react imports not rewritten to dep-optimizer chunks: ${unoptimized.join(', ')}`);
}
if (rawCjsModules.length > 0) {
  failures.push(`modules served as raw CJS: ${rawCjsModules.slice(0, 5).join(', ')}`);
}

// Evaluate the actual served react chunk as an ES module and check the
// binding the original failure was about. The optimizer's CJS interop shape
// is: the chunk `export default`s the CJS namespace and vite rewrites named
// imports in consumers to `__vite__cjsImport_react["isValidElement"]` — so
// the runtime truth to assert is that the chunk evaluates as ESM and its
// default export carries isValidElement.
if (failures.length === 0 && reactSpecifiers.size > 0) {
  const reactUrl = [...reactSpecifiers].find((specifier) =>
    specifier.startsWith('/node_modules/.vite/deps/react.js'),
  );
  if (!reactUrl) {
    failures.push('no /node_modules/.vite/deps/react.js chunk among react specifiers');
  } else {
    const chunk = await (await fetch(origin + reactUrl)).text();
    // The chunk is self-contained (inlined __commonJSMin regions, no
    // relative imports); evaluate it from a temp file.
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const chunkDir = mkdtempSync(join(tmpdir(), 'snapback-react-chunk-'));
    try {
      const chunkPath = join(chunkDir, 'react-chunk.mjs');
      writeFileSync(chunkPath, chunk);
      const module = await import(pathToFileURL(chunkPath).href);
      if (typeof module.default?.isValidElement !== 'function') {
        failures.push(
          'served react chunk default export does not carry isValidElement (CJS interop broken)',
        );
      }
    } catch (error) {
      failures.push(`served react chunk failed to evaluate as ESM: ${error?.message ?? error}`);
    } finally {
      rmSync(chunkDir, { recursive: true, force: true });
    }
  }
}

await server.close();

if (failures.length > 0) {
  console.error(`admin dev-serve react-esm smoke: FAIL:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(
  reactSpecifiers.size === 0
    ? 'admin dev-serve react-esm smoke: ok (served Contract graph is React-free; no raw CJS among crawled modules)'
    : 'admin dev-serve react-esm smoke: ok (react -> dep-optimizer ESM chunk with isValidElement; no raw CJS among crawled modules)',
);
process.exit(0);
