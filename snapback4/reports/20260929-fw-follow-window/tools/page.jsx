import React, { useSyncExternalStore, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createLocalClient } from 'snapback4/local';
import { webDevice } from 'snapback4/web';
import { trace, observe, perform, render } from './trace.mjs';

const log = trace();
let client, watch, shown = { loading: true };
const subscribers = new Set();
window.receive = read => { shown = read; for (const fn of subscribers) fn(); };
function Screen() {
  const read = useSyncExternalStore(fn => { subscribers.add(fn); return () => subscribers.delete(fn); }, () => shown);
  useLayoutEffect(() => { log.mark('react', { read, ui: render(read) }); }, [read]);
  return <main id="feed">{render(read)}</main>;
}
window.openClient = async ({ url, session, receiver, tier }) => {
  if (tier === 'wasm') {
    client = await createLocalClient({ url, session, device: log.device(webDevice()), fetch: log.fetch });
    await client.sync();
    if (receiver) watch = observe(client, log, window.receive);
  }
  if (receiver) createRoot(document.getElementById('root')).render(<Screen />);
};
window.seed = async () => {
  for (const postId of ['first', 'second', 'third']) {
    const w = await client.mutate({ kind: 'mutation', name: 'post' }, { postId, parentId: null });
    if (w.state !== 'sent') throw Error(JSON.stringify(w));
  }
  const w = await client.mutate({ kind: 'mutation', name: 'repost' }, { postId: 'first' });
  if (w.state !== 'sent') throw Error(JSON.stringify(w));
};
window.prepare = () => { log.events.length = 0; log.mark('initial', { read: watch?.getSnapshot() ?? shown, ui: render(watch?.getSnapshot() ?? shown) }); };
window.perform = ({ op, actor }) => perform(client, log, op, actor);
window.events = () => log.events;
window.ready = count => { const read = watch?.getSnapshot() ?? shown; return read.data?.length === count && read.complete && !read.revalidating; };
