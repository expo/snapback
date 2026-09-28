import type { Refusal } from './contract.ts';

// @ref LLP 3000#http-overload-diagnostics — distinguish HTTP refusals from lost replies.
export function refusal(value: unknown): Refusal | undefined {
  if (!value || typeof value !== 'object') return;
  const r = value as Record<string, unknown>;
  if (!['code', 'family', 'message'].every(key => typeof r[key] === 'string' && r[key] !== '')) return;
  if (r.retryable !== undefined && typeof r.retryable !== 'boolean') return;
  if (!['detail', 'site', 'rewrite', 'guide', 'rule'].every(key => r[key] === undefined || typeof r[key] === 'string')) return;
  return value as Refusal;
}
export const overloaded = (why?: Refusal): boolean => why?.code === 'E_RATE_LIMIT' && why.retryable === true;
// @ref LLP 3000.029#11 — diagnostics without evaluated authority cannot replace a read.
export const nonAuthoritativeRefusal = (why?: Refusal): boolean =>
  why?.code === 'E_RATE_LIMIT' || why?.code === 'E_HTTP_RESPONSE' || why?.code === 'E_OFFLINE'
  || why?.code === 'E_STORE_BUSY' || (why?.retryable === true && (why.code === 'E_STORE' || why.code === 'E_AUTH'));
export function transportRefusal(error?: unknown): Refusal {
  const failure = error as { code?: string; message?: string; cause?: { code?: string; message?: string } } | undefined;
  const cause = failure?.cause?.code ?? failure?.cause?.message ?? failure?.code ?? failure?.message;
  return { code: 'E_OFFLINE', family: 'link', message: `the request did not complete${cause ? `: ${cause}` : '; the host supplied no transport cause'}; check the connection and server logs before retrying`, retryable: true };
}
export function invalidResponse(status: number, outcome = 'request'): Refusal {
  return { code: 'E_HTTP_RESPONSE', family: 'link', message: `the server answered HTTP ${status} without a valid ${outcome} response; the ${outcome} outcome is unknown; inspect the server or proxy logs before retrying`, retryable: true };
}
export function retryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const delay = Number.isNaN(seconds) ? Date.parse(value) - Date.now() : seconds * 1000;
  return Number.isNaN(delay) ? 0 : Math.max(0, delay);
}
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(); return; }
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, Math.min(ms, 2_147_483_647));
    signal?.addEventListener('abort', done, { once: true });
  });
}
export const jitter = (delay: number): number => delay * (1 + Math.random() * 0.25);
/** An unsuccessful probe never establishes identity, even if the peer replied. */
export function pauseProbe(response: Response | undefined, signal: AbortSignal): Promise<void> {
  return pause(jitter(Math.max(1000, retryAfter(response?.headers.get('retry-after') ?? null))), signal);
}
export async function readResponse(response: Response, decode?: (response: Response) => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  let json: Record<string, unknown>;
  try { json = decode ? await decode(response) : await response.json() as Record<string, unknown>; }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; return { denied: invalidResponse(response.status) }; }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { denied: invalidResponse(response.status) };
  const why = json.denied ?? json.why;
  if (why !== undefined && !refusal(why) || !response.ok && !refusal(why)) return { denied: invalidResponse(response.status) };
  return json;
}
/** Only safe reads use this helper. Same-ID mutations retain their outbox's
 * retry owner; effects and asset transfers must not replay ambiguous outcomes. */
export async function readWithAdmissionRetry(send: () => Promise<Response>, current: () => boolean, signal?: AbortSignal, decode?: (response: Response) => Promise<Record<string, unknown>>) {
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    const response = await send(), json = await readResponse(response, decode);
    if (!overloaded(refusal(json.denied ?? json.why)) || attempt === 3 || !current()) return { response, json };
    const delay = jitter(Math.max(250 * 2 ** attempt, retryAfter(response.headers.get('retry-after'))));
    if (waited + delay > 10_000) return { response, json };
    await pause(delay, signal);
    waited += delay;
    if (!current() || signal?.aborted) return { response, json };
  }
}
/** A delivered refusal is not a transport outage. Polls wait before trying again. */
export async function pauseRefusal(response: Response, why: Refusal | undefined, signal: AbortSignal): Promise<boolean> {
  if (!refusal(why)?.retryable) return false;
  await pause(jitter(Math.max(1000, retryAfter(response.headers.get('retry-after')))), signal);
  return true;
}
