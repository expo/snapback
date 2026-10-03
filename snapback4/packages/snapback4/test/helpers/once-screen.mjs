// Paint every captured synchronous client notification with React flushSync.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromiumExecutable } from '../../../../witness/lib.mjs';
const root = new URL('../../../../', import.meta.url).pathname;
const require = createRequire(join(root, 'package.json'));
export async function screen(t) {
  const { chromium } = require('playwright-core'), { createServer } = require('vite');
  const pkg = createRequire(join(root, 'packages/snapback4/package.json'));
  const dir = mkdtempSync(join(tmpdir(), 'sb4-once-screen-'));
  writeFileSync(join(dir, 'index.html'), '<main id="root"></main><script type="module" src="/main.jsx"></script>');
  writeFileSync(join(dir, 'main.jsx'), `
import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
const root = createRoot(document.getElementById('root'));
window.paint = frames => frames.map(frame => {
  flushSync(() => root.render(<section>{[frame.other, ...frame.pages].map((photo, i) => <output key={i}>{photo == null ? 'hidden' : JSON.stringify(photo)}</output>)}</section>));
  return document.getElementById('root').textContent;
});
`);
  const vite = await createServer({ root: dir, configFile: false, logLevel: 'error', server: { hmr: false, host: '127.0.0.1', port: 0, fs: { allow: [root, dir] } }, resolve: { alias: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'].map(name => ({ find: new RegExp('^' + name + '$'), replacement: pkg.resolve(name) })) } });
  await vite.listen();
  const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await vite.close(); rmSync(dir, { recursive: true, force: true }); });
  const page = await browser.newPage(); await page.goto(vite.resolvedUrls.local[0]); await page.waitForFunction(() => window.paint);
  return async frames => {
    const paints = await page.evaluate(frames => window.paint(frames), frames);
    assert.ok(paints.length > 0);
    for (const paint of paints) assert.equal(paint, 'hiddenhiddenhidden', 'one synchronous React render exposed an old once handle or its facts');
  };
}
