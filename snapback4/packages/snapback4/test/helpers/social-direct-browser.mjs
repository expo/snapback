// Real replica/server writes and reads; controlled navigation, notifications, lookup delay and receipt-result omission.
export const directHarness = `
import React from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "snapback4/react";
import { createApp } from "snapback4/app";
import { webDevice } from "snapback4/web";
import { keepSession, localStorageSessionStore } from "snapback4/auth";
import Profile from "./src/Profile";
import Direct from "./src/Direct";
import ConversationRoute from "./app/conversation/[id]";
import { api } from "./snapback/generated/api";
import { useLocalSearchParams } from "expo-router";
const { url, session } = await (await fetch("/fixture.json")).json();
const store = localStorageSessionStore();
await keepSession(url, session, store);
let offline = false, held = false;
window.dmAttempts = [];
const app = createApp({ url, sessionStore: store, device: webDevice({ wasm: fetch("/device.wasm") }),
  fetch(input, init) {
    if (offline) throw Error("offline");
    // Explicit sync owns acquisition here. A pre-disconnect long poll must not
    // deliver the later invite into the intentionally offline observation.
    if (new URL(input).pathname === "/changes") return new Promise((_, reject) => {
      if (init.signal.aborted) reject(new DOMException("Aborted", "AbortError"));
      else init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    return fetch(input, init);
  },
});
const opened = await app.ready;
if (!opened.ok) throw Error(JSON.stringify(opened));
await app.client.sync();
const observe = app.client.observe, mutate = app.client.mutate;
window.memberDM = conversation => app.client.query(api.receiptMember, { conversation });
window.leaveDM = conversation => app.client.mutate(api.leave, { conversation });
window.historyDM = conversation => app.client.query(api.history, { conversation });
window.writeDM = id => app.client.write(id);
// A recovered receipt can prove success without a historical result. Preserve
// the real outcome, removing only that optional field for the recovery witness.
const write = app.client.write;
window.recoveredDM = [];
app.client.write = async id => {
  const receipt = await write(id);
  if (id !== window.withoutResultDM || receipt?.state !== "sent") return receipt;
  const { result, ...recovered } = receipt;
  window.recoveredDM.push(recovered);
  return recovered;
};
window.savedDM = () => JSON.parse(localStorage.getItem('snapback4-social:' + JSON.stringify([url, session.principal])) ?? '{}');
const waiting = new Set(), loading = { loading: true };
window.membersDM = {};
app.client.mutate = (op, args, options) => {
  if (op.name === "openDirect") window.dmAttempts.push({ args, options });
  return mutate(op, args, options);
};
app.client.observe = (op, args, options) => {
  const watch = observe(op, args, options);
  if (op.name === "receiptMember") return { ...watch, getSnapshot() {
    const answer = watch.getSnapshot(); window.membersDM[args.conversation] = answer; return answer;
  } };
  if (op.name !== "directConversation") return watch;
  return { ...watch, getSnapshot: () => held ? loading : watch.getSnapshot(),
    subscribe(callback) { waiting.add(callback); const off = watch.subscribe(callback); return () => { waiting.delete(callback); off(); }; },
  };
};
window.holdLookup = value => { held = value; for (const notify of waiting) notify(); };
window.dropDM = async () => { offline = true; await app.client.sync(); };
window.connectDM = async () => { offline = false; await app.client.sync(); };
window.syncDM = () => app.client.sync();
window.pendingDM = () => app.client.pendingWrites();
function Routes() {
  const params = useLocalSearchParams();
  if (params.screen === "dm") return <Direct key={params.other} other={params.other} />;
  if (params.screen === "conversation") return <ConversationRoute />;
  return <Profile />;
}
const root = createRoot(document.getElementById("root"));
root.render(<AppProvider app={app}><Routes /></AppProvider>);
window.finishDM = async () => { root.unmount(); await app.close(); };
window.fixtureReady = true;
`;
export const directRouter = `
import React from "react";
let params = { screen: "profile" };
const listeners = new Set();
function navigate(value) { params = value; history.replaceState(null, "", value.screen === "conversation" ? "/conversation/" + value.id : "/"); for (const notify of listeners) notify(); }
export const router = {
  push({ pathname, params }) { navigate({ ...params, screen: pathname.startsWith("/dm/") ? "dm" : "conversation" }); },
  replace(value) { this.push(value); },
  setParams(next) { navigate({ ...params, ...next }); },
};
export function useLocalSearchParams() { return React.useSyncExternalStore(callback => { listeners.add(callback); return () => listeners.delete(callback); }, () => params); }
export function useFocusEffect(callback) { React.useEffect(callback, [callback]); }
window.openDM = other => navigate({ screen: "dm", other });
window.profileDM = () => navigate({ screen: "profile" });
window.routeDM = () => params;
window.navigateDM = value => navigate({ screen: "conversation", ...value });
`;
