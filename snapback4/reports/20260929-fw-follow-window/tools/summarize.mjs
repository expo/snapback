import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { basename } from 'node:path';

const percentile = (values, q) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? +sorted[Math.ceil(sorted.length * q) - 1].toFixed(3) : null;
};
const results = [];
for (const path of process.argv.slice(2)) {
  const bytes = readFileSync(path), raw = JSON.parse(path.endsWith('.gz') ? gunzipSync(bytes) : bytes);
  for (const op of ['follow', 'unfollow']) {
    const rows = raw.samples.filter(s => s.op === op).map(s => {
      const events = s.events, call = events.find(e => e.stage === 'call').at;
      const event = predicate => events.find(e => e.at >= call && predicate(e));
      const count = op === 'follow' ? 4 : 0;
      const desired = e => e.read?.data?.length === count;
      const published = event(e => e.stage === 'published' && desired(e));
      const final = event(e => e.stage === 'published' && desired(e) && e.read.complete && !e.read.revalidating);
      const react = event(e => e.stage === 'react' && desired(e) && e.read.complete && !e.read.revalidating);
      const admitted = event(e => e.stage === 'device-end' && e.op === 'admit');
      const settled = event(e => e.stage === 'device-end' && e.op === 'settle');
      const applied = event(e => e.stage === 'device-end' && e.op === 'apply' && e.watermark >= s.commit.seq);
      const returned = event(e => e.stage === 'returned');
      const marked = event(e => e.stage === 'published' && (e.read.loading || e.read.revalidating || e.read.complete === false));
      const misleading = events.filter(e => e.at >= call && e.stage === 'published' && !desired(e) && e.read?.complete && e.read?.fresh && !e.read?.revalidating);
      const rendering = events.filter(e => e.at >= call && e.stage === 'react').map(e => ({ ms: +(e.at - call).toFixed(3), ui: e.ui }));
      const sequence = events.filter(e => e.at >= call && e.stage === 'published').map(e => ({
        ms: +(e.at - call).toFixed(3), count: e.read?.data?.length ?? null,
        complete: e.read.complete ?? null, fresh: e.read.fresh ?? null,
        revalidating: e.read.revalidating ?? false, loading: e.read.loading ?? false,
        pendingRows: e.read.data?.filter(r => r.pending).length ?? null, ui: e.ui,
      }));
      let staleMs = 0, previous = { at: call, read: events.find(e => e.stage === 'initial').read };
      for (const e of events.filter(e => e.at >= call && e.stage === 'published')) {
        if (previous.read?.data?.length !== count && previous.read?.complete && previous.read?.fresh && !previous.read?.revalidating) staleMs += e.at - previous.at;
        previous = e;
        if (e === final) break;
      }
      const delta = (end, start) => end?.at !== undefined && start?.at !== undefined ? end.at - start.at : null;
      return { run: s.run, timeout: s.timeout, misleading: misleading.length, sequence, rendering, stages: {
        call_to_mark: delta(marked, { at: call }), call_to_admit: delta(admitted, { at: call }),
        admit_to_commit: delta(s.commit, admitted), call_to_commit: s.commit.at - call,
        commit_to_settle: delta(settled, s.commit), settle_to_apply: delta(applied, settled),
        apply_to_first_changed_answer: delta(published, applied), call_to_first_changed_answer: delta(published, { at: call }),
        first_changed_to_complete: delta(final, published), call_to_complete: delta(final, { at: call }),
        complete_to_react: delta(react, final), call_to_react: delta(react, { at: call }),
        call_to_return: delta(returned, { at: call }), misleading_duration: staleMs,
      } };
    });
    const summary = Object.fromEntries(Object.keys(rows[0].stages).map(stage => {
      const values = rows.map(r => r.stages[stage]);
      return [stage, { n: values.filter(Number.isFinite).length, p50: percentile(values, .5), p95: percentile(values, .95) }];
    }));
    results.push({ file: basename(path), op, metadata: raw.metadata, n: rows.length,
      timeouts: rows.filter(r => r.timeout).length,
      misleadingPublications: rows.reduce((sum, r) => sum + r.misleading, 0),
      affectedTrials: rows.filter(r => r.misleading).length, summary, rows });
  }
}
const output = JSON.stringify(results, null, 2);
if (process.env.FW_SUMMARY) writeFileSync(process.env.FW_SUMMARY, output);
else process.stdout.write(output + '\n');
