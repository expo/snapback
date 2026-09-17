import { Retry } from "snapback4/worker";

export const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const RESPONSE_BYTES = 64 * 1024;

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

function observeCancellation(cancel: () => Promise<unknown> | unknown): void {
  try { void Promise.resolve(cancel()).catch(() => {}); } catch {}
}

function cancelBody(response: Response): void {
  if (response.body) observeCancellation(() => response.body!.cancel());
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) return JSON.parse("");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await untilAborted(() => reader.read(), signal);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || next.value.byteLength > RESPONSE_BYTES - bytes) {
        return retry();
      }
      bytes += next.value.byteLength;
      chunks.push(next.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch (error) {
    observeCancellation(() => reader.cancel());
    if (signal.aborted) throw signal.reason;
    void error;
    return retry();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
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

  if (response.status === 409) {
    cancelBody(response);
    throw new ResendUnresolved();
  }
  if (response.status >= 400 && response.status < 500
    && ![408, 425, 429].includes(response.status)) {
    cancelBody(response);
    return { kind: "rejected" };
  }
  if (!response.ok) {
    cancelBody(response);
    return retry();
  }

  let value: unknown;
  try {
    value = await boundedJson(response, input.signal);
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
