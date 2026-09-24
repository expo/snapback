// Shared real-client journey: the writer and reader have independent devices.
export async function exercise({ url, createApp, memorySessionStore, deviceFactory, mount = async () => null }) {
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const until = async (read, label) => {
    for (let n = 0; n < 1000; n++) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 10)); }
    throw Error(`timed out: ${label}`);
  };
  const q = name => ({ kind: "query", name }), m = name => ({ kind: "mutation", name });
  const apps = [], watches = [], replies = [], requests = [];
  const expiryArmed = new Set();
  let offline = false, holdWrite = false, holdInbox = false, releaseInbox, inboxGate, unmount;
  const fetcher = async (input, init) => {
    const path = new URL(input).pathname.split("/").slice(-2).join("/");
    requests.push(path);
    if (offline) throw Error("controlled offline link");
    if (holdWrite && path === "m/resetRead") await new Promise((_, reject) => {
      if (init.signal?.aborted) reject(Error("closed"));
      else init.signal?.addEventListener("abort", () => reject(Error("closed")), { once: true });
    });
    if (holdInbox && path === "q/inbox") await inboxGate;
    const response = await fetch(input, init);
    // Schedule one rerun per observation without committing device rows. The
    // data comes from the real server; only the retry deadline is controlled.
    if (path === "q/inbox" && !expiryArmed.has(init.body)) {
      expiryArmed.add(init.body);
      return Response.json({ ...await response.json(), nextExpiry: Date.now() + 2000 });
    }
    return response;
  };
  try {
    const sessions = memorySessionStore();
    const seed = createApp({ url, sessionStore: sessions }); apps.push(seed); await seed.ready;
    const alice = await seed.auth.signup("alice@example.com", "password-alice");
    check(alice.ok, JSON.stringify(alice));
    const writer = createApp({ url, device: deviceFactory(), sessionStore: memorySessionStore() });
    apps.push(writer); await writer.ready;
    const bob = await writer.auth.signup("bob@example.com", "password-bob");
    check(bob.ok, JSON.stringify(bob));
    const dm = await seed.mutate(m("startDM"), { other: bob.session.principal });
    check(dm.state === "sent", JSON.stringify(dm));
    for (let n = 0; n < 3; n++) check((await writer.mutate(m("send"), { chat: dm.result, body: `message ${n}` })).state === "sent", "writer sent");
    await seed.close();
    const underlying = deviceFactory();
    const device = { async open(...args) {
      const core = await underlying.open(...args);
      return { ...core, async call(request, committed) {
        const reply = await core.call(request, committed);
        if (request.op === "query") replies.push({ name: request.name, reply });
        return reply;
      } };
    } };
    const reader = createApp({ url, device, sessionStore: sessions, fetch: fetcher });
    apps.push(reader); await reader.ready;
    check(reader.auth.viewer === alice.session.principal, "restored reader account");
    const inbox = reader.client.observe(q("inbox"), {}); watches.push(inbox);
    const snapshots = [];
    inbox.subscribe(() => snapshots.push(inbox.getSnapshot()));
    let hooks = await mount(reader); unmount = hooks?.close;
    await until(() => inbox.getSnapshot().data?.[0]?.unread === 3, "published inbox");
    if (hooks) await until(() => hooks.read().query.data?.[0]?.unread === 3 && hooks.read().page.items[0]?.unread === 3, "both hooks published inbox");
    check(replies.some(row => row.name === "inbox" && row.reply.ok?.loading), "the cold device's unread domain crosses its horizon");
    const publicationStart = snapshots.length;
    holdInbox = true; inboxGate = new Promise(resolve => { releaseInbox = resolve; });
    const before = requests.filter(path => path === "q/inbox").length;
    await until(() => requests.filter(path => path === "q/inbox").length > before && inbox.getSnapshot().fresh === false, "local server fallback");
    const kept = inbox.getSnapshot();
    check(kept.data?.[0]?.unread === 3 && Number.isFinite(kept.since), "published inbox bridges the server fetch");
    if (hooks) await until(() => hooks.read().query.fresh === false && hooks.read().page.read.fresh === false, "both hooks bridge the fetch");
    if (hooks) check(hooks.read().query.data[0].unread === 3 && hooks.read().page.items[0].unread === 3, "neither hook blanks its first page during the fetch");
    check(snapshots.slice(publicationStart).every(read => "data" in read), "no blank while the replacing fetch is in flight");
    check(inbox.getSnapshot().since === kept.since, "since is stable during the fetch");
    holdWrite = true;
    const pending = await reader.mutate(m("resetRead"), { chat: dm.result });
    check(pending.state === "pending" && reader.client.link() === "online", "pending prediction while online");
    check(inbox.getSnapshot().loading, "every local prediction clears the courtesy answer immediately");
    if (hooks) await until(() => hooks.read().query.loading && hooks.read().page.read.loading, "commit clears both hooks");
    const pendingBefore = requests.filter(path => path === "q/inbox").length;
    const direct = reader.client.query(q("inbox"), {});
    await until(() => requests.filter(path => path === "q/inbox").length > pendingBefore, "fallback starts despite pending write");
    holdInbox = false; releaseInbox();
    check((await direct).data?.[0]?.unread === 3, "server answers despite pending prediction");
    await until(() => inbox.getSnapshot().fresh === true, "server answer replaces kept inbox");
    offline = true;
    await reader.client.query(q("ping"), {});
    check(reader.client.link() === "offline", "link disconnected");
    const rawBefore = replies.length;
    await reader.mutate(m("resetRead"), { chat: dm.result });
    await until(() => replies.slice(rawBefore).some(row => row.name === "inbox" && row.reply.ok?.loading), "unavailable offline rerun");
    await until(() => inbox.getSnapshot().loading, "offline has no replacing fetch");
    if (hooks) await until(() => hooks.read().query.loading && hooks.read().page.read.loading, "both hooks become loading offline");
    if (hooks) check(hooks.read().page.items.length === 0, "offline unavailable first page cannot retain its old rows");
    const never = reader.client.observe(q("totalList"), { chat: dm.result }); watches.push(never);
    never.subscribe(() => {});
    await until(() => replies.some(row => row.name === "totalList" && row.reply.ok?.loading), "never-answered offline query evaluated");
    check(never.getSnapshot().loading === true, "offline without an answer is loading");
    await reader.mutate(m("resetRead"), { chat: dm.result });
    await until(() => replies.length > rawBefore + 2, "another rerun");
    check(inbox.getSnapshot().loading, "another unavailable rerun cannot resurrect data");
    check(snapshots.filter(read => "data" in read).every(read => Array.isArray(read.data)), "all published lists are arrays");
    offline = false; holdWrite = false;
    const switched = await reader.auth.login("bob@example.com", "password-bob");
    check(switched.ok && reader.auth.viewer === bob.session.principal, "account switched");
    check(inbox.getSnapshot().denied?.code === "E_CLOSED", "old client clears its kept answer");
    if (hooks) await until(() => hooks.read().query.data?.[0]?.principal === bob.session.principal, "new account's hooks answer");
    if (hooks) check(hooks.read().page.items.every(row => row.principal === bob.session.principal), "pages contain only the new account's rows");
    return { keptUnread: kept.data[0].unread, since: kept.since, serverFallback: true, accountCleared: true };
  } finally {
    releaseInbox?.();
    await unmount?.();
    for (const watch of watches) watch.close();
    await Promise.all(apps.map(app => app.close()));
  }
}
