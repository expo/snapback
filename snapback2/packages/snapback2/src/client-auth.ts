import { isSnapbackRefusal, SnapbackRefusal, wireAuthSession, wireLogout, wireShape, throwIfAborted } from "./client-wire.js";
import type { AuthMe, AuthSession, AuthSnapshot, AuthTokenStore, ConnectionState, Principal, RefusalEnvelope } from "./types.js";

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
  private readonly observers = new Set<() => void>();

  constructor(
    private readonly publish: (auth: AuthSnapshot) => void,
    private readonly custody: () => { token?: string; principal?: Principal },
    private readonly retry: (current: () => boolean) => Promise<AuthMe>,
    private readonly online: () => boolean,
  ) {}

  set(value: AuthSnapshot): void {
    this.value = value;
    this.publish(value);
    for (const observe of this.observers) observe();
  }

  async settled(signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (this.value.state !== "hydrating") return;
    await new Promise<void>((resolve, reject) => {
      const changed = () => {
        if (!signal.aborted && this.value.state === "hydrating") return;
        this.observers.delete(changed);
        signal.removeEventListener("abort", changed);
        try { throwIfAborted(signal); resolve(); } catch (error) { reject(error); }
      };
      this.observers.add(changed);
      signal.addEventListener("abort", changed, { once: true });
      changed();
    });
  }

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

  // A session attempt fences operations before it can replace custody. Keep the
  // current view; a failed attempt must resume the bearer it did not replace.
  suspend(): AuthSnapshot {
    const value = this.value;
    this.stop();
    return value;
  }

  restore(value: AuthSnapshot): void {
    if (value.state === "hydrating" && this.custody().token) {
      this.failed(new SnapbackRefusal({ code: "E_NETWORK", family: "owner",
        message: "resume interrupted authentication restoration", guide: "auth/session" }, true));
    } else if (value.state === "refused" && value.refusal) {
      this.failed(new SnapbackRefusal(value.refusal));
    } else this.set(value);
  }

  private restoringViewer(): Principal | undefined {
    const { token, principal } = this.custody();
    return token ? this.value.viewer ?? this.value.restoringViewer ?? principal : undefined;
  }

  offline(): void {
    this.clearTimer();
    const { retryAt: _, ...value } = this.value;
    this.set(value);
    // Keep a pending response shared by its callers. Going offline is not a
    // custody change; the same request can still finish after reconnect.
  }

  async session(path: string, options: {
    request(): Promise<unknown>;
    install(session: AuthSession): Promise<void>;
    metadata(): Promise<void>;
    validated(): void;
  }): Promise<AuthSession> {
    const session = wireAuthSession(await options.request(), `${path.slice("/api/".length)} response`);
    await options.install(session);
    const { token: _, ...confirmed } = session;
    this.reset({ state: "authenticated", ...confirmed });
    options.validated();
    // Prepare offline writes as before, but an installed bearer is a successful
    // session even when metadata refuses. Its failure remains on lastRefusal.
    try { await options.metadata(); }
    catch (error) {
      if (this.custody().token !== session.token || this.value.state !== "authenticated") throw error;
    }
    return session;
  }

  async logout(options: {
    request(): Promise<unknown>;
    wipe(): Promise<void>;
    clear(): Promise<void>;
    validated(): void;
  }): Promise<{ ok: boolean }> {
    let result: { ok: boolean } | undefined;
    let requestFailure: unknown;
    try { result = wireLogout(await options.request()); }
    catch (error) { requestFailure = error; }
    let wipeFailure: unknown;
    try { await options.wipe(); } catch (error) { wipeFailure = error; }
    await options.clear();
    this.reset({ state: "anonymous" });
    if (requestFailure !== undefined) throw requestFailure;
    if (wipeFailure !== undefined) throw wipeFailure;
    options.validated();
    return result!;
  }

  async initializeOffline(options: {
    signal: AbortSignal;
    confirm(): Promise<unknown>;
    hasPrincipal(): boolean;
    metadata(): Promise<void>;
    resume(): Promise<void>;
    cut(): boolean;
  }): Promise<void> {
    let cut!: () => void;
    const interrupted = new Promise<void>(resolve => {
      cut = resolve;
      options.signal.addEventListener("abort", cut, { once: true });
      if (options.signal.aborted) cut();
    });
    const initialize = async () => {
      if (this.custody().token) {
        try { await options.confirm(); }
        catch { return; } // confirm owns restoration failures and their retries.
      }
      if (options.signal.aborted || !options.hasPrincipal()) return;
      try { await options.metadata(); await options.resume(); }
      catch (error) {
        if (!options.cut() && !(isSnapbackRefusal(error)
          && (error.retryable || error.code === "E_OFFLINE_RESUME" || error.code === "E_OFFLINE_RESET"))) throw error;
      }
    };
    // A cut releases ready at every startup stage, including a transport that
    // ignores abort. The interrupted work still carries its signal and authority.
    try { await Promise.race([initialize(), interrupted]); }
    finally { options.signal.removeEventListener("abort", cut); }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  failed(error: unknown, restoringViewer = this.restoringViewer()): void {
    this.clearTimer();
    const refusal = isSnapbackRefusal(error) ? error : wireShape(error instanceof Error ? error.message : String(error));
    const transport = refusal.retryable && ["E_NETWORK", "E_TRANSPORT"].includes(refusal.code);
    this.reconnect = !anonymousAuth(refusal)
      && !["E_AUTH_TOKEN_STORE", "E_WIRE_SHAPE", "E_AUTH_SUPERSEDED", "E_CLIENT_CLOSED"].includes(refusal.code)
      && refusal.envelope.family !== "offline";
    if (transport && this.custody().token !== undefined) {
      const delay = this.backoff;
      this.backoff = Math.min(30_000, delay * 2);
      if (!this.online()) { this.set({ state: "hydrating", restoringViewer }); return; }
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
    const restoringViewer = this.restoringViewer();
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

export async function saveAuthToken(store: AuthTokenStore | undefined, token: string,
  failure: (action: string, error: unknown) => Error,
): Promise<void> {
  if (!store) return;
  try {
    // Clear the binding before replacing its token; a crash cannot pair a
    // successor bearer with the predecessor's history.
    if (store.loadPrincipalBinding && !store.savePrincipal) {
      throw new TypeError("tokenStore.loadPrincipalBinding requires savePrincipal for safe token replacement");
    }
    await store.savePrincipal?.(null);
    await store.save(token);
  } catch (error) { throw failure("save", error); }
}

export function storageRefusal(host: { recordRefusal(envelope: RefusalEnvelope): void }, action: string, error: unknown): SnapbackRefusal {
  const refusal = new SnapbackRefusal({
    code: "E_AUTH_TOKEN_STORE",
    family: "auth",
    message: `token store ${action} failed: ${error instanceof Error ? error.message : String(error)}`,
    guide: "auth/session",
  });
  host.recordRefusal(refusal.envelope);
  return refusal;
}

export function ensureBearerTransition(host: { persona?: string; recordRefusal(envelope: RefusalEnvelope): void }, action: string): void {
  if (host.persona === undefined) return;
  const refusal = new SnapbackRefusal({
    code: "E_AUTH_PERSONA_TRANSITION",
    family: "auth",
    message: `dev persona clients cannot ${action} a bearer session`,
    guide: "auth/personas",
  });
  host.recordRefusal(refusal.envelope);
  throw refusal;
}
