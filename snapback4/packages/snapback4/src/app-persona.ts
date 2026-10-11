// `createApp({ url, persona })`: a development persona behind the App shape,
// so a React/Expo dev UI can keep `AppProvider`, `useAuth` and `app.mutate`
// while acting as `dev:<persona>` (a `?as=bob` picker). It has no session: no
// sign-in, rotation, session custody or epochs, so none of createApp's session
// machinery is involved. Writes keep the tier's own custody: with a device,
// the device outbox (and the web journal in a browser); without one, the online
// client, which refuses browser writes exactly as a bare createClient does.
// @ref LLP 3000.013#6.1 — loopback is checked here for a clear refusal; dev's
// socket/Host/Origin check and serve's refusal of the header remain the boundary.
import type { App, AppOptions, AppResult, AuthSnapshot, AppAuth } from "./app.ts";
import { onlineView, type Online } from "./app-online-arm.ts";
import { createClient, mintId } from "./client.ts";
import { defaultFetch } from "#fetch";
import { createLocalClient } from "./local.ts";
import { routeMutations } from "./ephemeral.ts";
import { admissionRefusal, browserAdmission, failedAdmission, sdkOwned } from "./admission.ts";
import type { Client, Principal, Refusal, SessionRevocation, SignIn } from "./contract.ts";

const PERSONA = /^[A-Za-z0-9_-]+$/;

