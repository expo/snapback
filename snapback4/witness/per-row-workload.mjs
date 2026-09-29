// Same workload on browser React hooks and process observations. Timings are descriptive.
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const query = name => ({ kind: 'query', name });
export const ops = Object.fromEntries(['point', 'page', 'list', 'membersOf', 'profileByPrincipal', 'receiptMember'].map(name => [name, query(name)]));
export function requests(n, shape) {
  if (shape === 'chat') return Array.from({ length: n }, (_, i) => [{ op: ops.membersOf, args: { conversation: 'c' + i } }, { op: ops.profileByPrincipal, args: { owner: 'dev:bob' } }, { op: ops.receiptMember, args: { conversation: 'c' + i } }]).flat();
  if (shape === 'list') return [{ op: ops.list, args: { n } }];
  return Array.from({ length: n }, (_, i) => ({ op: shape === 'page' ? ops.page : ops.point,
    args: shape === 'page' ? { slot: i } : { id: 'c' + (shape === 'duplicate' ? 0 : i) } }));
}
export async function waitFor(predicate, label) {
  const end = performance.now() + (globalThis.pqTimeout ?? 120000);
  while (!predicate()) {
    if (performance.now() > end) throw Error('timeout: ' + label);
    await pause(10);
  }
}
export function instrumentation(baseFetch = fetch) {
  let calls = {}, active = 0, peak = 0;
  const hit = key => { calls[key] = (calls[key] || 0) + 1; };
  return {
    read: () => ({ calls: { ...calls }, peak }),
    reset() { calls = {}; peak = active; },
    async fetch(input, init) {
      const path = new URL(input).pathname;
      if (path.startsWith('/q/')) { hit('http:' + path.slice(3)); peak = Math.max(peak, ++active); }
      try { return await baseFetch(input, init); }
      finally { if (path.startsWith('/q/')) active--; }
    },
    device(underlying) { return { async open(...args) {
      const core = await underlying.open(...args);
      return { ...core, call(request, committed) { hit('device:' + request.op); return core.call(request, committed); } };
    } }; },
  };
}
export async function exercise({ client, url, n, shape, meter, mount, snapshots, unmount, idleMs = 1000 }) {
  const ready = () => snapshots().length > 0 && snapshots().every(r => 'data' in r && !r.revalidating);
  let lastTick = performance.now(), maxDelay = 0;
  const heartbeat = globalThis.process ? setInterval(() => { const now = performance.now(); maxDelay = Math.max(maxDelay, now - lastTick - 5); lastTick = now; }, 5) : null;
  meter.reset();
  const start = performance.now(); await mount(requests(n, shape)); await waitFor(ready, 'mount');
  const mountMs = performance.now() - start, mountWork = meter.read();
  await pause(200); meter.reset();
  const browserCpu = await globalThis.pqCpu?.();
  const hostStart = await globalThis.pqHost?.();
  const cpuStart = globalThis.process?.cpuUsage?.(), idleStart = performance.now();
  await pause(idleMs);
  const idleCpu = cpuStart ? process.cpuUsage(cpuStart) : undefined;
  const idle = { ms: performance.now() - idleStart, cpuMs: idleCpu ? (idleCpu.user + idleCpu.system) / 1000 : 1000 * ((await globalThis.pqCpu?.()) - browserCpu), ...meter.read() };
  const hostEnd = await globalThis.pqHost?.();
  if (hostStart && hostEnd) idle.hostCpuMs = (hostEnd.cpuSeconds - hostStart.cpuSeconds) * 1000;
  const write = async (name, args) => {
    meter.reset(); const started = performance.now();
    const reply = await fetch(url + '/m/' + name, { method: 'POST', headers: { 'x-snapback-persona': 'alice' },
      body: JSON.stringify({ id: crypto.randomUUID(), args }) }).then(r => r.json());
    if (reply.state !== 'sent') throw Error(JSON.stringify(reply));
    if (client.sync) await client.sync();
    if (name === 'edit') await waitFor(() => ready() && snapshots().some(r => JSON.stringify(r.data).includes(args.label)), 'write visibility');
    await pause(200); await waitFor(ready, name);
    return { ms: performance.now() - started, ...meter.read() };
  };
  const relevant = await write('edit', { id: 'c0', label: 'updated-' + crypto.randomUUID() });
  const unrelated = await write('unrelated', {});
  const memory = { ...(globalThis.process?.memoryUsage?.() ?? { jsHeap: performance.memory?.usedJSHeapSize }), host: await globalThis.pqHost?.() };
  await unmount();
  if (heartbeat) clearInterval(heartbeat);
  return { n, shape, eventLoopMaxDelayMs: heartbeat ? maxDelay : null, mountMs, mountWork, idle, relevant, unrelated, memory };
}
