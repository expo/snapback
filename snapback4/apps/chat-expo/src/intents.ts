import type { Write } from "snapback4/contract";

export interface IntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface Credentials {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
/** SDK online custody also contains message arguments. Preserve a legacy
 * journal before removing its old size-limited SecureStore value. */
export function withIntentStorage(credentials: Credentials, storage: IntentStorage): Credentials {
  const isIntent = (key: string) => key.endsWith(".writes") || key.includes(".writes.damaged.");
  return {
    async get(key) {
      if (!isIntent(key)) return credentials.get(key);
      const kept = storage.getItem(key);
      if (kept !== null) return kept;
      const legacy = await credentials.get(key);
      if (legacy !== null) { storage.setItem(key, legacy); await credentials.delete(key); }
      return legacy;
    },
    async set(key, value) {
      if (isIntent(key)) storage.setItem(key, value);
      else await credentials.set(key, value);
    },
    async delete(key) {
      if (isIntent(key)) storage.removeItem(key);
      await credentials.delete(key);
    },
  };
}

export type Intent = { id: string; room: string; op: "send"; body: string };

// @ref LLP 3000.008.002.000#3-submit-once-then-let-the-user-continue — these are UI references, never an outbox or a resend loop.
export class IntentJournal {
  readonly key: string;
  constructor(private storage: IntentStorage, url: string, principal: string, private current: () => boolean) {
    this.key = `snapback4-chat:${JSON.stringify([url.replace(/\/$/, ""), principal])}`;
  }
  read(): Intent[] {
    if (!this.current()) return [];
    const raw = this.storage.getItem(this.key);
    if (!raw) return [];
    const saved = JSON.parse(raw) as { intents?: Intent[] };
    return Array.isArray(saved.intents) ? saved.intents.filter(i => typeof i.id === "string" && typeof i.room === "string" && i.op === "send" && typeof i.body === "string") : [];
  }
  remember(intent: Intent) { this.save([...this.read(), intent]); }
  forget(id: string) { this.save(this.read().filter(i => i.id !== id)); }
  private save(intents: Intent[]) {
    if (!this.current()) throw Error("This account is no longer active.");
    this.storage.setItem(this.key, JSON.stringify({ intents }));
  }
}

export function intentOutcome(write: Write | undefined): string {
  if (!write) return "Outcome unknown — check the conversation before sending again";
  if (write.state === "pending") return `Queued on this device${write.reason ? `: ${write.reason}` : ""}`;
  return write.state === "failed" ? write.why.message : "Sent";
}
