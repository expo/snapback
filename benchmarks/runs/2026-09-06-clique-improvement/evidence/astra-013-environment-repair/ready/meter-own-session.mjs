// Operational use of the frozen adapter; no synthetic boundaries or estimates.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { adaptCodexSessionTree } from '/Users/ccheever/clique-full-astra-next-primary-20260906/instrument/metering/adapters/codex-session.mjs';
import { addTokenCounts, zeroTokenCounts, nullTokenCounts } from '/Users/ccheever/clique-full-astra-next-primary-20260906/instrument/metering/counts.mjs';
const base = new URL('./runtime/', import.meta.url);
const evidence = JSON.parse(readFileSync(new URL('native-evidence.json', base), 'utf8'));
const bytes = readFileSync(evidence.retained);
if (createHash('sha256').update(bytes).digest('hex') !== evidence.sha256) throw Error('retained own rollout changed');
const records = bytes.toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
const adapted = adaptCodexSessionTree([{sourceId:'builder', nativeSessionId:evidence.nativeSessionId, records}]);
const totals = adapted.turns.length ? adapted.turns.reduce((sum, turn) => addTokenCounts(sum, turn.usage), zeroTokenCounts()) : nullTokenCounts();
writeFileSync(new URL('native-meter.json', base), JSON.stringify({scope:'exact observed root native session only', completeDescendantTreeClaimed:false, perMilestoneJoin:null, totals, ...adapted}, null, 2)+'\n', {flag:'wx'});
