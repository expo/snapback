// Exclusive sampled attribution; diagnostic CPU runs are separate from timings.
// node witness/sync-profile-summary.mjs PREFIX.cpuprofile PREFIX-profile.json OUTPUT.json
import { readFileSync, writeFileSync } from 'node:fs';
const [cpuPath, tracePath, output] = process.argv.slice(2);
const cpu = JSON.parse(readFileSync(cpuPath)), trace = JSON.parse(readFileSync(tracePath));
const nodes = new Map(cpu.nodes.map(node => [node.id, node])), parents = new Map();
for (const node of cpu.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
const categories = [
  ['physical counts', '::update_cap_counts'],
  ['staged row decode', /::device::decoded::<.*::snapshot::Staged>/],
  ['media markers', '::device::media::remember'],
  ['index insertion', '::set_entry'],
  ['index construction', '::rows::index_write'],
  ['row writes', '::set_row'],
  ['coverage', '::device::history::events'],
  ['boundaries', '::device::boundary::'],
  ['staging', '::device::snapshot::stage'],
  ['commit and change encoding', '::DeviceTx>::commit'],
  ['publication remainder', '::apply_publication_inner'],
  ['command decode and validation', '::call::try_call_text'],
  ['drain encoding', '::WebDevice>::drain'],
];
const classified = new Map(), stackOf = id => {
  if (classified.has(id)) return classified.get(id);
  const stack = [];
  for (let at = id; at; at = parents.get(at)) stack.push(nodes.get(at).callFrame.functionName);
  const joined = stack.join('\n');
  const category = categories.find(([, pattern]) => typeof pattern === 'string' ? joined.includes(pattern) : pattern.test(joined))?.[0] ?? 'host / other';
  const value = { category, stack }; classified.set(id, value); return value;
};
const exclusiveMs = {}, inclusiveHostMs = {};
const commands = trace.calls.filter(c => c.op !== 'drain');
const pageCalls = commands.filter(c => c.op === 'apply').map(c => ({ ...c, sampledMs: {}, persistence: { transactions: 0, ms: 0, puts: 0, gets: 0, deletes: 0, bytes: 0 } }));
// Attribute durable work between successive applies, including sync progress
// metadata. Internal sync_state reads may occur between apply and its drain.
for (const [index, page] of pageCalls.entries()) {
  const next = pageCalls[index + 1]?.at ?? Infinity;
  for (const tx of trace.transactions.filter(tx => tx.at >= page.at && tx.at < next)) {
    page.persistence.transactions++;
    for (const key of ['ms', 'puts', 'gets', 'deletes', 'bytes']) page.persistence[key] += tx[key];
  }
}
let clock = cpu.startTime / 1000, position = 0;
for (let n = 0; n < cpu.samples.length; n++) {
  const ms = cpu.timeDeltas[n] / 1000; clock += ms;
  const { category, stack } = stackOf(cpu.samples[n]);
  exclusiveMs[category] = (exclusiveMs[category] ?? 0) + ms;
  for (const name of ['writeBucket', 'pairBytes', 'JSON.<computed>', 'passStringToWasm0', 'getStringFromWasm0', '(garbage collector)']) {
    if (stack.includes(name)) inclusiveHostMs[name] = (inclusiveHostMs[name] ?? 0) + ms;
  }
  if (trace.monotonicStartMs !== undefined) {
    const relative = clock - trace.monotonicStartMs;
    while (position < pageCalls.length && relative > pageCalls[position].at + pageCalls[position].ms) position++;
    const page = pageCalls[position];
    if (page && relative >= page.at) page.sampledMs[category] = (page.sampledMs[category] ?? 0) + ms;
  }
}
const transactions = { count: trace.transactions.length, modes: {}, puts: 0, gets: 0, deletes: 0, bytes: 0, issueMs: 0, ms: 0, stores: {} };
for (const tx of trace.transactions) {
  transactions.modes[tx.mode] = (transactions.modes[tx.mode] ?? 0) + 1;
  for (const key of ['puts', 'gets', 'deletes', 'bytes', 'issueMs', 'ms']) transactions[key] += tx[key];
  for (const [name, store] of Object.entries(tx.stores ?? {})) {
    const total = transactions.stores[name] ??= { puts: 0, bytes: 0 };
    total.puts += store.puts; total.bytes += store.bytes;
  }
}
const round = object => JSON.parse(JSON.stringify(object, (k, v) => typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v));
writeFileSync(output, JSON.stringify(round({ cpuPath, tracePath, samplingMicroseconds: 1000, exclusiveMs, inclusiveHostMs,
  json: trace.json, transactions, pageCalls, perPageCpuAligned: trace.monotonicStartMs !== undefined }), null, 2));
