// Test-only controls. The POST-stage mutation is Astra's exact local.js bypass;
// the receipt-stage mutation leaves admission intact and bypasses only sent,
// unobserved custody. Vite applies the same mutation to the browser's real SDK.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

function mutate(source, id, stage) {
  if (stage === 'post' && id.endsWith('/dist/local.js')) {
    const needle = 'await queryCustody.blocked(op.name, result)';
    assert.equal(source.split(needle).length, 3);
    return source.replaceAll(needle, '(op.name === "postState" ? false : await queryCustody.blocked(op.name, result))');
  }
  if (stage === 'receipt' && id.endsWith('/dist/query-custody.js')) {
    const needle = 'if (this.unavailable())';
    assert.equal(source.split(needle).length, 2);
    return source.replace(needle, 'if (query === "postState" && (await this.queued()).some(w => successSequence(w) != null && w.observed_seq == null)) return false; ' + needle);
  }
  return source;
}

const stage = process.env.SN_BYPASS_STAGE;
assert.ok(['post', 'receipt', 'disabled'].includes(stage));
registerHooks({ load(url, context, next) {
  const out = next(url, context);
  if (out.source == null) return out;
  let source = mutate(String(out.source), url, stage);
  if (url.endsWith('/tools/adoption.test.mjs')) {
    const needle = "name: 'fw-page',";
    assert.equal(source.split(needle).length, 2);
    source = source.replace(needle, `${needle} transform(source, id) { return (${mutate.toString()})(source, id, ${JSON.stringify(stage)}); },`);
  }
  return { ...out, source };
} });
