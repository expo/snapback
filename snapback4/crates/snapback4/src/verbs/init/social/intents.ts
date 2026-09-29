import type { ArgsOf, Write } from "snapback4/contract";

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

export type Intent = { id: string; args: ArgsOf<typeof import("../snapback/generated/api").api.send> };
export type Proposal = { proposed: string; other: string; canonical?: string };

// @ref LLP 3000.008.002.000#3-submit-once-then-let-the-user-continue — these are UI references, never an outbox or a resend loop.
export class IntentJournal {
  readonly key: string;
  constructor(private storage: IntentStorage, url: string, principal: string, private current: () => boolean) {
    this.key = `snapback4-social:${JSON.stringify([url.replace(/\/$/, ""), principal])}`;
  }
  read(): Intent[] {
    if (!this.current()) return [];
    const raw = this.storage.getItem(this.key);
    if (!raw) return [];
    const saved = JSON.parse(raw) as { intents?: Intent[] };
    return Array.isArray(saved.intents) ? saved.intents.filter(i => typeof i.id === "string" && i.args && typeof i.args.conversation === "string" && typeof i.args.text === "string" && (i.args.photo === null || typeof i.args.photo?.id === "string")) : [];
  }
  remember(intent: Intent) { this.save([...this.read(), intent]); }
  forget(id: string) { this.save(this.read().filter(i => i.id !== id)); }
  // @ref LLP 3000.028#8 — durable route associations, never rewritten send arguments.
  proposals(): Proposal[] {
    if (!this.current()) return [];
    const saved = JSON.parse(this.storage.getItem(this.key) ?? "{}") as { proposals?: Proposal[] };
    return Array.isArray(saved.proposals) ? saved.proposals.filter(p => typeof p.proposed === "string" &&
      typeof p.other === "string" && (p.canonical === undefined || typeof p.canonical === "string")) : [];
  }
  propose(proposed: string, other: string) {
    this.save(this.read(), [...this.proposals().filter(p => p.proposed !== proposed), { proposed, other }]);
  }
  resolve(other: string, canonical: string) {
    this.save(this.read(), this.proposals().map(p => p.other === other ? { ...p, canonical } : p));
  }
  private save(intents: Intent[], proposals = this.proposals()) {
    if (!this.current()) throw Error("This account is no longer active.");
    this.storage.setItem(this.key, JSON.stringify({ intents, proposals }));
  }
}

export function intentOutcome(write: Write | undefined): string {
  if (!write) return "Outcome unknown — check the conversation before sending again";
  if (write.state === "pending") return `Queued on this device${write.reason ? `: ${write.reason}` : ""}`;
  return write.state === "failed" ? `Not sent: ${write.why.message}` : "Sent";
}
