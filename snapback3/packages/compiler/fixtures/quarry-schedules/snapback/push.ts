import { effect } from "snapback3";

export const digest = effect({
  grants: ["https://push.example.com"],
  run: async (payload: { to: string; newFollowers: number; unreadMessages: number }, { fetch, meta }) => {
    const response = await fetch("https://push.example.com/digest", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": meta.id },
      body: JSON.stringify(payload),
    });
    return { delivered: response.ok };
  },
});

export const notify = effect({
  grants: ["https://push.example.com"],
  run: async (payload: { to: string; body: string }, { fetch, meta }) => {
    const response = await fetch("https://push.example.com/message", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": meta.id },
      body: JSON.stringify(payload),
    });
    return { delivered: response.ok };
  },
});
