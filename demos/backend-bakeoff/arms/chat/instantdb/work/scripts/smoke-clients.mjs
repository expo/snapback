import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { onLine: true },
});
globalThis.location = { href: 'https://llp0102.invalid/' };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const { init, StoreInterface } = await import('@instantdb/core');

class MemoryStore extends StoreInterface {
  constructor(appId, storeName) {
    super(appId, storeName);
    this.values = new Map();
  }
  async getItem(key) {
    return this.values.get(key) ?? null;
  }
  async setItem(key, value) {
    this.values.set(key, value);
  }
  async multiSet(pairs) {
    for (const [key, value] of pairs) this.values.set(key, value);
  }
  async removeItem(key) {
    this.values.delete(key);
  }
  async getAllKeys() {
    return [...this.values.keys()];
  }
}

class AlwaysOnline {
  static async getIsOnline() {
    return true;
  }
  static listen() {
    return () => {};
  }
}

const target = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../.arm-runtime/target.json')),
);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const clients = [];
for (const actor of ['alice', 'bob', 'mallory']) {
  const config = {
    appId: target.appId,
    devtool: false,
    __extraDedupeKey: `llp0102-${actor}-${Date.now()}`,
  };
  const db = init(config, MemoryStore, AlwaysOnline);
  await new Promise((resolveReady) => {
    const unsubscribe = db.subscribeAuth(() => {
      unsubscribe();
      resolveReady();
    });
  });
  const auth = await db.auth.signInAsGuest();
  clients.push({ actor, db, actorIdSha256: sha(auth.user.id) });
}
process.stdout.write(
  JSON.stringify({
    ok: true,
    actors: clients.map(({ actor, actorIdSha256 }) => ({
      actor,
      actorIdSha256,
    })),
  }) + '\n',
);
for (const { db } of clients) db.shutdown();
