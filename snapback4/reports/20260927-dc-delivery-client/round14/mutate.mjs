import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const mode = process.env.DELIVERY_MUTATION;
const variants = {
  identity: ['delivery-acceptance.js', 'collect: () => collect(valid)', 'collect: () => collect(current)'],
  early: ['delivery-acceptance.js', 'if (!guarded.has(client.observe))', 'if (true)'],
};
const [file, before, after] = variants[mode] ?? [];
assert.ok(file, `unknown mutation ${mode}`);
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith(`/dist/${file}`)) return result;
  const source = String(result.source);
  assert.equal(source.split(before).length, 2, `one ${mode} mutation site`);
  return { ...result, source: source.replace(before, after) };
} });
