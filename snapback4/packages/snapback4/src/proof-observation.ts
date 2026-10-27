// @ref LLP 3000.037.000#9 — bounded refusal labels; conflicting object reuse never establishes request identity.
// Shared with browser bundles; inactive outside proof runs. Never retains
// arguments, tokens, row data, messages or response bodies.
export interface RefusalObservation { operation: string; role: string; code: string; field: string }
let enabled = false;
const sinkKey = Symbol.for("snapback4.proof.refusal");
const sink = () => (globalThis as Record<symbol, unknown>)[sinkKey] as ((event: RefusalObservation) => void) | undefined;
const events: RefusalObservation[] = [];
const observed = new WeakMap<object, RefusalObservation>();
const ambiguous = new WeakSet<object>();
export function refusalObservation(value: object): RefusalObservation | undefined { return ambiguous.has(value) ? undefined : observed.get(value); }
const roles = new Map<string, string>();
const label = (value: unknown, fallback: string) => typeof value === 'string' && /^[\w.:/ -]{1,180}$/.test(value) ? value : fallback;
export function enableProofObservation(): void { enabled = true; }
export function proofRole(token: string, role: string): void {
  if (roles.size >= 256) roles.delete(roles.keys().next().value!);
  roles.set(token, label(role, 'authenticated'));
}
export function proofRoleName(token?: string): string { return token ? roles.get(token) ?? 'authenticated (role unavailable)' : 'anonymous'; }
export function proofEvents(): readonly RefusalObservation[] { return events; }
export function observeRefusal(operation: string, role: string, value: unknown): void {
  if ((!enabled && !sink()) || !value || typeof value !== 'object') return;
  const why = value as {code?:unknown;site?:unknown};
  if (typeof why.code !== 'string' || !/^[A-Z][A-Z0-9_]{1,80}$/.test(why.code)) return;
  const event = { operation: label(operation, 'operation unavailable'), role: label(role, 'role unavailable'), code: why.code,
    field: label(why.site, 'field unavailable') };
  try { sink()?.(event); } catch {}
  const prior = observed.get(value);
  if (prior && (prior.operation !== event.operation || prior.role !== event.role || prior.field !== event.field)) ambiguous.add(value);
  observed.set(value, event);
  events.push(event);
  if (events.length > 32) events.shift();
}
export function observeProofReply(url: string, headers: HeadersInit | undefined, value: unknown): void {
  if (!enabled) return;
  let path: string; try { path = new URL(url).pathname; } catch { return; }
  const h = new Headers(headers);
  const token = h.get('authorization')?.replace(/^Bearer /, '');
  const role = h.get('x-snapback-persona') ?? (token ? roles.get(token) ?? 'authenticated (role unavailable)' : 'anonymous');
  if (!value || typeof value !== 'object') return;
  const v = value as {denied?:unknown;why?:unknown};
  observeRefusal(path.replace(/^\/[qma]\//, ''), role, v.denied ?? v.why);
}
export async function proofResponse(input: Parameters<typeof fetch>[0], init: RequestInit | undefined, response: Response): Promise<void> {
  if (!enabled) return;
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    if (!/^\/[qma]\//.test(path) && !path.startsWith('/assets')) return;
    const h = new Headers(init?.headers);
    const token = h.get('authorization')?.replace(/^Bearer /, '');
    const role = h.get('x-snapback-persona') ?? (token ? roles.get(token) ?? 'authenticated (role unavailable)' : 'anonymous');
    const operation = path.replace(/^\/[qma]\//, '');
    const json = response.json.bind(response);
    // Observe the caller's one decode, preserving the exact returned object.
    // No cloned streams, eager body reads, retained credentials or extra work.
    response.json = async () => {
      const value: unknown = await json();
      try {
        if (value && typeof value === 'object') {
          const v = value as {denied?:unknown;why?:unknown};
          observeRefusal(operation, role, v.denied ?? v.why);
        }
      } catch { /* Diagnostics cannot replace a result. */ }
      return value;
    };
  } catch { /* Frozen/custom response objects keep their original behavior. */ }
}
