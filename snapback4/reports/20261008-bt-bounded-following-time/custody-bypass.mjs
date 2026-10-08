// SN round 8's fail-closed mutation pattern, applied to all local one-shots.
// Disabled mode uses the identical loader with unchanged product bytes.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const stage = process.env.BT_BYPASS_STAGE;
const selectedQuery = process.env.BT_BYPASS_QUERY;
assert.ok(['admission', 'receipt', 'disabled'].includes(stage));
registerHooks({ load(url, context, next) {
  const out = next(url, context);
  if (stage === 'disabled' || !url.endsWith('/dist/query-custody.js')) return out;
  const source = String(out.source), needle = 'if (this.unavailable())';
  assert.equal(source.split(needle).length, 2, 'mutation must hit exactly one custody predicate');
  const selected = selectedQuery ? `query === ${JSON.stringify(selectedQuery)}` : 'true';
  const bypass = stage === 'admission' ? `if (${selected}) return false; `
    : `if (${selected} && (await this.queued()).some(w => successSequence(w) != null && w.observed_seq == null)) return false; `;
  return { ...out, source: source.replace(needle, bypass + needle) };
} });
