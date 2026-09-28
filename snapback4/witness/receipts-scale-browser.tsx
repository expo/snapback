// Browser half of receipts-scale.mjs. The guide owns the delivery reporter;
// the visible page owns only seen, never a walk to fill delivery gaps.
import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createLocalClient } from '../packages/snapback4/src/local.ts';
import { webDevice, indexedDbPersistence } from '../packages/snapback4/src/web.ts';
import { login } from '../packages/snapback4/src/auth.ts';
import { SnapbackProvider, useClient, usePage, useQuery, usePendingWrites } from '../packages/snapback4/src/react.tsx';

const queries = new Map<string, any>();
const query = (name: string): any => { if (!queries.has(name)) queries.set(name, { name, kind: 'query' }); return queries.get(name); };
const mutation = (name: string): any => ({ name, kind: 'mutation' });
const send = mutation('send'), seen = mutation('seen');
const stats = { calls: [] as any[], saves: [] as any[], renders: 0, sends: [] as any[], cold: {} as any };
let client: any;
function Bubble({ message, receipt }: any) {
  stats.renders++;
  usePendingWrites(send);
  useQuery(query('messageAuthor'), { message: message.id });
  useQuery(query('messageReactions'), { message: message.id });
  return <div data-message={message.text} data-receipt={receipt}>{message.text}</div>;
}
function Screen() {
  const c = useClient(), history = usePage(query('history'), { conversation: 'busy' });
  const receipts = useQuery<any, any>(query('messageReceipts'), { conversation: 'busy' });
  const member = useQuery<any, any>(query('receiptMember'), { conversation: 'busy' });
  usePage(query('inbox'), {});
  const attempted = useRef(0);
  const newest = Math.max(0, ...history.items.filter((m: any) => !m.pending).map((m: any) => m.ordinal));
  useEffect(() => {
    if (!('data' in member) || !member.data || newest <= Math.max(member.data.seenOrdinal, attempted.current)) return;
    attempted.current = newest;
    void c.mutate(seen, { conversation: 'busy', through: newest });
  }, [c, member, newest]);
  const states = new Map(('data' in receipts ? receipts.data : []).map((r: any) => [r.id, r.receipt]));
  return <><input id="text"/><button id="send" onClick={() => {
    const text = (document.querySelector('#text') as HTMLInputElement).value, at = performance.now();
    const sample: any = { text, at }; stats.sends.push(sample);
    void c.mutate(send, { conversation: 'busy', text }).then(write => { sample.settledMs = performance.now() - at; sample.state = write.state; });
  }}>Send</button>{history.items.map((m: any) => <Bubble key={m.id} message={m} receipt={states.get(m.id)}/>)}</>;
}
(window as any).startReceipts = async (url: string, email: string, password: string) => {
  const at = performance.now();
  const signed = await login(url, email, password);
  stats.cold.loginMs = performance.now() - at;
  if (!signed.ok) throw new Error(JSON.stringify(signed.why));
  const persistence = indexedDbPersistence();
  const save = persistence.save.bind(persistence);
  persistence.save = async (...args: Parameters<typeof save>) => {
    const at = performance.now();
    try { return await save(...args); } finally {
      stats.saves.push({ at, ms: performance.now() - at, changes: args[1].length,
        bytes: new TextEncoder().encode(JSON.stringify(args[1])).length });
    }
  };
  const device = webDevice({ persist: persistence }), open = device.open.bind(device);
  device.open = async (...args: Parameters<typeof open>) => {
    const core = await open(...args), call = core.call.bind(core);
    core.call = async (...args: Parameters<typeof call>) => {
      const at = performance.now();
      try { return await call(...args); } finally { stats.calls.push({ at, op: args[0].op, name: args[0].name, ms: performance.now() - at }); }
    };
    return core;
  };
  client = await createLocalClient({ url, session: signed.session, device });
  stats.cold.openMs = performance.now() - at - stats.cold.loginMs;
  const root = document.createElement('main'); document.body.append(root);
  createRoot(root).render(<SnapbackProvider client={client}><Screen/></SnapbackProvider>);
  await client.sync();
  stats.cold.acquireMs = performance.now() - at - stats.cold.loginMs - stats.cold.openMs;
  return stats.cold;
};
(window as any).receiptStats = stats;
(window as any).readUnread = (member: string) => client.query(query('unreadFor'), { member });
(window as any).closeReceipts = () => client.close();
