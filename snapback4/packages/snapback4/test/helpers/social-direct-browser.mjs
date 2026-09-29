// Real replica/server writes and reads; only navigation and the lookup delay are controlled.
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
  fetch(input, init) { if (offline) throw Error("offline"); return fetch(input, init); },
});
const opened = await app.ready;
if (!opened.ok) throw Error(JSON.stringify(opened));
await app.client.sync();
const observe = app.client.observe, mutate = app.client.mutate;
const waiting = new Set(), loading = { loading: true };
app.client.mutate = (op, args, options) => {
  if (op.name === "openDirect") window.dmAttempts.push({ args, options });
  return mutate(op, args, options);
};
app.client.observe = (op, args, options) => {
  const watch = observe(op, args, options);
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
`;
