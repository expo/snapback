// React/browser witness of the installed starter. Native host components use
// DOM counterparts; this does not claim an iOS/Android input or layout witness.
export const nativeViews = `
import React from "react";
export const AppState = {
  currentState: "active", listeners: new Set(),
  addEventListener(_name, callback) { this.listeners.add(callback); return { remove: () => this.listeners.delete(callback) }; },
};
window.background = value => { AppState.currentState = value ? "background" : "active"; for (const listener of AppState.listeners) listener(AppState.currentState); };
export const View = ({children, testID}) => <div data-testid={testID}>{children}</div>;
export const ScrollView = View;
export function FlatList({ data, renderItem, keyExtractor, onViewableItemsChanged, testID }) {
  React.useEffect(() => { window.listMounts = (window.listMounts || 0) + 1; return () => { window.listUnmounts = (window.listUnmounts || 0) + 1; }; }, []);
  React.useEffect(() => { onViewableItemsChanged({ viewableItems: data.map(item => ({ item, isViewable: true })) }); }, [data, onViewableItemsChanged]);
  return <div data-testid={testID}>{data.map(item => <React.Fragment key={keyExtractor(item)}>{renderItem({ item })}</React.Fragment>)}</div>;
}
export const Text = ({children}) => <span>{children}</span>;
export const Button = ({title, onPress, disabled}) => <button disabled={disabled} onClick={onPress}>{title}</button>;
export const TextInput = ({value, onChangeText, onBlur, testID, accessibilityLabel}) =>
  <input data-testid={testID} aria-label={accessibilityLabel} value={value} onChange={event => onChangeText(event.target.value)} onBlur={onBlur} />;
export const Image = ({source, accessibilityLabel}) => <img src={source.uri} alt={accessibilityLabel || "image"} />;
`;

