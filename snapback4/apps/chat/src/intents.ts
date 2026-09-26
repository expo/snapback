import type { Client } from "snapback4/contract";

export type Intent = { id: string; room: string; operation: "send" | "markRead"; body?: string };
type Saved = { route?: string; intents: Intent[] };

// @ref LLP 3000.011.003.000#2 — view references belong to one backend and principal; the SDK owns replay.
export class ViewState {
  active = true;
  readonly key: string;
  constructor(readonly client: Client, url: string, readonly principal: string) {
    this.key = `snapback4-chat:${JSON.stringify([url.replace(/\/$/, ""), principal])}`;
  }
  current() { return this.active && this.client.viewer() === this.principal && this.client.link() !== "signed-out"; }
  read(): Saved {
    const raw = localStorage.getItem(this.key);
    if (!raw) return { intents: [] };
    try {
      const value = JSON.parse(raw) as Saved;
      return {
        ...(typeof value.route === "string" ? { route: value.route } : {}),
        intents: Array.isArray(value.intents) ? value.intents.filter(i => typeof i.id === "string" && typeof i.room === "string" && (i.operation === "send" || i.operation === "markRead")).map(i => ({ ...i, body: typeof i.body === "string" ? i.body : undefined })) : [],
      };
    } catch { return { intents: [] }; }
  }
  update(change: (saved: Saved) => Saved) {
    if (!this.current()) throw Error("This account is no longer active.");
    localStorage.setItem(this.key, JSON.stringify(change(this.read())));
  }
  route(room: string) { this.update(saved => ({ ...saved, route: room })); }
  remember(intent: Intent) { this.update(saved => ({ ...saved, intents: [...saved.intents, intent] })); }
  forget(id: string) { this.update(saved => ({ ...saved, intents: saved.intents.filter(i => i.id !== id) })); }
}
