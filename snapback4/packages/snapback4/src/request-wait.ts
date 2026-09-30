import { readResponse, readWithAdmissionRetry } from "./http-response.ts";
/** Cancel a caller's wait without cancelling a request that may have committed.
 * The transport still consumes its response; its owner fences any adoption. */
export function waitForCaller<T>(work: Promise<T>, stopped: AbortSignal, known = () => false): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const clean = () => stopped.removeEventListener("abort", stop);
    const stop = () => { clean(); if (!known()) resolve(undefined); };
    stopped.addEventListener("abort", stop, { once: true });
    if (stopped.aborted) stop();
    void work.then(value => { clean(); resolve(value); }, error => { clean(); reject(error); });
  });
}

/** Consume a local client's POST reply even if its caller has gone away. */
export function postForCaller(doFetch: typeof fetch, base: string, path: string, headers: Record<string, string>, body: unknown, stopped: AbortSignal, received = (_json: Record<string, unknown>, _status: number) => {}, decode?: (response: Response) => Promise<Record<string, unknown>>) {
  let arrived = false;
  const work = (async () => {
    const send = () => doFetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(path.startsWith("/m/") ? { ...(body as object), retry_write: true } : body), ...(path.startsWith("/q/") ? { signal: stopped } : {}) });
    const { response, json } = path.startsWith("/q/")
      ? await readWithAdmissionRetry(send, () => !stopped.aborted, stopped, decode)
      : await send().then(async response => ({ response, json: await readResponse(response, decode) }));
    received(json, response.status);
    arrived = !stopped.aborted;
    return { response, json };
  })();
  return waitForCaller(work, stopped, () => arrived);
}