export const harness = `
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "snapback4/react";
import { createClient } from "real-client";
import { createApp } from "snapback4/app";
import { webDevice } from "snapback4/web";
import { keepSession, localStorageSessionStore } from "snapback4/auth";
import ConversationRoute from "starter-route";
import { api } from "starter-api";
const config = await (await fetch("/fixture.json")).json();
const { url, conversation, alice, bob, carol, history, photo, latePhoto } = config;
const originalFetch = window.fetch.bind(window);
let disconnected = false;
let logical = Date.now(), elapsed = 0, nextTimer = -1;
const intervals = new Map(), realInterval = window.setInterval, realClear = window.clearInterval;
const realPerformance = performance.now.bind(performance);
Date.now = () => logical;
performance.now = () => realPerformance() + elapsed;
window.setInterval = (callback, delay, ...args) => {
  if (delay !== 1000) return realInterval(callback, delay, ...args);
  const id = nextTimer--; intervals.set(id, () => callback(...args)); return id;
};
window.clearInterval = id => { intervals.delete(id); realClear(id); };
window.tick = async (ms = 1001) => {
  await originalFetch(url + "/dev/clock/advance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ duration: ms + "ms" }) });
  logical += ms; elapsed += ms;
  for (const callback of [...intervals.values()]) callback();
};
window.requests = []; window.revoked = []; window.assetCalls = []; window.components = { mounts: 0, unmounts: 0 };
window.fetch = async (input, init) => {
  const path = new URL(input instanceof Request ? input.url : input, location.href).pathname;
  const token = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("authorization");
  window.requests.push({ path, body: init?.body, account: token === "Bearer " + alice.token ? "alice" : "other" });
  if (disconnected && token === "Bearer " + alice.token) throw Error("offline");
  return originalFetch(input, init);
};
const sessionStore = localStorageSessionStore();
await keepSession(url, alice, sessionStore);
const ownerApp = createApp({ url, sessionStore, fetch: (input, init) => { if (disconnected) return Promise.reject(Error("offline")); return window.fetch(input, init); }, device: webDevice({ wasm: fetch("/device.wasm") }) });
const opened = await ownerApp.ready;
if (!opened.ok) throw Error(JSON.stringify(opened));
const raw = ownerApp.client;
await raw.sync();
const peer = createClient({ url, token: bob.token });
const other = createClient({ url, token: carol.token });
const ready = (data, extra = {}) => {
  const read = { data, complete: true, fresh: true, cut: null, next: null, ...extra };
  return { ...read, existence: data !== null && !(Array.isArray(data) && !data.length) ? "present" : read.complete && read.cut === null && read.next == null ? "absent" : "partial" };
};
window.observations = [];
let session = alice, currentRaw = raw;
const values = new Map([
  ["conversationScreen", ready({ id: conversation, title: "Friends" })],
  ["receiptMember", ready({ principal: alice.principal, conversation, seenOrdinal: 1000 })],
  ["history", ready(history)],
  ["messageReceipts", ready(history.map(row => ({ id: row.id, receipt: "delivered" })))],
]);
const records = new Set();
const linkListeners = new Set();
let link = "online";
let holdAsset = false, releaseAsset;
function controlled() {
  const ownedSession = session, assetClient = currentRaw;

  return {
    viewer: () => ownedSession.principal, onViewer: () => () => {},
    session: () => ownedSession, onSession: () => () => {},
    now: () => Date.now(), link: () => link, onLink: callback => { linkListeners.add(callback); return () => linkListeners.delete(callback); },
    pendingWrites: assetClient.pendingWrites, onPendingWrites: assetClient.onPendingWrites,
    onWrite: assetClient.onWrite, write: assetClient.write,
    mutate: (op, args, options) => assetClient.mutate(op, args, options),
    observe(op, args, options) {
      window.observations.push({ op: op.name, args, options });
      const listeners = new Set();
      const value = op.name === "messagePhoto" ? ready(history.find(row => row.id === args.id)) : values.get(args.c ? op.name + ":" + args.c : op.name);
      const record = { op, args, value, getSnapshot() { return record.value; },
        subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
        close() { records.delete(record); }, set(value) { record.value = value; for (const callback of listeners) callback(); } };
      records.add(record); return record;
    },
    upload: async () => ({ ok: true, asset: { id: window.pickAsset } }),
    async asset(id) {
      window.assetCalls.push(id);
      const result = await assetClient.asset(id);
      if (!("denied" in result)) {
        const revoke = result.revoke;
        result.revoke = () => { window.revoked.push(id); revoke(); };
      }
      if (holdAsset) { holdAsset = false; await new Promise(resolve => { releaseAsset = resolve; }); }
      return result;
    },
  };
}
const listeners = new Set();
let snapshot = { state: "signed-in", viewer: alice.principal };
const app = { client: controlled(), auth: { getSnapshot: () => snapshot,
  onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); } } };
function Mounted() {
  useEffect(() => { window.components.mounts++; return () => { window.components.unmounts++; }; }, []);
  return <ConversationRoute />;
}
const root = createRoot(document.getElementById("root"));
window.mount = () => root.render(<AppProvider app={app}><Mounted /></AppProvider>);
window.unmount = () => root.render(null);
window.mount();
window.setRead = (name, value) => {
  values.set(name, value);
  for (const record of records) if ((record.args.c ? record.op.name + ":" + record.args.c : record.op.name) === name) record.set(value);
};
window.ready = ready;
window.historyRows = history;
window.restore = () => {
  window.setRead("history", ready(history));
  window.setRead("conversationScreen", ready({ id: conversation, title: "Friends" }));
  window.setRead("receiptMember", ready({ principal: session.principal, conversation }));
  window.setRead("messageReceipts", ready(history.map(row => ({ id: row.id, receipt: "read" }))));
};
window.typingAtPeer = async () => (await peer.query(api.typingIn, { conversation })).data ?? [];
window.peerTyping = () => peer.mutate(api.setTyping, { conversation });
window.peerStop = () => peer.mutate(api.stopTyping, { conversation });
window.drop = async () => { disconnected = true; link = "offline"; for (const listener of linkListeners) listener(link); await Promise.all(window.onlineArms.map(arm => arm.query(api.typingIn, { conversation }))); };
window.reconnect = async () => { disconnected = false; link = "online"; for (const listener of linkListeners) listener(link); await raw.sync(); };
window.outboxes = async () => Promise.all(window.onlineArms.map(arm => arm.pendingWrites()));
window.savedSends = () => app.client.pendingWrites();
window.sendOutcomes = async () => { const key = "snapback4-social:" + JSON.stringify([url, alice.principal]); const intents = JSON.parse(localStorage.getItem(key) ?? '{"intents":[]}').intents; return Promise.all(intents.map(async i => ({ id: i.id, outcome: await raw.write(i.id) }))); };
window.restoreRoute = () => { window.navigate(conversation); };
window.expire = () => originalFetch(url + "/dev/clock/advance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ duration: "5s" }) });
window.serverHistory = () => peer.query(api.history, { conversation });
window.leave = () => window.leaveSession();
window.rejoin = () => window.rejoinSession();
window.holdAsset = () => { holdAsset = true; };
window.assetHeld = () => !!releaseAsset;
window.releaseAsset = () => { releaseAsset?.(); releaseAsset = null; };
window.accountSwitch = () => {
  session = carol; currentRaw = other; app.client = controlled();
  snapshot = { state: "signed-in", viewer: carol.principal };
  window.setRead("history", ready([])); window.setRead("conversationScreen", ready(null)); window.setRead("receiptMember", ready(null));
  for (const listener of listeners) listener();
};
window.finish = async () => { root.unmount(); await Promise.all([ownerApp.close(), peer.close(), other.close(), ...window.onlineArms.map(arm => arm.close())]); };
window.fixtureReady = true;
`;

