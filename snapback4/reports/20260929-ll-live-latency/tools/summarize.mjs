import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const percentile = (values, p) => values.length ? +values.toSorted((a,b) => a-b)[Math.max(0, Math.ceil(p * values.length) - 1)].toFixed(3) : null;
const stats = values => { values = values.filter(Number.isFinite); return { n: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: percentile(values, 1) }; };
export function stages(s) {
  const c = s.commit.at, seq = s.commit.seq, events = s.receiverEvents;
  const first = predicate => events.find(predicate)?.at;
  const published = s.trial.published, react = s.trial.reactCommit;
  const change = first(e => e.stage === 'response' && e.path === '/changes' && e.seq >= seq);
  const syncRequest = events.find(e => e.stage === 'request' && e.path === '/sync' && e.at >= change);
  const sync = events.find(e => e.stage === 'response' && e.path === '/sync' && e.id === syncRequest?.id);
  const apply = events.find(e => e.stage === 'device-end' && e.op === 'apply' && e.watermark >= seq);
  const applyStart = events.find(e => e.stage === 'device-start' && e.op === 'apply' && e.at >= sync?.at);
  const name = s.flow === 'profile' ? 'profile' : s.flow.startsWith('reaction') ? 'reactionRows' : s.flow === 'feed-image' ? 'feed' : 'history';
  const relevant = e => e.stage === 'device-end' && e.op === 'query' && e.name === name && (name !== 'reactionRows' || !e.args || e.args.message === 'anchor')
    || e.stage === 'response' && e.path === '/q/' + name && e.seq >= seq;
  const evaluated = events.filter(e => e.at <= published && relevant(e)).at(-1)?.at;
  const call = s.senderEvents.find(e => e.stage === 'sender-call')?.at;
  const asset = events.find(e => e.stage === 'request' && e.path.startsWith('/assets/'));
  const uploadStart = s.senderEvents.find(e => e.stage === 'upload-start');
  const uploadEnd = s.senderEvents.find(e => e.stage === 'upload-end');
  return {
    callToCommit: c - call, upload: uploadEnd?.at - uploadStart?.at,
    commitToChanges: change - c, changesToSyncRequest: syncRequest?.at - change,
    syncRequestToResponse: sync?.at - syncRequest?.at, syncResponseToApplyStart: applyStart?.at - sync?.at,
    apply: apply?.at - applyStart?.at, applyToEvaluation: evaluated - apply?.at,
    evaluationToPublication: published - evaluated, publicationToReact: react - published,
    commitToPublication: published - c, commitToReact: react - c,
    commitToQuote: s.trial.quoteReady - c, publicationToAssetFetch: asset?.at - published,
    assetFetchToHandle: s.trial.assetHandle - asset?.at, assetFetchToReady: s.trial.assetReady - asset?.at,
    commitToAssetReady: s.trial.assetReady - c,
    deviceQueries: events.filter(e => e.stage === 'device-start' && e.op === 'query').length,
    beforeApplyQueries: events.filter(e => e.stage === 'device-start' && e.op === 'query' && e.at < apply?.at).length,
    assetHomeReads: events.filter(e => e.stage === 'device-start' && e.op === 'asset_home').length,
    serverQueries: events.filter(e => e.stage === 'request' && e.path.startsWith('/q/')).length,
  };
}
for (const file of process.argv.slice(2)) {
  const data = JSON.parse(file.endsWith('.gz') ? gunzipSync(readFileSync(file)).toString() : readFileSync(file, 'utf8'));
  const flows = {};
  for (const flow of new Set(data.samples.map(s => s.flow))) {
    const samples = data.samples.filter(s => s.flow === flow), values = samples.map(stages);
    flows[flow] = { runs: samples.length, timeouts: samples.filter(s => s.timeout).length,
      ...Object.fromEntries(Object.keys(values[0]).map(key => [key, stats(values.map(v => v[key]))])) };
  }
  const out = file.replace(/\.json(?:\.gz)?$/, '-summary.json');
  writeFileSync(out, JSON.stringify({ metadata: data.metadata, flows }, null, 2) + '\n');
  console.log(file, Object.fromEntries(Object.entries(flows).map(([flow, value]) => [flow, value.commitToPublication])));
}
