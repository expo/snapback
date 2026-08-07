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

const blobUri = 'blob:https://example.test/fetched-image';
const browserFetchCalls = [];
const browserFetched = await createExpoAssetSourceAdapter({
  async fetch(uri) {
    browserFetchCalls.push(uri);
    return { bytes: async () => png };
  },
})({
  uri: blobUri,
  fileName: 'fetched-image.png',
  mimeType: 'image/png',
});
assert.equal(browserFetched.file.size, png.length);
assert.equal(browserFetched.declaredFilename, 'fetched-image.png');
assert.equal(browserFetched.declaredContentType, 'image/png');
assert.equal(browserFetched.previewUrl, blobUri);
assert.deepEqual(browserFetchCalls, [blobUri]);

let rejectedBlobFileReads = 0;
await assert.rejects(
  createExpoAssetSourceAdapter({
    fetch: async () => { throw new Error('browser revoked blob URI'); },
    readFileBytes: async () => {
      rejectedBlobFileReads += 1;
      return png;
    },
  })({ uri: 'blob:https://example.test/revoked-image' }),
  (error) => error.code === 'SNAPBACK_EXPO_ASSET_URI_UNREADABLE'
    && error.diagnostic.details.scheme === 'blob',
);
assert.equal(rejectedBlobFileReads, 0);

const directFile = new File([png], 'direct-image.png', { type: 'image/png' });
let directFetchCalls = 0;
const direct = await createExpoAssetSourceAdapter({
  fetch: async () => {
    directFetchCalls += 1;
    throw new Error('direct File must not be fetched');
  },
})(directFile);
assert.strictEqual(direct.file, directFile);
assert.equal(direct.declaredFilename, 'direct-image.png');
assert.equal(direct.declaredContentType, 'image/png');
assert.equal(direct.previewUrl, null);
assert.equal(directFetchCalls, 0);
assert.equal(Object.isFrozen(direct), true);

const pickerFile = new File([png], 'browser-file.png', { type: 'image/webp' });
let pickerFileFetchCalls = 0;
const pickerCarried = await createExpoAssetSourceAdapter({
  fetch: async () => {
    pickerFileFetchCalls += 1;
    throw new Error('picker-carried File must not be fetched');
  },
})({
  uri: 'blob:https://example.test/picker-file',
  file: pickerFile,
  fileName: 'picker-name.png',
  mimeType: 'image/png',
});
assert.strictEqual(pickerCarried.file, pickerFile);
assert.equal(pickerCarried.declaredFilename, 'picker-name.png');
assert.equal(pickerCarried.declaredContentType, 'image/png');
assert.equal(pickerCarried.previewUrl, 'blob:https://example.test/picker-file');
assert.equal(pickerFileFetchCalls, 0);

await assert.rejects(
  adapt({ uri: 'https://example.test/bundled-bypass.png' }),
  (error) => error.code === 'SNAPBACK_EXPO_ASSET_URI_UNSUPPORTED'
    && error.message === 'Expo command image input must be a web File/Blob or use a content://, ph://, file://, or blob: picker URI.',
);
await assert.rejects(
  createExpoAssetSourceAdapter({ fetch: async () => { throw new Error('provider revoked URI'); } })({
    uri: fixtures[0].uri,
  }),
  (error) => error.code === 'SNAPBACK_EXPO_ASSET_URI_UNREADABLE'
    && error.diagnostic.details.scheme === 'content',
);

console.log('asset-source.test.mjs: native picker fixtures and browser File/Blob sources become slice-readable structural Blobs without crossing platform fallback boundaries');
