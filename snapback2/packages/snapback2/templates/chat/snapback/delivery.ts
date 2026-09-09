// The grant names your notification provider; replace this example origin.
// The provider must honor meta.id as the idempotency key to make retries safe.
import { effect } from "snapback2";
import { recordNotified } from "./notifications";

export const notify = effect({
  grants: ["https://api.example.com"],
  run: async (payload: { to: string; body: string }, { fetch, meta }) => {
    const request = {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": meta.id },
      body: JSON.stringify(payload),
    };
    const response = await fetch("https://api.example.com/send", request);
    if (!response.ok) throw new Error(`provider ${response.status}`);
    return { providerId: (await response.json()).id as string };
  },
  then: recordNotified,
});
