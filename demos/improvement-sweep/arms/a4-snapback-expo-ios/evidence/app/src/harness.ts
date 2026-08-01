// On-device half of the loopback witness-collector/director pattern the
// Expo guide page describes for acceptance runs. The app posts witness
// events (app lifecycle, query-state transitions) and executes director
// commands (sign-in steps, mutations, custody transitions) so every
// product fact is observable from the host without an on-device debugger.
// Test infrastructure only — never a production endpoint design.
import { DIRECTOR_URL } from './config';

export type ErrorFacts = {
  message: string;
  code: string | null;
  name: string | null;
};

export function errorFacts(error: unknown): ErrorFacts {
  const err = error as { message?: unknown; name?: unknown; code?: unknown; diagnostic?: { code?: unknown } } | null;
  return {
    message: String(err?.message ?? error),
    code: (err?.diagnostic?.code as string | undefined) ?? (err?.code as string | undefined) ?? null,
    name: (err?.name as string | undefined) ?? null,
  };
}

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

const jsonHeaders = { 'content-type': 'application/json' };

export class Harness {
  private handlers = new Map<string, Handler>();
  private stopped = false;
  readonly state: Record<string, unknown> = {};

  post(type: string, payload: Record<string, unknown> = {}): void {
    fetch(`${DIRECTOR_URL}/event`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ at: Date.now(), type, ...payload }),
    }).catch(() => {});
  }

  report(name: string, snapshot: unknown): void {
    this.state[name] = snapshot;
    this.post('state', { name, snapshot });
  }

  on(op: string, handler: Handler): void {
    this.handlers.set(op, handler);
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      try {
        const res = await fetch(`${DIRECTOR_URL}/cmd`);
        if (res.status !== 200) {
          await sleep(250);
          continue;
        }
        const cmd = (await res.json()) as { id: number; op: string; args?: Record<string, unknown> };
        let result: Record<string, unknown>;
        try {
          const handler = this.handlers.get(cmd.op);
          if (!handler) throw new Error(`unknown op ${cmd.op}`);
          result = { id: cmd.id, ok: true, value: await handler(cmd.args ?? {}) };
        } catch (error) {
          result = { id: cmd.id, ok: false, error: errorFacts(error) };
        }
        await fetch(`${DIRECTOR_URL}/result`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(result),
        });
      } catch {
        // director briefly unreachable: retry quietly
        await sleep(500);
      }
    }
  }

  stop(): void {
    this.stopped = true;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const harness = new Harness();
