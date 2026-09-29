import React from 'react';
import { createRoot } from 'react-dom/client';
import { SnapbackProvider, useQuery } from '../packages/snapback4/src/react.tsx';
import { createClient } from '../packages/snapback4/src/client.ts';
import { createLocalClient } from '../packages/snapback4/src/local.ts';
import { webDevice } from '../packages/snapback4/src/web.ts';
import { exercise, instrumentation, ops } from './per-row-workload.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
window.measure = async (url, tier, n, shape) => {
  const meter = instrumentation(), reads = new Map();
  const options = { url, persona: 'alice', fetch: meter.fetch, waitSeconds: 1 };
  const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options,
    device: meter.device(webDevice({ worker: tier === 'worker' })), name: crypto.randomUUID() });
  if (client.sync) await client.sync();
  // Warm schema/connection before measuring hook subscription work.
  await client.query({ kind: 'query', name: 'point' }, { id: 'c0' });
  await pause(200);
  const tasks = [];
  const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration)));
  observer.observe({ type: 'longtask' });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  function Row({ request, index }) {
    const read = useQuery(request.op, request.args); reads.set(index, read);
    return <span>{'data' in read ? JSON.stringify(read.data) : 'loading'}</span>;
  }
  // The comparative's exact dependency cascade: roster -> peer principal -> profile.
  function ChatRow({ index }) {
    const conversation = 'c' + index;
    const members = useQuery(ops.membersOf, { conversation });
    const other = ('data' in members ? members.data : []).find(m => m.principal !== 'dev:alice');
    const profile = useQuery(ops.profileByPrincipal, { owner: other?.principal ?? 'dev:alice' });
    const me = useQuery(ops.receiptMember, { conversation });
    reads.set(index * 3, members); reads.set(index * 3 + 1, profile); reads.set(index * 3 + 2, me);
    return <span>{JSON.stringify([members, profile, me])}</span>;
  }
  try {
    const result = await exercise({ client, url, n, shape, meter,
      mount: async requests => { root.render(<SnapbackProvider client={client}>{shape === 'chat' ? Array.from({ length: n }, (_, index) => <ChatRow key={index} index={index}/>) : requests.map((request, index) => <Row key={index} request={request} index={index}/>)}</SnapbackProvider>); },
      snapshots: () => [...reads.values()], unmount: async () => { root.unmount(); host.remove(); } });
    await pause(50); observer.disconnect();
    return { ...result, longestMainThreadTaskMs: Math.max(0, ...tasks), longTasks: tasks.length };
  } catch (error) {
    const values = [...reads.values()];
    throw Error(String(error) + JSON.stringify({ work: meter.read(), schedules: window.pqSchedules, examples: values.slice(0,3), reads: values.length, loading: values.filter(r => r.loading).length,
      revalidating: values.filter(r => r.revalidating).length, refusals: values.filter(r => r.denied).slice(0, 3) }));
  } finally { observer.disconnect(); await client.close(); }
};
