export const pendingItemsHarness = `
async function intentClient(session) {
  let seq = 0, value = false, held;
  const client = createClient({ url: "https://react-intents.invalid", ...(session ? { session } : { persona: "alice" }), fetch: async (input) => {
    const path = new URL(input).pathname;
    if (path === "/auth/refresh") return Response.json({ ok: true, session: { ...session, token: "rotated" } });
    if (path === "/probe") return Response.json({ ok: true, store_id: "A", seq });
    if (path === "/changes") return new Promise(() => {});
    if (path === "/m/write") return held ? held.promise : Response.json({ state: "sent", seq: ++seq });
    if (path === "/q/read") return Response.json({ data: value, seq, complete: true });
    throw Error(path);
  } });
  const custody = await onlineCustody(client, "https://react-intents.invalid", memorySessionStore(), error => { throw error; });
  return { client: custody.client, hold() { held = deferred(); }, advance(next, at) { value = next; seq = at; } };
}
async function waitIntent(predicate) { await awaitState(predicate, "online presentation update", { poll: async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); } }); }
cases["pending items release unowned resource payloads without reloading unrelated pending writes"] = async () => {
  const f = await intentClient(), client = f.client; let resource = "a", latest, renders = 0;
  function Screen() {
    renders++;
    latest = usePendingItems({ writes: [mutation], rows: [], scope: w => w.args.conversation === resource, rowKey: r => r.id, intentKey: w => w.args.id });
    return h("div", null, latest.length);
  }
  try {
    await mount(h(Screen), client);
    await act(async () => { await client.mutate(mutation, { id: "row", conversation: "a", text: "owned" }); });
    await waitIntent(() => latest[0]?.phase === "settling");
    resource = "b"; await render(h(Screen), client);
    await act(async () => { await client.pendingWrites(); });
    equal(await pendingIntentAccess(client).read(), [], "changed resource releases now-unowned terminal arguments");
    f.hold();
    await act(async () => { await client.mutate(mutation, { id: "other", conversation: "a", text: "unrelated custody" }, { waitSeconds: 0 }); });
    await act(async () => { await client.pendingWrites(); });
    equal(latest, [], "unrelated pending custody is not cached for this presentation");
    const before = renders;
    await act(async () => { await client.pendingWrites(); });
    check(renders === before, "ownership filtering must not cause a render/read loop");
  } finally { await unmount(); await client.close(); }
};
const intentArgs = { id: "row", conversation: "a", text: "hello", set: true };
for (const predicted of [false, true]) cases["pending items online retirement: " + (predicted ? "prediction never retires success" : "confirmed row retires success permanently")] = async () => {
  const { client } = await intentClient(); let rows = [], latest;
  function Screen() {
    latest = usePendingItems({ writes: [mutation], rows, scope: w => w.args.conversation === "a", rowKey: r => r.id, intentKey: w => w.args.id });
    return h("div", null, latest.map(i => i.kind === "row" ? "row:" + i.row.id : i.phase + ":" + i.write.args.text).join(","));
  }
  try {
    await mount(h(Screen), client);
    await act(async () => { check((await client.mutate(mutation, intentArgs)).state === "sent", "fixture write succeeded"); });
    await waitIntent(() => latest[0]?.phase === "settling");
    check(latest[0]?.phase === "settling", "success retains its card: " + JSON.stringify(latest));
    rows = [{ id: "row", pending: predicted }]; await render(h(Screen), client);
    equal(latest.map(i => i.kind), ["row"], "mapped row suppresses card");
    await act(async () => { await client.pendingWrites(); });
    rows = []; await render(h(Screen), client);
    if (predicted) check(latest[0]?.phase === "settling" && latest[0].write.args.text === "hello", "withdrawing prediction must restore text");
    else equal(latest, [], "withdrawing confirmed row cannot resurrect retired intent");
    await act(async () => { await client.signOut(); }); equal(latest, [], "account retirement withdraws text");
  } finally { await unmount(); await client.close(); }
};
cases["pending state uses covering read sequence when another writer supersedes success"] = async () => {
  const f = await intentClient(), client = f.client; let read = await client.query(query, {}), latest;
  function Screen() {
    latest = usePendingState(mutation, { scope: w => w.args.conversation === "a", current: read.data, read, value: a => a.set });
    return h("div", null, String(latest.value));
  }
  try {
    await mount(h(Screen), client);
    await act(async () => { check((await client.mutate(mutation, intentArgs)).state === "sent", "fixture write succeeded"); });
    await waitIntent(() => !latest.intent || latest.intent.phase === "settling");
    check(latest.value === true && latest.intent?.phase === "settling", "sequence 0 cannot retire sequence 1: " + JSON.stringify(latest));
    f.advance(false, 2); read = await client.query(query, {}); await render(h(Screen), client);
    await act(async () => { await client.pendingWrites(); });
    check(latest.value === false && !latest.intent, "sequence 2 supersedes set(true) at sequence 1");
  } finally { await unmount(); await client.close(); }
};
cases["pending state value equality without covering read evidence cannot retire success"] = async () => {
  const f = await intentClient(), client = f.client; f.advance(true, 0);
  let read = await client.query(query, {}), latest;
  function Screen() {
    latest = usePendingState(mutation, { scope: w => w.args.conversation === "a", current: read.data, read, value: a => a.set });
    return h("div", null, String(latest.value));
  }
  try {
    await mount(h(Screen), client);
    await act(async () => { check((await client.mutate(mutation, intentArgs)).state === "sent", "fixture write succeeded"); });
    await waitIntent(() => !latest.intent || latest.intent.phase === "settling");
    await act(async () => { await client.pendingWrites(); });
    check(latest.intent?.phase === "settling", "equal value at sequence 0 proves nothing about success 1");
    f.advance(false, 2); read = await client.query(query, {}); await render(h(Screen), client);
    await act(async () => { await client.pendingWrites(); });
    check(latest.value === false && !latest.intent, "newer authorized false wins");
  } finally { await unmount(); await client.close(); }
};
cases["round2: pending state rejects a saved covering read after a real bearer reset"] = async () => {
  const session = { token: "original", principal: "alice", kind: "password", expiresAt: Date.now() + 7 * 86400000 };
  const f = await intentClient(session), client = f.client; let read = await client.query(query, {}), latest;
  function Screen() {
    latest = usePendingState(mutation, { scope: w => w.args.conversation === "a", current: read.data, read, value: a => a.set });
    return h("div", null, String(latest.value));
  }
  try {
    await mount(h(Screen), client);
    await act(async () => { check((await client.mutate(mutation, intentArgs)).state === "sent", "fixture write succeeded"); });
    await waitIntent(() => latest.intent?.phase === "settling");
    f.advance(false, 2);
    const saved = await client.query(query, {}), scope = pendingIntentAccess(client).scope();
    check(saved.fresh && !saved.revalidating && saved.data === false, "retained real authorized read covers receipt 1");
    await act(async () => { check((await client.refreshSession()).ok, "real bearer rotation succeeds"); });
    check(pendingIntentAccess(client).scope() === scope, "same principal/store leaves presentation scope unchanged");
    read = saved; await render(h(Screen), client);
    await act(async () => { await client.pendingWrites(); });
    check(latest.intent?.phase === "settling" && latest.value === true, "invalidated covering read must not retire success");
    read = await client.query(query, {}); await render(h(Screen), client);
    await waitIntent(() => !latest.intent);
    check(latest.value === false, "fresh replacement covering read retires success");
  } finally { await unmount(); await client.close(); }
};
`;
