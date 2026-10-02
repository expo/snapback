import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const [input, output] = process.argv.slice(2);
const bytes = readFileSync(input), d = JSON.parse(input.endsWith('.gz') ? gunzipSync(bytes) : bytes);
const rows = [], offset = d.calibration[0].offset;
const phaseRead = (phase, read) => read && 'data' in read && !read.revalidating &&
  (phase === 'tombstone' || phase === 'edit' ? read.data.find(x => x.id === 'item')?.body === (phase === 'tombstone' ? '' : 'image-1')
    : phase === 'clearReaction' ? read.data.length === 0 : read.data[0]?.emoji === (phase === 'set' ? 'heart' : 'smile'));
for (const start of d.events.filter(e => e.kind === 'trial-start')) {
  const events = d.events.filter(e => e.trial === start.trial);
  const end = events.find(e => e.kind === 'trial-end');
  const row = { trial: start.trial, phase: start.phase, totalMs: end.at - start.at };
  if (start.phase !== 'offline') {
    const name = ['edit', 'tombstone'].includes(start.phase) ? 'history' : 'reactions';
    const receipt = events.find(e => e.kind === 'http-end' && e.persona === 'alice' && e.path.startsWith('/m/'));
    const server = d.server.find(s => String(s.id) === receipt.request);
    if (!server?.mutation_commit) throw Error('missing commit trace for trial ' + start.trial);
    const commit = server.mutation_commit / 1e6 - offset;
    const changes = events.find(e => e.kind === 'http-end' && e.persona === 'bob' && e.path === '/changes' && e.seq >= receipt.seq);
    const sync = events.find(e => e.kind === 'http-end' && e.persona === 'bob' && e.path === '/sync' && e.watermark >= receipt.seq);
    const applied = sync && events.find(e => e.at >= sync.at && e.kind === 'device-commit' && e.persona === 'bob' && e.op === 'apply');
    const observation = events.find(e => e.at >= commit && e.kind === 'observation' && e.persona === 'bob' && e.name === name && phaseRead(start.phase, e.read));
    const render = events.find(e => e.at >= commit && e.kind === 'render' && e.persona === 'bob' && phaseRead(start.phase, e[name]));
    const invalidated = changes && events.find(e => e.at >= changes.at && e.kind === 'observation' && e.persona === 'bob' && e.name === name && e.read.revalidating);
    Object.assign(row, { seq: receipt.seq, request: server.id, admissionCommitMs: commit - start.at,
      callRenderMs: render.at - start.at, missed10s: render.at - start.at > 10_000,
      commitRenderMs: render.at - commit, changeMs: changes ? changes.at - commit : null,
      notificationInvalidationMs: invalidated ? invalidated.at - changes.at : null,
      changeSyncMs: changes && sync ? sync.at - changes.at : null,
      syncApplyMs: applied ? applied.at - sync.at : null,
      applyPublicationMs: applied ? observation.at - applied.at : null,
      publicationRenderMs: render.at - observation.at,
      queryAttempts: events.filter(e => e.kind === 'device-start' && e.persona === 'bob' && e.op === 'query').length,
      commitAt: commit, changeAt: changes?.at, syncAt: sync?.at, applyAt: applied?.at, publicationAt: observation.at, renderAt: render.at });
  }
  rows.push(row);
}
const groups = {};
for (const phase of new Set(rows.map(r => r.phase))) {
  const selected = rows.filter(r => r.phase === phase), metrics = {};
  for (const key of Object.keys(selected[0]).filter(k => k.endsWith('Ms') || k === 'queryAttempts')) {
    const samples = selected.map(r => r[key]).filter(x => x !== null && x !== undefined).sort((a,b) => a-b);
    metrics[key] = { n: samples.length, p50: samples[Math.ceil(.5 * samples.length)-1], p95: samples[Math.ceil(.95 * samples.length)-1], max: samples.at(-1) };
  }
  groups[phase] = metrics;
}
const settled = d.events.filter(e => e.phase === 'settling' && e.kind === 'render');
const result = { input, n: d.n, pressure: d.pressure, misses10s: rows.filter(r => r.missed10s).map(r => r.trial), clockUncertaintyMs: d.calibration[0].uncertainty,
  loadOneMinute: { min: Math.min(...d.loads.map(x => x.load[0])), max: Math.max(...d.loads.map(x => x.load[0])) }, groups, rows,
  settlement: { renders: settled.length, empty: settled.filter(e => !e.items.length).length, loading: settled.filter(e => e.history.loading).length, partial: settled.filter(e => e.history.complete === false).length } };
if (output) writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
