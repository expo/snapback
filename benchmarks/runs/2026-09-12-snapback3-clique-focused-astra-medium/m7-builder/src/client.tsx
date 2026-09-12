import { createClient, createIndexedDBStorage } from 'snapback3/client';
import { Platform } from 'react-native';
const web = Platform.OS === 'web';
const url = web ? window.location.origin : 'http://127.0.0.1:54900';
const timings: any[] = [];
// Public adapter instrumentation only: delegates every operation unchanged.
const storage = web ? createIndexedDBStorage('snapback3:' + url) : null;
const measured = storage ? {
  load: async () => {
    const start = performance.now();
    const value = await storage.load();
    timings.push({
      kind: 'load',
      start,
      end: performance.now()
    });
    return value;
  },
  write: async (patch: any) => {
    const start = performance.now();
    await storage.write(patch);
    timings.push({
      kind: 'write',
      start,
      end: performance.now(),
      rowCount: patch.frame?.rows?.length ?? 0,
      messageIds: patch.frame?.rows?.filter((r: any) => r.table === 'messages').map((r: any) => r.id) ?? [],
      resources: patch.frame?.resources?.map((r: any) => ({
        op: r.op,
        args: r.args
      })) ?? [],
      operationCount: patch.operations?.length ?? 0
    });
  },
  subscribe: storage.subscribe?.bind(storage),
  close: storage.close?.bind(storage)
} : false;
export const client = createClient({
  url,
  storage: measured
});
if (web) {
  (window as any).clique = client;
  (window as any).storageTimings = timings;
  navigator.serviceWorker?.register('/sw.js').catch(console.error);
}
