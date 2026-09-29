import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(import.meta.dirname, '..');
const fmt = x => x?.n ? `${x.p50.toFixed(1)} / ${x.p95.toFixed(1)}` : '—';
let text = '# Stage distributions\n\nEach cell is p50 / p95 in milliseconds, except work counts. Nearest-rank percentiles; 20 trials per flow. All 2,240 trials completed without timeout. These stages overlap: a whole server answer can finish before local apply, yielding negative apply-to-evaluation or publication-to-fetch intervals. Do not sum independent percentiles. The raw UNIX-millisecond timestamps and sample maxima remain in the compressed traces and summary JSON. See REPORT.md for instrumentation boundaries and scope.\n';
function table(flows, columns) {
  text += '\n| Flow | ' + columns.map(([name]) => name).join(' | ') + ' |\n';
  text += '|---|' + columns.map(() => '---:|').join('') + '\n';
  for (const [flow, values] of Object.entries(flows)) {
    text += '| ' + flow + ' | ' + columns.map(([,key]) => fmt(values[key])).join(' | ') + ' |\n';
  }
}
for (const name of readdirSync(dir).filter(name => /^(baseline|final).*summary\.json$/.test(name)).sort()) {
  const { metadata, flows } = JSON.parse(readFileSync(resolve(dir, name)));
  text += `\n## ${name.replace('-summary.json', '')}\n\nDevice: ${metadata.tier}; media: ${metadata.retention}; available CPUs: ${metadata.cpus}; busy workers: ${metadata.loadWorkers}.\n`;
  table(flows, [['Call→commit','callToCommit'],['Upload','upload'],['Commit→changes','commitToChanges'],['Changes→sync request','changesToSyncRequest'],['Sync HTTP','syncRequestToResponse'],['Response→apply start','syncResponseToApplyStart'],['Apply','apply']]);
  table(flows, [['Apply→evaluation','applyToEvaluation'],['Evaluation→publication','evaluationToPublication'],['Publication→React','publicationToReact'],['Commit→publication','commitToPublication'],['Commit→React','commitToReact'],['Commit→quote','commitToQuote']]);
  table(Object.fromEntries(Object.entries(flows).filter(([flow]) => ['photo','feed-image','once-photo'].includes(flow))), [['Publication→asset request','publicationToAssetFetch'],['Request→handle','assetFetchToHandle'],['Request→ready','assetFetchToReady'],['Commit→ready','commitToAssetReady']]);
  text += '\nDevice and HTTP operation counts (p50 / p95, not milliseconds):\n';
  table(flows, [['Device queries','deviceQueries'],['Queries before apply','beforeApplyQueries'],['Asset home reads','assetHomeReads'],['Server queries','serverQueries']]);
}
writeFileSync(resolve(dir, 'STAGES.md'), text);
