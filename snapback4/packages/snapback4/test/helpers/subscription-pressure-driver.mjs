import { ReadWork } from '../../dist/read-work.js';
import { inspect } from '../../dist/inspection.js';
import { answerObservation } from '../../dist/read-observation.js';
import { episodeDeadline } from '../../dist/read-episode.js';
const queues = new WeakMap(), schedule = ReadWork.prototype.schedule;
ReadWork.prototype.schedule = function(watch, run) { queues.set(watch, this); return schedule.call(this, watch, run); };
const q = name => ({ kind: 'query', name });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function pressureDriver(client, state, render = () => {}) {
  const watches = [], owners = [], historyEvents = [], pressure = [], withdrawals = [], started = performance.now();
  const at = () => +(performance.now() - started).toFixed(3);
  const open = (name, args) => { const watch = client.observe(q(name), args); watches.push(watch); watch.subscribe(() => {}); return watch; };
  const history = open('history', { room: 'room' });
  for (let i = 0; i < 40; i++) {
    open('reactionRows', { message: 'm' + i }); open('receiptRows', { message: 'm' + i });
    open('profile', { principal: 'dev:p' + i });
  }
  open('following', {}); open('discover', {}); open('search', { room: 'room', q: 'History' });
  const end = performance.now() + 15000;
  while (!watches.every(w => 'data' in w.getSnapshot())) { if (performance.now() > end) throw Error('initial observations timed out: ' + JSON.stringify(history.getSnapshot())); await delay(10); }
  for (const watch of watches) {
    const owner = answerObservation(watch.getSnapshot()); owners.push(owner);
    let queueEntry;
    if (owner.queueEpisode) {
      const transition = owner.queueEpisode.bind(owner);
      owner.queueEpisode = queued => {
        if (queued && !owner.episodeQueue.paused) queueEntry = { at: at(), remainingMs: (episodeDeadline(owner.snapshot) ?? Infinity) - Date.now() };
        return transition(queued);
      };
    }
    const previous = owner.onWithdrawal;
    owner.onWithdrawal = () => {
      const work = queues.get(owner);
      withdrawals.push({ at: at(), historyEventIndex: historyEvents.length, query: owner.op.name, cause: 'change-timeout', queued: work.pending.has(owner), inFlight: work.active.has(owner), queueEntry,
        historyHoldMs: state.historyStarted === undefined ? 0 : (state.historyEnded ?? performance.now()) - state.historyStarted });
      previous();
    };
  }
  const sample = () => {
    const work = queues.get(owners.at(-1));
    pressure.push({ at: at(), queued: work.pending.size, inFlight: work.active.size,
      revalidating: owners.filter(w => w.snapshot.revalidating).length,
      withdrawn: owners.filter(w => !('data' in w.snapshot)).length });
  };
  const record = () => { const read = structuredClone(history.getSnapshot()); historyEvents.push({ at: at(), phase: state.phase, read }); render(read); sample(); };
  history.subscribe(record); record(); const timer = setInterval(sample, 10);
  return {
    async offline() { state.phase = 'offline'; state.offline = true; await client.sync(); },
    async send(id, ordinal) { return client.mutate({ kind: 'mutation', name: 'send' }, { id, room: 'room', ordinal, text: id }, { waitSeconds: 0 }); },
    async reconnect() { state.phase = 'reconnecting'; state.offline = false; state.slow = true; await client.sync(); },
    sync() { return client.sync(); },
    async releaseHistory() {
      // Optional probe of the legitimate active-attempt timeout, independent of queue wait.
      await delay(Math.max(0, (state.holdMs ?? 0) - (performance.now() - state.historyStarted)));
      state.historyRelease?.();
    },
    settle() { state.phase = 'settled'; state.slow = false; },
    result() { return { inspection: inspect(client), history: history.getSnapshot(), historyHeld: state.historyHeld === true, historyEvents, pressure, withdrawals, observations: watches.length }; },
    async close() { state.historyRelease?.(); clearInterval(timer); watches.forEach(w => w.close()); await client.close(); },
  };
}
export function pressureDevice(opener, state) {
  return { async open(...args) {
    const core = await opener.open(...args);
    return { ...core, async call(request, committed) {
      // Controlled device scheduling pressure, never synthetic query results.
      if (state.slow && request.op === 'query' && request.name !== 'history') await delay(120);
      const reply = await core.call(request, committed);
      if (state.slow && request.op === 'query' && request.name === 'history' && !state.historyHeld) {
        state.historyHeld = true; state.historyStarted = performance.now();
        await new Promise(resolve => { state.historyRelease = resolve; }); state.historyEnded = performance.now();
      }
      return reply;
    } };
  } };
}
