// Shared probe machinery for LLP 0086 CC-3.3 (preregistered protocol).
import { readFileSync, writeFileSync } from 'fs';

// ---- env (ephemeral app credentials) ----
for (const line of readFileSync(new URL('./.env.ephemeral', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
export const APP_ID = process.env.INSTANT_APP_ID;
const TOKEN = process.env.INSTANT_APP_ADMIN_TOKEN;
export const USER_EMAIL = 'probe-user@example.com';
export const OTHER_EMAIL = 'other@example.com';

export const redact = (s) => String(s).replaceAll(TOKEN, '<ADMIN_TOKEN>');

// ---- browser shims for @instantdb/core in Node ----
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
{
  let ok = false;
  try {
    globalThis.window.localStorage?.getItem?.('x');
    ok = typeof globalThis.window.localStorage?.getItem === 'function';
  } catch {}
  if (!ok) {
    const ls = new Map();
    Object.defineProperty(globalThis.window, 'localStorage', {
      value: {
        getItem: (k) => (ls.has(k) ? ls.get(k) : null),
        setItem: (k, v) => ls.set(k, String(v)),
        removeItem: (k) => ls.delete(k),
        clear: () => ls.clear(),
      },
      configurable: true,
    });
  }
}

const core = await import('@instantdb/core');
const adminSdk = await import('@instantdb/admin');

export class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  async getItem(k) {
    return this.map.has(k) ? this.map.get(k) : undefined;
  }
  async removeItem(k) {
    this.map.delete(k);
  }
  async multiSet(pairs) {
    for (const [k, v] of pairs) this.map.set(k, v);
  }
  async getAllKeys() {
    return [...this.map.keys()];
  }
}
const AlwaysOnline = {
  getIsOnline: async () => true,
  listen: () => () => {},
};

export const id = core.id;

export function makeCoreClient() {
  return core.init({ appId: APP_ID }, MemoryStorage, AlwaysOnline);
}

export function makeAdmin() {
  return adminSdk.init({ appId: APP_ID, adminToken: TOKEN });
}
export const adminTx = adminSdk.tx;
export const adminId = adminSdk.id;

// ---- receipts log ----
export function makeLog() {
  const events = [];
  const log = (type, detail) => {
    const e = { ts: new Date().toISOString(), t_ms: Date.now(), type, ...detail };
    events.push(e);
    console.log(e.ts, type, redact(JSON.stringify(detail ?? {})));
    return e;
  };
  return { events, log };
}

export function writeReceipts(file, obj) {
  writeFileSync(
    new URL(`./${file}`, import.meta.url),
    redact(JSON.stringify(obj, null, 2)) + '\n',
  );
  console.log('receipts written:', file);
}

// ---- perms push (programmatic, authed by app admin token) ----
export async function pushPerms(perms, log) {
  const t0 = Date.now();
  const r = await fetch(`https://api.instantdb.com/superadmin/apps/${APP_ID}/perms`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: perms }),
  });
  const body = await r.json().catch(() => null);
  const e = log('perms-push-ack', {
    status: r.status,
    perms,
    response: body,
    roundtrip_ms: Date.now() - t0,
  });
  if (r.status !== 200) throw new Error('perms push failed: ' + r.status);
  return e;
}

export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ---- observation loop ----
// Watches subscription state after a revocation ack; checkpoints at 5/15/30/60/120s.
// state: { latestIds: Set|null, callbacksAfterAck: [], reconnectAfterAck: bool }
export async function observeWindow({ state, targetId, ackMs, log, T = 120000 }) {
  const checkpoints = [5000, 15000, 30000, 60000, 120000];
  let verdict = null;
  for (const cp of checkpoints) {
    const wait = ackMs + cp - Date.now();
    if (wait > 0) await sleep(wait);
    const present = state.latestIds ? state.latestIds.has(targetId) : null;
    log('checkpoint', {
      at_s: cp / 1000,
      row_present_in_latest_callback: present,
      callbacks_since_ack: state.callbacksAfterAck.length,
      reconnect_since_ack: state.reconnectAfterAck,
    });
    // Evicted the moment a post-ack callback lacks the row id (no reconnect).
    if (!verdict) {
      const evictedCb = state.callbacksAfterAck.find((c) => !c.ids.includes(targetId));
      if (evictedCb && !state.reconnectAfterAck) {
        verdict = {
          verdict: 'evicted',
          eviction_latency_ms: evictedCb.t_ms - ackMs,
          eviction_callback_ts: evictedCb.ts,
        };
        log('verdict-preliminary', verdict);
        // keep observing to the full window for completeness
      }
    }
  }
  if (!verdict) {
    const present = state.latestIds ? state.latestIds.has(targetId) : null;
    verdict = {
      verdict: present ? 'not-evicted-live' : 'indeterminate-no-data',
      row_present_at_T: present,
      reconnect_since_ack: state.reconnectAfterAck,
    };
  }
  log('verdict-final', verdict);
  return verdict;
}
