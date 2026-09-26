import { pendingChanges } from "./pending-writes.ts";

// @ref LLP 3000.019#3.3 — one journal has one list, including observers in
// other clients and tabs. Messages invalidate; intent stays in its own store.
const journals = new Map<string, {
  events: ReturnType<typeof pendingChanges>;
  channel: BroadcastChannel | undefined;
  users: number;
}>();

export function journalChanges(key: string, notify: () => void) {
  let shared = journals.get(key);
  if (!shared) {
    const events = pendingChanges();
    const channel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(key) : undefined;
    if (channel) channel.onmessage = () => events.notify();
    shared = { events, channel, users: 0 };
    journals.set(key, shared);
  }
  shared.users++;
  const entry = shared, unsubscribe = entry.events.subscribe(notify);
  let active = true;
  return {
    notify() {
      // A paused owner may still finish a custody commit for active siblings.
      const current = journals.get(key);
      // Broadcast before a local listener can close the last owner/channel.
      // Notification failures cannot reject the already committed transaction.
      try {
        if (current?.channel) current.channel.postMessage(null);
        else if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
          const channel = new BroadcastChannel(key);
          try { channel.postMessage(null); } finally { channel.close(); }
        }
      } catch { /* Best effort invalidation; custody is already durable. */ }
      try { current?.events.notify(); } catch { /* A listener cannot undo custody. */ }
    },
    close() {
      if (!active) return;
      active = false; unsubscribe();
      if (--entry.users === 0) { entry.channel?.close(); journals.delete(key); }
    },
  };
}
