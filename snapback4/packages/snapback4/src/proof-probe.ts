// @ref LLP 3000.037.000#8-wave-32-builder-reading-and-waiting-tok1 — bounded idle foreground waits, explicit unattended hold.
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
export const probeAdvice = 'stays up until SIGTERM; verify with npm run probe:check';
interface Receipt { pid: number; started: number; lastSeen: number; requests: number; ended?: number; ready?: boolean; hold?: boolean }
export interface ProbeGuard { ready(): void; idle(): boolean; close(): void }
let active: ProbeGuard | undefined;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } };
/** Call before deploying. --hold / SNAPBACK4_PROBE_HOLD=1 preserves indefinite harness service.
 * With no hold, the first ready run with zero requests returns after 10 seconds.
 * A previously killed >=10s empty run refuses before deployment.
 * @throws E_PROBE_IDLE for a previous empty long run without explicit hold; filesystem errors when progress cannot be recorded. */
export function probeServeGuard(options: { directory?: string; hold?: boolean } = {}): ProbeGuard {
  console.error(probeAdvice);
  if (active) return active;
  const directory = resolve(options.directory ?? process.cwd(), '.snapback4');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'probe-run.json');
  const hold = options.hold ?? (process.argv.includes('--hold') || process.env.SNAPBACK4_PROBE_HOLD === '1');
  let previous: Receipt | undefined;
  try { previous = JSON.parse(readFileSync(path, 'utf8')) as Receipt; } catch {}
  // Legacy receipts lack readiness/hold facts; keep their former >60s rule
  // rather than classifying an old 10–60s failed startup as newly idle.
  const elapsed = previous ? (previous.ended ?? previous.lastSeen) - previous.started : 0;
  const wasIdle = previous?.ready === true ? elapsed >= 10_000 : previous?.ready === undefined && elapsed > 60_000;
  if (!hold && previous && wasIdle && previous.hold !== true && !alive(previous.pid) && previous.requests === 0) {
    throw Error(`E_PROBE_IDLE: previous run reached 10s without requests; ${probeAdvice}. Deliberate service: npm run probe:serve -- --hold (or SNAPBACK4_PROBE_HOLD=1)`);
  }
  const activity = join(directory, `probe-${randomUUID()}.activity`), oldActivity = process.env.SNAPBACK4_PROBE_ACTIVITY;
  process.env.SNAPBACK4_PROBE_ACTIVITY = activity;
  const receipt: Receipt = { pid: process.pid, started: Date.now(), lastSeen: Date.now(), requests: 0, ready: false, hold };
  let baseline = 0, readyAt: number | undefined, closed = false;
  const count = () => { try { const n = Number(readFileSync(activity,'utf8')); return Number.isSafeInteger(n) && n >= 0 ? n : 0; } catch { return 0; } };
  const save = () => { receipt.lastSeen = Date.now(); receipt.requests = Math.max(0, count() - baseline); writeFileSync(path, JSON.stringify(receipt) + '\n', { mode: 0o600 }); };
  save();
  const timer = setInterval(save, 1000); timer.unref();
  const guard = {
    ready() { baseline = count(); readyAt = Date.now(); receipt.started = readyAt; receipt.ready = true; save(); },
    idle() { return !hold && readyAt !== undefined && Date.now() - readyAt >= 10_000 && count() === baseline; },
    close() {
      if (closed) return; closed = true; clearInterval(timer); receipt.ended = Date.now(); save();
      if (existsSync(activity)) unlinkSync(activity);
      if (oldActivity === undefined) delete process.env.SNAPBACK4_PROBE_ACTIVITY; else process.env.SNAPBACK4_PROBE_ACTIVITY = oldActivity;
      active = undefined;
    },
  };
  active = guard; return guard;
}
export function currentProbeGuard() { return active; }
