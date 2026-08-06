import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createExpoAssetSourceAdapter } from './asset-source.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/asset-sources.json', import.meta.url)));
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const fetched = [];
const adapt = createExpoAssetSourceAdapter({
  async fetch(uri) {
    fetched.push(uri);
    return {
      ok: false,
      status: 0,
      bytes: async () => png,
      blob: async () => { throw new Error('bytes() must be authoritative'); },
    };
  },
});

for (const fixture of fixtures) {
  const converted = await adapt(fixture);
  assert.equal(converted.file.size, png.length);
  assert.equal(converted.declaredFilename, fixture.fileName);
  assert.equal(converted.declaredContentType, fixture.mimeType);
  assert.equal(converted.previewUrl, fixture.uri);
  assert.deepEqual(
    new Uint8Array(await converted.file.slice(0, 4).arrayBuffer()),
    png.slice(0, 4),
  );
}
assert.deepEqual(fetched, fixtures.map(({ uri }) => uri));

const localResource = await createExpoAssetSourceAdapter({
  async fetch() {
    return { ok: false, status: 0, blob: async () => new Blob([png], { type: 'image/png' }) };
  },
})(fixtures.find(({ uri }) => uri.startsWith('file://')));
assert.equal(localResource.file.size, png.length);

const fallbackCalls = [];
const androidPickerCache = await createExpoAssetSourceAdapter({
  async fetch(uri) {
    fallbackCalls.push(`expo:${uri}`);
    return { ok: false, status: 404, bytes: async () => new TextEncoder().encode('File not found') };
  },
  async readFileBytes(uri) {
    fallbackCalls.push(`file:${uri}`);
    return png;
  },
})(fixtures.find(({ uri }) => uri.startsWith('file://')));
assert.equal(androidPickerCache.file.size, png.length);
assert.deepEqual(
  new Uint8Array(await androidPickerCache.file.slice(0, 8).arrayBuffer()),
  png,
);
assert.deepEqual(
  fallbackCalls.map((entry) => entry.slice(0, entry.indexOf(':'))),
  ['expo', 'file'],
);

await assert.rejects(
  adapt({ uri: 'https://example.test/bundled-bypass.png' }),
  (error) => error.code === 'SNAPBACK_EXPO_ASSET_URI_UNSUPPORTED',
);
await assert.rejects(
  createExpoAssetSourceAdapter({ fetch: async () => { throw new Error('provider revoked URI'); } })({
    uri: fixtures[0].uri,
  }),
  (error) => error.code === 'SNAPBACK_EXPO_ASSET_URI_UNREADABLE'
    && error.diagnostic.details.scheme === 'content',
);

console.log('asset-source.test.mjs: recorded content://, ph://, and file:// picker fixtures become slice-readable structural Blobs, including status 0 and Android picker-cache fallback');
