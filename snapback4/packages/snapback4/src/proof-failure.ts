// @ref LLP 3000.037.000#13-wave-34-refusal-and-install-calls-calls1 — retain assertions and distinguish exact refusal identity from nearest context.
import { openSync, closeSync, readSync, fstatSync } from 'node:fs';
import { enableProofObservation, proofEvents, refusalObservation, type RefusalObservation } from './proof-observation.ts';
const servers = new Set<string>();
let closedServerEvent: string | undefined;
const reported = new WeakSet<object>();
export function proofServerLog(path: string): void { servers.add(path); }
export function forgetProofServerLog(path: string): void { closedServerEvent = lastServerEvent() ?? closedServerEvent; servers.delete(path); }
const fixes: Record<string, string> = {
  E_INPUT: 'match the named argument/field to its generated signature; snapback4 guide api generated',
  E_ASSET_UNKNOWN: 'await client.upload, check result.ok, then pass result.asset.id from this backend/user; snapback4 guide uploads',
  E_ASSET_TYPE: 'upload verified bytes accepted by the destination column; snapback4 guide uploads',
  E_AUTH: 'sign in to this backend and use that user session; snapback4 guide auth',
  E_ADMISSION: 'use createApp with a writable session store before browser mutations; snapback4 guide client',
  E_RULE: 'check this role and the named write rule against the intended operation; snapback4 guide rules',
};
function eventIn(error: unknown, seen = new Set<object>()): RefusalObservation | undefined {
  if (!error || typeof error !== "object" || seen.has(error)) return;
  seen.add(error);
  const found = refusalObservation(error); if (found) return found;
  const e = error as {actual?:unknown;why?:unknown;denied?:unknown;cause?:unknown};
  return eventIn(e.actual,seen) ?? eventIn(e.why,seen) ?? eventIn(e.denied,seen) ?? eventIn(e.cause,seen);
}
function refusalIn(error: unknown, seen = new Set<object>()): string | undefined {
  if (!error || typeof error !== 'object') return;
  if (seen.has(error)) return; seen.add(error);
  const e = error as {actual?:unknown;why?:unknown;denied?:unknown;code?:unknown;cause?:unknown};
  if (typeof e.code === 'string' && /^E_[A-Z0-9_]+$/.test(e.code)) return e.code;
  return refusalIn(e.actual, seen) ?? refusalIn(e.why, seen) ?? refusalIn(e.denied, seen) ?? refusalIn(e.cause, seen);
}
function lastServerEvent(): string | undefined {
  for (const path of [...servers].reverse()) {
    let fd: number | undefined;
    try {
      fd = openSync(path, 'r'); const size = fstatSync(fd).size;
      const buffer = Buffer.alloc(Math.min(size, 16384)); readSync(fd, buffer, 0, buffer.length, Math.max(0, size-buffer.length));
      const lines = buffer.toString().split('\n');
      for (const line of lines.reverse()) {
        const code = line.match(/\b(E_[A-Z0-9_]+)\b/)?.[1];
        if (code) return `nearest server event: ${code}; inspect private server log ${path}`;
        if (/\b(error|panic|failed)\b/i.test(line)) return `nearest server error: inspect private server log ${path}`;
      }
    } catch {} finally { if (fd !== undefined) closeSync(fd); }
  }
}
/** Content only: runners own the layout/budget. Expected refusal assertions
 * remain unchanged. An observed request is context, never proof of causality.
 * @throws None for native Error/AssertionError inputs; unavailable logs are ignored. */
export function proofFailure(error: unknown, observations: readonly RefusalObservation[] = proofEvents()): string {
  const code = refusalIn(error);
  const exact = eventIn(error);
  const event = exact ?? (code ? [...observations].reverse().find(event => event.code === code) : observations.at(-1));
  if (event) return `proof refusal${exact ? '' : ' (nearest observed request)'}: operation ${event.operation}; role ${event.role}; ${event.code}; field ${event.field}\nlikely fix: ${fixes[event.code] ?? 'inspect the named field and authored guard; snapback4 why ' + event.code}`;
  if (code) return `proof refusal: ${code}; operation/role/field unavailable\nlikely fix: ${fixes[code] ?? 'inspect the refusal and its authored guard; snapback4 why ' + code}`;
  return lastServerEvent() ?? closedServerEvent ?? 'proof failed: no backend refusal or server error observed; inspect the assertion below';
}
/** Print refusal content once, preserving the error. @throws Output stream write failures. */
export function reportProofFailure(error: unknown): void {
  if (error && typeof error === 'object') { if (reported.has(error)) return; reported.add(error); }
  console.error(proofFailure(error));
}
// Top-level starter assertions retain Node's class, exit status, stack and diff.
let installed = false;
export function installProofFailureReporting(): void {
  enableProofObservation();
  if (installed) return; installed = true;
  process.on('uncaughtExceptionMonitor', error => { reportProofFailure(error); });
}
