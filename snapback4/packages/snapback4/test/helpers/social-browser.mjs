// React/browser witness of the installed starter. Native host components use
// DOM counterparts; this does not claim an iOS/Android input or layout witness.
export const nativeViews = `
import React from "react";
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
import { createClient } from "snapback4/client";
import { ConversationScreen } from "starter-conversation";
import { api } from "starter-api";
const config = await (await fetch("/fixture.json")).json();
const { url, conversation, alice, bob, carol, history, photo, latePhoto } = config;
const originalFetch = window.fetch.bind(window);
let disconnected = false;
window.requests = []; window.revoked = []; window.assetCalls = []; window.components = { mounts: 0, unmounts: 0 };
window.fetch = async (input, init) => {
  const path = new URL(input).pathname;
  const token = new Headers(init?.headers).get("authorization");
  window.requests.push({ path, account: token === "Bearer " + alice.token ? "alice" : "other" });
  if (disconnected && token === "Bearer " + alice.token) throw Error("offline");
  return originalFetch(input, init);
};
const raw = createClient({ url, token: alice.token });
const peer = createClient({ url, token: bob.token });
const other = createClient({ url, token: carol.token });
const ready = (data, extra = {}) => ({ data, complete: true, fresh: true, cut: null, next: null, ...extra });
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
  const pendingListeners = new Set();
  return {
    viewer: () => ownedSession.principal, onViewer: () => () => {},
    session: () => ownedSession, onSession: () => () => {},
    now: () => Date.now(), link: () => link, onLink: callback => { linkListeners.add(callback); return () => linkListeners.delete(callback); },
    pendingWrites: async () => [], onPendingWrites: callback => { pendingListeners.add(callback); return () => pendingListeners.delete(callback); },
    onWrite: () => () => {}, write: async () => undefined,
    mutate: (op, args, options) => assetClient.mutate(op, args, options),
    observe(op, args) {
      const listeners = new Set();
      const value = op.name === "messagePhoto" ? ready(history.find(row => row.id === args.id)) : values.get(op.name);
      const record = { op, args, value, getSnapshot() { return record.value; },
        subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
        close() { records.delete(record); }, set(value) { record.value = value; for (const callback of listeners) callback(); } };
      records.add(record); return record;
    },
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
  return <ConversationScreen conversation={conversation} url={url} />;
}
const root = createRoot(document.getElementById("root"));
root.render(<AppProvider app={app}><Mounted /></AppProvider>);
window.setRead = (name, value) => {
  values.set(name, value);
  for (const record of records) if (record.op.name === name) record.set(value);
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
window.drop = () => { disconnected = true; link = "offline"; for (const listener of linkListeners) listener(link); };
window.reconnect = () => { disconnected = false; link = "online"; for (const listener of linkListeners) listener(link); };
window.outboxes = async () => [await raw.pendingWrites(), await peer.pendingWrites()];
window.expire = () => originalFetch(url + "/dev/clock/advance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ duration: "5s" }) });
window.leave = () => raw.mutate(api.leave, { conversation });
window.rejoin = () => peer.mutate(api.add, { conversation, principal: alice.principal });
window.holdAsset = () => { holdAsset = true; };
window.assetHeld = () => !!releaseAsset;
window.releaseAsset = () => { releaseAsset?.(); releaseAsset = null; };
window.accountSwitch = () => {
  session = carol; currentRaw = other; app.client = controlled();
  snapshot = { state: "signed-in", viewer: carol.principal };
  window.setRead("history", ready([])); window.setRead("conversationScreen", ready(null)); window.setRead("receiptMember", ready(null));
  for (const listener of listeners) listener();
};
window.finish = async () => { root.unmount(); await Promise.all([raw.close(), peer.close(), other.close()]); };
window.fixtureReady = true;
`;
