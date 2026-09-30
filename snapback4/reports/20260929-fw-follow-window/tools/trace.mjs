// Adapted from lane LL's two-client fetch/device/observation instrument.
export const now = () => performance.timeOrigin + performance.now();
export function render(read) {
  if (read.denied) return read.denied.code;
  if (read.loading || read.revalidating || !read.complete) return 'Updating…';
  return read.data.length ? read.data.map(row => `${row.repost ? 'repost' : 'post'}:${row.post}`).join(', ') : 'No posts';
}
export function trace() {
  const events = [];
  const mark = (stage, detail = {}) => events.push({ stage, at: now(), ...detail });
  return {
    events, mark,
    fetch: async (input, init) => {
      const path = new URL(input).pathname, id = crypto.randomUUID();
      mark('request', { path, id });
      const response = await fetch(input, init);
      mark('headers', { path, id, status: response.status });
      if (!response.body || !['/sync', '/changes'].includes(path) && !path.startsWith('/m/') && !path.startsWith('/q/')) return response;
      let body = ''; const decoder = new TextDecoder();
      return new Response(response.body.pipeThrough(new TransformStream({
        transform(bytes, controller) { body += decoder.decode(bytes, { stream: true }); controller.enqueue(bytes); },
        flush() {
          let json; try { json = JSON.parse(body + decoder.decode()); } catch {}
          mark('response', { path, id, seq: json?.seq, watermark: json?.watermark, state: json?.state });
        },
      })), { status: response.status, statusText: response.statusText, headers: response.headers });
    },
    device: underlying => ({ async open(...args) {
      const core = await underlying.open(...args), call = core.call.bind(core);
      core.call = async (request, committed) => {
        const { op, name } = request; mark('device-start', { op, name });
        const result = await call(request, value => { mark('device-commit', { op }); committed?.(value); });
        mark('device-end', { op, name, watermark: request.page?.watermark, touched: result.ok?.touched });
        return result;
      };
      return core;
    } }),
  };
}
export function observe(client, log, publish = () => {}) {
  const watch = client.observe({ kind: 'query', name: 'cards' }, { c: null });
  const record = () => { const read = watch.getSnapshot(); log.mark('published', { read, ui: render(read) }); publish(read); };
  watch.subscribe(record); record();
  client.onPendingWrites(() => { void client.pendingWrites().then(pending => log.mark('pending', { writes: pending.map(({ op, state, predicted }) => ({ op, state, predicted })) })); });
  client.onWrite(write => log.mark('write', { state: write.state, seq: write.seq, why: write.why }));
  return watch;
}
export async function perform(client, log, op, actor) {
  log.mark('call', { op });
  const promise = client.mutate({ kind: 'mutation', name: op }, { actor });
  log.mark('returned-promise', { op });
  const write = await promise;
  log.mark('returned', { op, state: write.state, seq: write.seq });
  if (write.state !== 'sent') throw Error(JSON.stringify(write));
  return write;
}
