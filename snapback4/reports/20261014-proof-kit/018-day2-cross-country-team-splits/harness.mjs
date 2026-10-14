import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
export const refusal = body => body.denied?.code ?? (body.state === 'failed' ? body.why.code : undefined);
export function wire(url) {
  return async (path, body, persona) => {
    const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(persona && { 'x-snapback-persona': persona }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return response.json();
  };
}
export async function seed(post) {
  const rows = [];
  for (const table of ['coaches', 'meets', 'runners', 'splits']) {
    const contents = await readFile(`fixtures/${table}.jsonl`, 'utf8');
    rows.push(...contents.trim().split('\n').filter(Boolean).map(line => ({ table, row: JSON.parse(line) })));
  }
  assert.equal((await post('/dev/reset', { seed: rows })).reset, true);
}
export function assertSent(body) { assert.equal(body.state, 'sent', JSON.stringify(body)); return body.result; }
export function assertRead(body) { assert.equal(refusal(body), undefined, JSON.stringify(body)); assert.equal(body.complete, true, JSON.stringify(body)); return body.data; }
// Process custody is provided by snapback4/proof in the frontend script.
