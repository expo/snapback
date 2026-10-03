export const pendingItemsHarness = `
cases["pending items discriminate rows, survive prediction withdrawal and fence account switches in StrictMode"] = async () => {
  const listeners = new Set(); let scope = "alice:A", items = [], rows = [], latest, selected, current = false, observed = [];
  const client = { viewer: () => scope ? "alice" : null, onLink: () => () => {}, onSession: () => () => {}, onViewer: () => () => {},
    onPendingWrites: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  registerPendingIntents(client, { scope: () => scope, read: async () => items });
  registerIntentObserver(client, ids => { observed = ids; });
  const args = { id: "row", conversation: "a", text: "hello", set: true };
  const write = { id: "mutation", op: "write", args, state: "queued", predicted: [] };
  function Screen() {
    latest = usePendingItems({ writes: [mutation], rows, scope: w => w.args.conversation === "a", rowKey: r => r.id, intentKey: w => w.args.id });
    selected = usePendingState(mutation, { scope: w => w.args.conversation === "a", current, value: a => a.set });
    return h("div", null, latest.map(i => i.kind === "row" ? "row:" + i.row.id : i.phase + ":" + i.write.args.text).join(","));
  }
  await mount(h(Screen), client);
  await act(async () => { items = [{ write, phase: "queued" }]; listeners.forEach(fn => fn()); });
  equal(latest.map(i => [i.kind, i.phase]), [["intent", "queued"]], "no prediction still renders custody");
  check(selected.value === true && selected.intent.phase === "queued", "last set intent selected");
  check(listeners.size === 1, "list and selector share one observation");
  rows = [{ id: "row", pending: true }]; await render(h(Screen), client);
  equal(latest.map(i => i.kind), ["row"], "prediction suppresses card");
  rows = []; await render(h(Screen), client); check(latest[0].kind === "intent", "withdrawal restores intent");
  await act(async () => { items = [{ write, phase: "settling", receipt: { state: "sent", id: "mutation", seq: 3, replayed: true } }]; listeners.forEach(fn => fn()); });
  equal(latest.map(i => i.phase), ["settling"], "receipt does not retire before observed write");
  current = true;
  await act(async () => { items = [{ write: { ...write, id: "older", args: { ...args, set: false } }, phase: "settling" }, ...items]; listeners.forEach(fn => fn()); });
  equal(observed, ["older", "mutation"], "observed latest state retires earlier opposite success too");
  current = false;
  await unmount(); await mount(h(Screen), client); check(latest[0].phase === "settling", "remount recovers facts");
  await act(async () => { scope = undefined; listeners.forEach(fn => fn()); });
  equal(latest, [], "retired scope exposes no arguments");
  check(selected.intent === undefined && selected.value === false, "selector withdraws too");
  await unmount(); check(listeners.size === 0, "StrictMode leaves no subscription");
};
`;
