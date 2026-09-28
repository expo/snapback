// Hold an already-rendered response, using the client's ordinary fetch injection.
export function syncControl(t, transport = fetch) {
  let next, attempts = 0;
  const gates = new Set();
  t.after(() => { for (const gate of gates) gate.release.resolve(); });
  return {
    get attempts() { return attempts; },
    hold() {
      if (next) throw Error("a sync response is already armed");
      const ready = Promise.withResolvers(), release = Promise.withResolvers();
      next = { ready, release }; gates.add(next);
      return { ready: ready.promise, release: release.resolve };
    },
    async fetch(input, init) {
      if (new URL(input).pathname !== "/sync") return transport(input, init);
      attempts++;
      const gate = next; next = undefined;
      const reply = await transport(input, init);
      if (!gate) return reply;
      const bytes = await reply.arrayBuffer();
      gate.ready.resolve();
      if (init.signal?.aborted) gate.release.resolve();
      else init.signal?.addEventListener("abort", gate.release.resolve, { once: true });
      await gate.release.promise; gates.delete(gate);
      init.signal?.removeEventListener("abort", gate.release.resolve);
      return new Response(bytes, { status: reply.status, headers: reply.headers });
    },
  };
}

// Keep the background change poll quiet without triggering its silence watchdog.
export function parkedChanges(signal) {
  let cleanup;
  return new Response(new ReadableStream({
    start(controller) {
      const beat = () => controller.enqueue(new Uint8Array([32, 10]));
      const timer = setInterval(beat, 500);
      const abort = () => { cleanup(); controller.error(signal.reason); };
      cleanup = () => { clearInterval(timer); signal.removeEventListener("abort", abort); };
      if (signal.aborted) abort();
      else { signal.addEventListener("abort", abort, { once: true }); beat(); }
    },
    cancel() { cleanup(); },
  }));
}
