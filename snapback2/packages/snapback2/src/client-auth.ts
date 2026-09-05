import { isSnapbackRefusal, SnapbackRefusal, wireShape } from "./client-wire.js";
import type { AuthMe, AuthSnapshot, AuthTokenStore, ConnectionState, Principal } from "./types.js";

export function anonymousAuth(error: unknown): boolean {
  return isSnapbackRefusal(error)
    && ["E_AUTH", "E_AUTH_REQUIRED", "E_AUTH_SESSION"].includes(error.code);
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test —
// one restoration flight and retry clock per client; retained identity is display-only.
export class ClientAuth {
  value: AuthSnapshot = { state: "hydrating" };
  private flight?: Promise<AuthMe>;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private backoff = 1_000;
  private reconnect = false;
  private epoch = 0;

  constructor(
    private readonly publish: (auth: AuthSnapshot) => void,
    private readonly hasToken: () => boolean,
    private readonly retry: (current: () => boolean) => Promise<AuthMe>,
  ) {}

  private set(value: AuthSnapshot): void { this.value = value; this.publish(value); }

  reset(value: AuthSnapshot): void {
    this.cancel();
    this.set(value);
  }

  cancel(): void {
    this.epoch++;
    this.controller?.abort();
    this.controller = undefined;
    this.flight = undefined;
    this.clearTimer();
    this.reconnect = false;
    this.backoff = 1_000;
  }

  stop(): void {
    this.cancel();
    const { retryAt: _, ...value } = this.value;
    this.set(value);
  }

  offline(): void {
    if (!this.flight) return;
    const viewer = this.value.restoringViewer;
    this.cancel();
    this.failed(new SnapbackRefusal({ code: "E_NETWORK", family: "owner",
      message: "client transport is offline", guide: "owner/connect" }, true), viewer);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  failed(error: unknown, restoringViewer?: Principal): void {
    this.clearTimer();
    const refusal = isSnapbackRefusal(error) ? error : wireShape(error instanceof Error ? error.message : String(error));
    const transport = refusal.retryable && ["E_NETWORK", "E_TRANSPORT"].includes(refusal.code);
    this.reconnect = !anonymousAuth(refusal)
      && !["E_AUTH_TOKEN_STORE", "E_WIRE_SHAPE", "E_AUTH_SUPERSEDED", "E_CLIENT_CLOSED"].includes(refusal.code)
      && refusal.envelope.family !== "offline";
    if (transport && this.hasToken()) {
      const delay = this.backoff;
      this.backoff = Math.min(30_000, delay * 2);
      this.timer = setTimeout(() => this.retryNow(), delay);
      // A headless process can exit while disconnected; close still clears the timer.
      (this.timer as unknown as { unref?: () => void }).unref?.();
      this.set({ state: "hydrating", restoringViewer, retryAt: Date.now() + delay });
    } else {
      this.set(anonymousAuth(refusal) ? { state: "anonymous" } : { state: "refused", refusal: refusal.envelope });
    }
  }

  connectionChanged(before: ConnectionState, after: ConnectionState): void {
    if (before !== after && after !== "offline" && this.reconnect && !this.flight) this.retryNow();
  }

  private retryNow(): void {
    this.clearTimer();
    this.reconnect = false;
    const epoch = this.epoch;
    void this.retry(() => epoch === this.epoch).catch(() => undefined);
  }

  confirm(read: (signal: AbortSignal) => Promise<AuthMe>): Promise<AuthMe> {
    if (this.flight) return this.flight;
    this.clearTimer();
    this.reconnect = false;
    const epoch = this.epoch;
    const controller = new AbortController();
    this.controller = controller;
    const restoringViewer = this.hasToken()
      ? this.value.viewer ?? this.value.restoringViewer : undefined;
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new SnapbackRefusal({ code: "E_AUTH_SUPERSEDED", family: "auth",
        message: "authentication restoration was superseded", guide: "auth/session" }));
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    const run = Promise.race([Promise.resolve().then(() => read(controller.signal)), cancelled]).then(value => {
      if (epoch !== this.epoch) throw new SnapbackRefusal({ code: "E_AUTH_SUPERSEDED", family: "auth",
        message: "authentication restoration was superseded", guide: "auth/session" });
      if (epoch === this.epoch) {
        this.backoff = 1_000;
        this.set({ state: "authenticated", ...value });
      }
      return value;
    }, error => {
      if (epoch === this.epoch) this.failed(error, restoringViewer);
      throw error;
    }).finally(() => {
      controller.signal.removeEventListener("abort", abort);
      if (this.flight === run) { this.flight = undefined; this.controller = undefined; }
    });
    this.flight = run;
    this.set({ state: "hydrating", restoringViewer });
    return run;
  }
}

export async function restoreAuthToken(explicitToken: string | undefined, store: AuthTokenStore | undefined,
  save: (token: string) => Promise<void>, failure: (action: string, error: unknown) => Error,
): Promise<{ token?: string; principal?: string | null }> {
  let token = explicitToken;
  let principal: string | null | undefined;
  if (store) {
    try {
      const storedToken = token ?? await store.load();
      const binding = await store.loadPrincipalBinding?.();
      token = storedToken ?? undefined;
      // A companion record names the bearer that authenticated its principal;
      // mixed snapshots and obsolete writers cannot assign another identity.
      principal = binding && binding.token === token ? binding.principal : undefined;
    } catch (error) {
      throw failure("load", error);
    }
  }
  if (token !== undefined && (typeof token !== "string" || token.length === 0)) {
    throw failure("load", new TypeError("stored token must be a non-empty string or null"));
  }
  if (explicitToken !== undefined) {
    await save(token!);
    // The same bearer may reuse its authenticated binding while offline.
    if (principal) {
      try { await store?.savePrincipal?.(principal, token); }
      catch (error) { throw failure("save principal", error); }
    }
  }
  return { token, principal };
}
