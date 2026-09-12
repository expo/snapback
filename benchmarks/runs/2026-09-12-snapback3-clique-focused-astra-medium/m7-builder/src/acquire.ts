import { client } from './client';
// Explicit acquisition demand on the ordinary client. No extra reader/cache or transport retry.
async function fresh(op: string, args: any, state: any) {
  const resource = client.watch<any[]>(op, args);
  let snapshot = await resource.refresh();
  if (!snapshot.fresh || !Array.isArray(snapshot.data)) {
    const start = performance.now();
    snapshot = await new Promise<any>((resolve, reject) => {
      let off = () => {};
      const timer = setTimeout(() => {
        off();
        reject(Error('Fresh resource wait timed out: ' + op));
      }, 15000);
      const check = () => {
        const s = resource.getSnapshot();
        if (s.fresh && Array.isArray(s.data)) {
          clearTimeout(timer);
          off();
          resolve(s);
        } else if (s.status === 'denied' || s.status === 'error') {
          clearTimeout(timer);
          off();
          reject(Error(s.error?.message ?? s.status));
        }
      };
      off = resource.subscribe(check);
      check();
    });
    state.resourceWaits.push({
      op,
      args,
      start,
      end: performance.now()
    });
  }
  return snapshot;
}
export async function acquire() {
  const start = performance.now();
  const state: any = {
    start,
    status: 'running',
    pages: [],
    ids: [],
    conversations: [],
    resourceWaits: [],
    lastFetched: null,
    lastDurable: null
  };
  (window as any).acquisition = state;
  let c: string | null = null;
  try {
    do {
      const s = await fresh('conversations.inbox', {
        c
      }, state);
      state.conversations.push(...s.data!);
      state.pages.push({
        op: 'conversations.inbox',
        c,
        next: s.next,
        sdkComplete: s.complete,
        count: s.data!.length,
        at: performance.now()
      });
      c = s.next ?? null;
    } while (c);
    for (const room of state.conversations) {
      c = null;
      do {
        const request = performance.now();
        const s = await fresh('messages.page', {
          conversationId: room.id,
          c
        }, state);
        state.ids.push(...s.data!.map((m: any) => m.id));
        state.pages.push({
          op: 'messages.page',
          conversationId: room.id,
          c,
          next: s.next,
          sdkComplete: s.complete,
          count: s.data!.length,
          request,
          at: performance.now(),
          seq: s.seq
        });
        state.lastFetched = performance.now();
        state.lastDurable = performance.now();
        c = s.next ?? null;
      } while (c);
    }
    state.status = 'complete';
    state.end = performance.now();
    return state;
  } catch (e) {
    state.status = 'failed';
    state.error = String(e);
    state.end = performance.now();
    throw e;
  }
}
if (typeof window !== 'undefined') (window as any).runAcquisition = acquire;
