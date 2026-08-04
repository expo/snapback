// The sidebar brand mark must follow the console's color scheme.
//
// Regression for the dark-mode mark. Palette values reach the DOM as inline
// styles, but a themed `image`'s source is chosen from the document's scheme
// attribute (`getRuntimeImageColorScheme`, @exact/renderer) — never from the
// media query. While the console resolved dark mode without publishing it, the
// renderer baked the light source, so the near-black mark sat on the dark
// sidebar at ~1.05:1 and read as a missing asset.
//
// This locks every link in that chain: the contract declares both sources, the
// two assets are inked for their own sidebar, the publisher writes the scheme
// and swaps themed images already in the DOM, and the boot entry calls it
// before mount and keeps it subscribed.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (typeof Bun === 'undefined') {
  const result = spawnSync(process.env.BUN ?? 'bun', [fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractSource = readFileSync(join(adminRoot, 'app.contract'), 'utf8');
const mainSource = readFileSync(join(adminRoot, 'main.ts'), 'utf8');
const { applyDocumentColorScheme, colors } = await import('../theme.ts');

// 1. The console's brand mark ships a source per scheme.
const markLine = contractSource
  .split('\n')
  .find((line) => line.includes('testId="brand-mark"'));
assert.ok(markLine, 'app.contract must render a brand-mark image');
const lightSrc = /lightSrc="([^"]+)"/.exec(markLine)?.[1];
const darkSrc = /darkSrc="([^"]+)"/.exec(markLine)?.[1];
assert.ok(lightSrc, 'brand mark must declare lightSrc');
assert.ok(darkSrc, 'brand mark must declare darkSrc');
assert.notEqual(lightSrc, darkSrc, 'the two schemes must not share one inked asset');

// 2. Each asset is inked for the sidebar it paints on. WCAG 1.4.11 asks 3:1 of
//    a graphical object; the mark is the console's only non-text brand element.
for (const [mode, source] of [['light', lightSrc], ['dark', darkSrc]]) {
  const assetPath = join(adminRoot, 'public', source.slice(source.lastIndexOf('/') + 1));
  const asset = readFileSync(assetPath, 'utf8');
  const ink = /<g fill="(#[0-9a-fA-F]{6})"/.exec(asset)?.[1];
  assert.ok(ink, `${source} must ink its pills with a literal fill`);
  const sidebar = colors(mode).sidebar;
  const ratio = contrast(ink, sidebar);
  assert.ok(
    ratio >= 3,
    `${mode} mark ${ink} on sidebar ${sidebar} is ${ratio.toFixed(2)}:1, below the 3:1 floor`,
  );
}

// 3. The publisher writes the resolved scheme and converges themed images that
//    are already mounted, so the mark cannot wait on the next render.
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
try {
  const root = element({});
  const mark = element({ src: lightSrc, 'data-light-src': lightSrc, 'data-dark-src': darkSrc });
  globalThis.document = {
    documentElement: root,
    querySelectorAll: (selector) => (selector.includes('data-light-src') ? [mark] : []),
  };

  applyDocumentColorScheme('dark');
  assert.equal(root.getAttribute('data-scheme'), 'dark', 'dark mode must be published to the root');
  assert.equal(root.style.colorScheme, 'dark');
  assert.equal(mark.getAttribute('src'), darkSrc, 'a mounted mark must swap to the dark asset');

  applyDocumentColorScheme('light');
  assert.equal(root.getAttribute('data-scheme'), 'light');
  assert.equal(root.style.colorScheme, 'light');
  assert.equal(mark.getAttribute('src'), lightSrc, 'light mode must restore the light asset');
} finally {
  delete globalThis.document;
  if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
}

// A host without a document (the native shell) must stay quiet, not throw.
applyDocumentColorScheme('dark');

// 4. The boot entry publishes before it mounts, and stays subscribed.
const startBody = /async function start\(\)[^{]*\{([\s\S]*?)\n\}/.exec(mainSource)?.[1];
assert.ok(startBody, 'main.ts must keep a start() entry point');
const publishAt = startBody.indexOf('applyDocumentColorScheme(systemTheme())');
const bootAt = startBody.indexOf('boot(client)');
assert.ok(publishAt >= 0, 'start() must publish the resolved scheme');
assert.ok(
  bootAt >= 0 && publishAt < bootAt,
  'the scheme must be published before the console mounts',
);
assert.match(
  mainSource,
  /watchSystemTheme\(applyDocumentColorScheme\)/,
  'main.ts must keep the published scheme in sync with the host appearance',
);

console.log('admin brand mark: themed per scheme and published to the document');

function element(attributes) {
  const attrs = { ...attributes };
  return {
    style: { colorScheme: '' },
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
  };
}

function contrast(left, right) {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function luminance(hex) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
