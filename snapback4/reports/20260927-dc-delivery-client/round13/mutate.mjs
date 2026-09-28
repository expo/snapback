import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const mode = process.env.DELIVERY_MUTATION;
const variants = {
  early: ['delivery-acceptance.js', 'if (!guarded.has(client.observe))', 'if (true)'],
  background: ['client.js', 'acceptDelivery(result, watch.snapshot);', '/* missing background acceptance */'],
  query: ['app-client.js', 'return approveDelivery(read) ? read : { loading: true };', 'return read;'],
};
const [file, before, after] = variants[mode] ?? [];
assert.ok(file, `unknown mutation ${mode}`);
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith(`/dist/${file}`)) return result;
  const source = String(result.source);
  assert.ok(source.includes(before), `missing ${mode} mutation site`);
  return { ...result, source: source.replace(before, after) };
} });
