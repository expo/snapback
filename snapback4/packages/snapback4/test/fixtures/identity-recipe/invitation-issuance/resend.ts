import { Retry } from "snapback4/worker";

export const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

export class ResendUnresolved extends Error {
  constructor() {
    super("the provider did not establish a safe invitation-delivery outcome");
    this.name = "ResendUnresolved";
  }
}

export type ResendResult =
  | { readonly kind: "accepted"; readonly providerMessageId: string }
  | { readonly kind: "rejected" };

async function untilAborted<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        if (signal.aborted) throw signal.reason;
        return work();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function retry(): never {
  throw new Retry("the invitation provider outcome is uncertain");
}

/** A deliberately small Resend adapter. The endpoint is not configurable. */
export async function sendResendEmail(input: {
  readonly apiKey: string;
  readonly idempotencyKey: string;
  readonly body: string;
  readonly signal: AbortSignal;
  readonly fetch?: typeof fetch;
}): Promise<ResendResult> {
  let response: Response;
  try {
    const transport = input.fetch ?? globalThis.fetch.bind(globalThis);
    response = await untilAborted(() => transport(RESEND_EMAIL_ENDPOINT, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: input.body,
      signal: input.signal,
    }), input.signal);
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason;
    void error;
    return retry();
  }

  if (response.status === 409) throw new ResendUnresolved();
  if (response.status >= 400 && response.status < 500
    && ![408, 425, 429].includes(response.status)) {
    try { void response.body?.cancel(); } catch {}
    return { kind: "rejected" };
  }
  if (!response.ok) {
    try { void response.body?.cancel(); } catch {}
    return retry();
  }

  let value: unknown;
  try {
    const text = await untilAborted(() => response.text(), input.signal);
    value = JSON.parse(text);
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason;
    void error;
    return retry();
  }
  const id = value && typeof value === "object" && Object.hasOwn(value, "id")
    ? (value as { readonly id?: unknown }).id
    : undefined;
  if (typeof id !== "string" || id.length < 1 || id.length > 100) return retry();
  return { kind: "accepted", providerMessageId: id };
}
