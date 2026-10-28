import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../dist/client.js';
import { server } from './helpers/app-server.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/b1sAAAAASUVORK5CYII=', 'base64');
// Wave 34 E_ASSET_TYPE: Codex/Muse builders pass file metadata for an image-only backend.
test('wave34 image-only upload accepts file MIME/name/size metadata but verifies bytes and bounds', async t => {
  const f = await server(t, '', `use personas alice
table photos:
  photo: image <=1000
  public
`);
  const client = createClient({ url: f.url, persona: 'alice' });
  t.after(() => client.close());
  const options = { file: { type: 'image/png', name: 'photo.png', size: png.length } };
  const image = await client.upload(png, options);
  assert.equal(image.ok, true, JSON.stringify(image));
  assert.equal(image.asset.type, 'image/png');
  assert.equal(image.asset.bytes, png.length);
  assert.equal(image.asset.width, 1);
  const fake = await client.upload(Buffer.from('this is not a png'), options);
  assert.equal(fake.ok, false);
  assert.equal(fake.why.code, 'E_ASSET_TYPE');
  const large = await client.upload(Buffer.concat([png, Buffer.alloc(1000)]), options);
  assert.equal(large.ok, false);
  assert.equal(large.why.code, 'E_ASSET_TOO_LARGE');
  const pdf = await client.upload(Buffer.from('%PDF-1.7\n'), { file: { type: 'application/pdf', name: 'x.pdf' } });
  assert.equal(pdf.ok, false);
  assert.equal(pdf.why.code, 'E_ASSET_TYPE');
});
