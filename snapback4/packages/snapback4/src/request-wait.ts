/** Cancel a caller's wait without cancelling a request that may have committed.
 * The transport still consumes its response; its owner fences any adoption. */
export function waitForCaller<T>(work: Promise<T>, stopped: AbortSignal): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const clean = () => stopped.removeEventListener("abort", stop);
    const stop = () => { clean(); resolve(undefined); };
    stopped.addEventListener("abort", stop, { once: true });
    if (stopped.aborted) stop();
    void work.then(value => { clean(); resolve(value); }, error => { clean(); reject(error); });
  });
}

/** Consume a local client's POST reply even if its caller has gone away. */
export function postForCaller(doFetch: typeof fetch, base: string, path: string, headers: Record<string, string>, body: unknown, stopped: AbortSignal) {
  const work = (async () => {
    const response = await doFetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body), ...(path.startsWith("/q/") ? { signal: stopped } : {}) });
    return { response, json: await response.json() as Record<string, unknown> };
  })();
  return waitForCaller(work, stopped);
}
