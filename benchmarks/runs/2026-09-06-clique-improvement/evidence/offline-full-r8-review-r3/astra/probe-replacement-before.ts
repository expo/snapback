import { readFileSync, writeFileSync } from 'node:fs';
import { OfflineRuntime } from './probe-before/snapback2/packages/snapback2/src/offline.ts';
import { PersistentRangeStore } from './probe-before/snapback2/packages/snapback2/src/store/range-store.ts';

const fixture = JSON.parse(readFileSync('./probe-source/snapback2/packages/evaluator/src/test-search-v5-fixtures.json','utf8')).nativeR8.halo;
Date.now = () => fixture.first.readTime + 1000;
const copy = (v: any) => JSON.parse(JSON.stringify(v));
let saved: any;
const factory = () => new PersistentRangeStore({ carrier: 'bounded-json', open: async () => saved,
  replace: async state => { saved = copy(state); }, close() {}, wipe: async () => {} });
let runtime = new OfflineRuntime({ store: factory });
await runtime.open(fixture.first.authority.principal,true);
await runtime.program(fixture.program);
const commit = async (op: string, value: any) => runtime.commit(op,{},await runtime.accept(op,{},value));
const select = async () => {
  const value: any = await runtime.twin.evaluate('clock.fixed',{});
  return { state: value?.state, rows: value?.data?.rows, next: value?.next, reason: value?.reason, sites: value?.sites };
};
await commit('clock.fixed',copy(fixture.first));
const initial = await select();
// A newer separately admitted delivery confirms the original row images at seq3.
const latest = copy(fixture.first);
latest.seq = fixture.first.seq + 2; latest.readTime += 2;
latest.planHash = fixture.program.programs['clock.read'].planHash;
latest.validator = 'b'.repeat(64);
latest.receipt = { ranges: [],absences: [],verdicts: [] };
latest.rows = latest.rows.filter((r: any) => ['r0','r1'].includes(r.id));
latest.data = { now: latest.readTime, rows: latest.rows.map((r: any) => ({$row:{table:r.table,id:r.id}})) };
await commit('clock.read',latest);
const afterLatest = await select();
// The delayed seq2 replacement has unchanged member ordering and last endpoint,
// but distinct issuing keys for two non-last members. Current seq3 rows prevail.
const delayed = copy(fixture.first);
delayed.seq = fixture.first.seq + 1; delayed.readTime++;
delayed.validator = 'c'.repeat(64); delayed.data.now = delayed.readTime;
for (const row of delayed.rows) {
  if (row.id === 'r0') row.row.at = -20;
  if (row.id === 'r1') row.row.at = -10;
}
writeFileSync('probe-replacement-before-inputs.json',JSON.stringify({program:fixture.program,initial:fixture.first,latest,delayed},null,2)+'\n');
await commit('clock.fixed',delayed);
const warm = await select();
const stateBeforeCold = JSON.stringify(saved);
writeFileSync('probe-replacement-before-state.json',JSON.stringify(saved,null,2)+'\n');
await runtime.close();
runtime = new OfflineRuntime({store:factory});
await runtime.open(fixture.first.authority.principal,true);
const cold = await select();
console.log(JSON.stringify({initial,afterLatest,warm,cold,persistedUnchanged:stateBeforeCold===JSON.stringify(saved)},null,2));
await runtime.close();
