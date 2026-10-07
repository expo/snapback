import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = '/home/ccheever/sb5-lanes/lane-ro', pkg = root + '/snapback4/packages/snapback4/src';
const { build } = await import(pathToFileURL(createRequire(root + '/snapback4/apps/chat/package.json').resolve('vite')).href);
const changed = execFileSync('git', ['diff', '--name-only', 'ce5793386d', '--', 'snapback4/packages/snapback4/src'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const old = new Map(changed.map(path => [root + '/' + path, execFileSync('git', ['show', 'ce5793386d:' + path], { cwd: root, encoding: 'utf8' })]));
const result = { baseline: 'ce5793386d', current: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), toolchain: 'pinned Vite 8 / oxc, es2022, gzip-9', tiers: {} };
for (const [tier, entries] of Object.entries({ online: ['contract.ts', 'client.ts', 'react.tsx'], app: ['contract.ts', 'app.ts', 'react.tsx'] })) {
  const sizes = {};
  for (const version of ['before', 'after']) {
    const dir = mkdtempSync(join(tmpdir(), 'ro-r6-bytes-'));
    try {
      await build({ root: pkg, logLevel: 'silent', plugins: version === 'before' ? [{ name: 'baseline-source', enforce: 'pre', load(id) { return old.get(id); } }] : [],
        build: { outDir: dir, emptyOutDir: true, minify: 'oxc', target: 'es2022', sourcemap: false,
          lib: { entry: Object.fromEntries(entries.map(e => [e.replace(/\.tsx?$/, ''), join(pkg, e)])), formats: ['es'] },
          rollupOptions: { external: ['react', 'react-dom', 'react/jsx-runtime'] } } });
      const files = readdirSync(dir).filter(f => f.endsWith('.js')).sort().map(f => Buffer.from(readFileSync(join(dir, f), 'utf8').replace(/data:application\/wasm;base64,[A-Za-z0-9+/=]+/g, 'wasm')));
      sizes[version] = { raw: files.reduce((n, b) => n + b.length, 0), gzip: gzipSync(Buffer.concat(files), { level: 9 }).length };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  result.tiers[tier] = { ...sizes, removed: { raw: sizes.before.raw - sizes.after.raw, gzip: sizes.before.gzip - sizes.after.gzip } };
}
writeFileSync('/tmp/ro-r6-sdk-size.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