// The real Router route runs with controlled navigation/focus/foreground input.
export const routerHarness = `
import React from "react";
const config = await (await fetch("/fixture.json")).json();
let route = config.conversation, focused = true;
const listeners = new Set();
export const router = { push() {} };
export function useLocalSearchParams() {
  const id = React.useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => route);
  return { id };
}
export function useFocusEffect(callback) {
  const focus = React.useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => focused);
  React.useEffect(() => { if (focus) return callback(); }, [callback, focus]);
}
window.navigate = id => { route = id; for (const listener of listeners) listener(); };
window.focusRoute = value => { focused = value; for (const listener of listeners) listener(); };
`;
export const onlineClientHarness = `
export * from "real-client";
import { createClient as realCreateClient } from "real-client";
window.onlineArms = [];
window.typingResults = [];
let holdTyping = false, releaseTyping;
window.holdTypingFailure = () => { holdTyping = true; };
window.typingFailureHeld = () => !!releaseTyping;
window.releaseTypingFailure = () => { releaseTyping(); releaseTyping = null; };
export function createClient(options) {
  const client = realCreateClient(options), observe = client.observe, mutate = client.mutate;
  window.onlineArms.push(client);
  client.mutate = async (op, args, options) => {
    const held = op.name === "setTyping" && holdTyping;
    if (held) holdTyping = false;
    let signal = await mutate(op, args, options);
    if (held) {
      // Delay only the caller's result, leaving the real SDK lane free to
      // complete a later renewal against the server before this refusal.
      await new Promise(resolve => { releaseTyping = resolve; });
      signal = { state: "failed", id: signal.id, why: { code: "E_RATE_LIMIT", message: "Held renewal refusal" } };
    }
    if (op.name === "setTyping") window.typingResults.push(signal.state);
    return signal;
  };
  client.observe = (op, args, options) => {
    window.observations.push({ op: op.name, args, options });
    return observe(op, args, options);
  };
  return client;
}
`;

// Search runs without controlled query answers: actual AppProvider, Pages,
// wasm/IndexedDB and HTTP composition over the generated starter operations.
export const searchHarness = `
import React from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "snapback4/react";
import { createApp } from "snapback4/app";
import { webDevice } from "snapback4/web";
import { keepSession, localStorageSessionStore } from "snapback4/auth";
import Search from "starter-search";
const { url, session } = await (await fetch("/fixture.json")).json();
const sessionStore = localStorageSessionStore();
await keepSession(url, session, sessionStore);
window.searchCalls = [];
const app = createApp({ url, sessionStore, device: webDevice({ wasm: fetch("/device.wasm") }),
  fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path.startsWith("/q/search")) window.searchCalls.push({ path, body: JSON.parse(init.body) });
    return fetch(input, init);
  },
});
const opened = await app.ready;
if (!opened.ok) throw Error(JSON.stringify(opened));
await app.client.sync();
const root = createRoot(document.getElementById("root"));
window.mountSearch = conversation => root.render(<AppProvider app={app}><Search conversation={conversation} /></AppProvider>);
window.syncSearch = () => app.client.sync();
window.searchResidency = () => app.client.residency();
window.finishSearch = async () => { root.unmount(); await app.close(); };
window.fixtureReady = true;
`;
