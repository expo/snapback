// @ref LLP 3000.037.000#8-wave-32-builder-reading-and-waiting-tok1 — bounded idle foreground waits, explicit unattended hold.
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
export const probeAdvice = 'stays up until SIGTERM; verify with npm run probe:check';
interface Receipt { pid: number; started: number; lastSeen: number; requests: number; ended?: number }
export interface ProbeGuard { ready(): void; idle(): boolean; close(): void }
let active: ProbeGuard | undefined;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } };
/** Call before deploying. --hold / SNAPBACK4_PROBE_HOLD=1 preserves indefinite harness service.
 * With no hold, the first ready run with zero requests returns after 60 seconds.
 * A previously killed >60s empty run refuses before deployment.
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
  if (!hold && previous && !alive(previous.pid) && previous.requests === 0 && (previous.ended ?? previous.lastSeen) - previous.started > 60_000) {
    throw Error(`E_PROBE_IDLE: previous run exceeded 60s without requests; ${probeAdvice}. Deliberate service: npm run probe:serve -- --hold (or SNAPBACK4_PROBE_HOLD=1)`);
  }
  const activity = join(directory, `probe-${randomUUID()}.activity`), oldActivity = process.env.SNAPBACK4_PROBE_ACTIVITY;
  process.env.SNAPBACK4_PROBE_ACTIVITY = activity;
  const receipt: Receipt = { pid: process.pid, started: Date.now(), lastSeen: Date.now(), requests: 0 };
  let baseline = 0, readyAt: number | undefined, closed = false;
  const count = () => { try { const n = Number(readFileSync(activity,'utf8')); return Number.isSafeInteger(n) && n >= 0 ? n : 0; } catch { return 0; } };
  const save = () => { receipt.lastSeen = Date.now(); receipt.requests = Math.max(0, count() - baseline); writeFileSync(path, JSON.stringify(receipt) + '\n', { mode: 0o600 }); };
  save();
  const timer = setInterval(save, 1000); timer.unref();
  const guard = {
    ready() { baseline = count(); readyAt = Date.now(); receipt.started = readyAt; save(); },
    idle() { return !hold && readyAt !== undefined && Date.now() - readyAt >= 60_000 && count() === baseline; },
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