/** Literal loopback names only, as `snapback4 dev` admits them: never DNS. */
export function loopbackUrl(url: string): boolean {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "localhost" || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const octets = host.split(".");
  return octets.length === 4 && octets[0] === "127" && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function personaRefusal(url: string, persona: string): Refusal | undefined {
  if (!PERSONA.test(persona)) return { code: "E_AUTH", family: "auth", guide: "personas", site: "createApp.persona",
    message: `persona "${persona}" is not a name: use letters, digits, "_" or "-"`, rewrite: 'createApp({ url, persona: "alice" })' };
  if (!loopbackUrl(url)) return { code: "E_AUTH", family: "auth", guide: "personas", site: "createApp.persona",
    message: `personas are a development door: ${url} is not a loopback snapback4 dev server, and a deployed server refuses them`,
    rewrite: "createApp({ url, device, sessionStore }) and app.auth.login(email, password)" };
  return undefined;
}

export function personaApp(options: AppOptions & { readonly persona: string }): App {
  const url = options.url.replace(/\/$/, "");
  const persona = options.persona;
  const viewer = `dev:${persona}` as Principal;
  const fetcher = options.fetch;
  const personaOnly = (message: string): Refusal => ({ code: "E_AUTH", family: "auth", guide: "personas", site: "app.auth", message,
    rewrite: "create the app without persona to sign in: createApp({ url, device, sessionStore })" });
  const notOpen = (message: string, rewrite: string) => {
    const client = sdkOwned(() => createClient({ url, ...(fetcher ? { fetch: fetcher } : {}) }));
    client.mutate = routeMutations(client.mutate, (_op, _args, write) => failedAdmission(write?.id ?? mintId(),
      { ...admissionRefusal(message, "app.mutate", rewrite), code: "E_AUTH", family: "auth" }));
    return client;
  };
  let snapshot: AuthSnapshot = { state: "restoring", viewer: null };
  let current: Client = notOpen(`persona ${viewer} is still opening; the write was not admitted`, "await app.ready, then retry with the same id");
  let remote: Client | undefined, online: Online = onlineView(current);
  let closed = false, ended = false;
  const listeners = new Set<() => void>(), onlineListeners = new Set<() => void>();
  const publish = (next: AuthSnapshot) => {
    snapshot = next;
    for (const listener of onlineListeners) { try { listener(); } catch (error) { console.error("snapback4 online listener:", error); } }
    for (const listener of listeners) { try { listener(); } catch (error) { console.error("snapback4 auth listener:", error); } }
  };
  const signedOut = (why?: Refusal) => {
    const previous = [current, remote];
    current = notOpen(why?.message ?? `persona ${viewer} signed out; the write was not admitted`,
      why?.rewrite ?? "create a new app to act as a persona again");
    remote = undefined; online = onlineView(current);
    publish({ state: "signed-out", viewer: null, ...(why ? { why } : {}) });
    return Promise.all(previous.map(client => client?.close())).then(() => {});
  };
  const problem = (error: unknown): Refusal => {
    const message = error instanceof Error ? error.message : String(error);
    const code = /E_AUTH\b/.test(message) ? "E_AUTH" : "E_CLIENT";
    return { code, family: code === "E_AUTH" ? "auth" : "client", message, site: "createApp.persona", guide: "personas",
      rewrite: "start `snapback4 dev` on this loopback url with `use personas` declared, then create the app again" };
  };
  const refused = personaRefusal(url, persona);
  if (typeof window !== "undefined" && !refused) console.info(`snapback4: createApp acts as development persona ${viewer} (loopback snapback4 dev only; serve refuses personas).`);
  if (!options.device && browserAdmission()) console.warn("snapback4: a persona app without a device refuses browser writes with E_ADMISSION; use createApp({ url, persona, device: webDevice() }).");
  const ready: Promise<AppResult> = (async (): Promise<AppResult> => {
    if (refused) { await signedOut(refused); return { ok: false, why: refused }; }
    try {
      let opened: Client;
      if (options.device) {
        opened = await createLocalClient({ url, persona, device: options.device,
          ...(fetcher ? { fetch: fetcher } : {}),
          ...(options.waitSeconds !== undefined ? { waitSeconds: options.waitSeconds } : {}),
          ...(options.assets ? { assets: options.assets } : {}),
          ...(options.onDeliveryRefused ? { onDeliveryRefused: options.onDeliveryRefused } : {}) });
      } else {
        opened = sdkOwned(() => createClient({ url, persona, ...(fetcher ? { fetch: fetcher } : {}),
          ...(options.onDeliveryRefused ? { onDeliveryRefused: options.onDeliveryRefused } : {}) }));
        // The bare online transport has no browser admission journal. Name the
        // fix for this app, rather than the bare client's account-based one.
        if (browserAdmission()) opened.mutate = routeMutations(opened.mutate, (_op, _args, write) => failedAdmission(write?.id ?? mintId(),
          admissionRefusal("a persona app without a device has no synchronous browser admission journal", "app.mutate",
            "createApp({ url, persona, device: webDevice() })")));
        // A refused persona (serve, or a non-loopback peer) surfaces before
        // signed-in. An unreachable dev server does not: the online client
        // reports its link like any other.
        const denied = await (fetcher ?? defaultFetch)(url + "/probe", { headers: { "x-snapback-persona": persona } })
          .then(async response => response.status === 401 ? ((await response.json()) as { denied?: Refusal }).denied : undefined, () => undefined);
        if (denied) { await opened.close(); throw new Error(`E_AUTH: ${denied.message}`); }
      }
      if (closed || ended) { await opened.close(); return { ok: true }; }
      const previous = current;
      current = opened;
      online = onlineView(options.device ? (remote = sdkOwned(() => createClient({ url, persona, ...(fetcher ? { fetch: fetcher } : {}) }))) : current);
      publish({ state: "signed-in", viewer });
      await previous.close();
      return { ok: true };
    } catch (error) {
      const why = problem(error);
      if (!closed && !ended) await signedOut(why);
      return { ok: false, why };
    }
  })();
  const refuseSignIn = (): Promise<SignIn> => Promise.resolve({ ok: false,
    why: personaOnly(`this app acts as development persona ${viewer}; it has no sign-in`) });
  const auth: AppAuth = {
    get state() { return snapshot.state; },
    get viewer() { return snapshot.viewer; },
    get why() { return snapshot.why; },
    getSnapshot: () => snapshot,
    onChange(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    signup: refuseSignIn, login: refuseSignIn, guest: refuseSignIn,
    async logout() {
      // A persona has no session to revoke. Its device keeps queued writes for
      // the next app that opens this persona; logout only stops this one.
      ended = true;
      await ready.catch(() => {});
      await signedOut();
      return { ok: true };
    },
    logoutEverywhere: (): Promise<SessionRevocation> => Promise.resolve({ ok: false,
      why: personaOnly(`development persona ${viewer} has no sessions to revoke`) }),
  };
  let closing: Promise<void> | undefined;
  return {
    auth, ready,
    get client() { return current; },
    get online() { return online; },
    onOnlineChange(listener) { onlineListeners.add(listener); return () => { onlineListeners.delete(listener); }; },
    mutate: routeMutations((op, args) => current.mutate(op, args), (op, args, write) => current.mutate(op, args, write)),
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        await ready.catch(() => {});
        await Promise.all([current.close(), remote?.close()]);
        if (snapshot.state !== "signed-out") publish({ state: "signed-out", viewer: null });
        listeners.clear(); onlineListeners.clear();
      })();
      return closing;
    },
  };
}
