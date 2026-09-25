// Shared real-client journey: the writer and reader have independent devices.
export async function exercise({ url, createApp, memorySessionStore, deviceFactory, mount = async () => null }) {
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const until = async (read, label) => {
    for (let n = 0; n < 1000; n++) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 10)); }
    throw Error(`timed out: ${label}`);
  };
  const q = name => ({ kind: "query", name }), m = name => ({ kind: "mutation", name });
  const apps = [], watches = [], replies = [], requests = [];
  const expiryArmed = new Map();
  let offline = false, holdWrite = false, holdInbox = false, releaseInbox, releaseWrite, inboxGate, unmount;
  const fetcher = async (input, init) => {
    const path = new URL(input).pathname.split("/").slice(-2).join("/");
    requests.push(path);
    if (offline) throw Error("controlled offline link");
    if (holdWrite && path === "m/resetRead") await new Promise((resolve, reject) => {
      releaseWrite = resolve;
      if (init.signal?.aborted) reject(Error("closed"));
      else init.signal?.addEventListener("abort", () => reject(Error("closed")), { once: true });
    });
    if (offline) throw Error("controlled offline link after pending send");
    if (holdInbox && path === "q/inbox") await inboxGate;
    const response = await fetch(input, init);
    // Give each observation a known authorization deadline without a row
    // commit. A stalled replacement cannot extend the old answer's lifetime.
    if (path === "q/inbox" && !expiryArmed.has(init.body)) {
      const nextExpiry = Date.now() + 2000;
      expiryArmed.set(init.body, nextExpiry);
      return Response.json({ ...await response.json(), nextExpiry });
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
    inbox.subscribe(() => snapshots.push({ read: inbox.getSnapshot(), at: Date.now() }));
    let hooks = await mount(reader); unmount = hooks?.close;
    await until(() => inbox.getSnapshot().data?.[0]?.unread === 3, "published inbox");
    if (hooks) await until(() => hooks.read().query.data?.[0]?.unread === 3 && hooks.read().page.items[0]?.unread === 3, "both hooks published inbox");
    check(replies.some(row => row.name === "inbox" && row.reply.ok?.loading), "the cold device's unread domain crosses its horizon");
    const initialUnread = inbox.getSnapshot().data[0].unread;
    const inboxExpiry = expiryArmed.get(JSON.stringify({ args: {} }));
    check(Number.isFinite(inboxExpiry), "the observed inbox has an authorization deadline");
    const publicationStart = snapshots.length;
    holdInbox = true; inboxGate = new Promise(resolve => { releaseInbox = resolve; });
    const before = requests.filter(path => path === "q/inbox").length;
    await until(() => requests.filter(path => path === "q/inbox").length > before && inbox.getSnapshot().loading, "expired inbox with stalled fallback");
    if (hooks) await until(() => hooks.read().query.loading && hooks.read().page.read.loading, "both hooks withdraw expired data");
    if (hooks) check(hooks.read().page.items.length === 0, "expired first-page rows cannot bridge the fetch");
    // A sync rerun may retain still-authorized data before T. Only publications
    // at or after the actual deadline claim that expired data survived.
    check(snapshots.slice(publicationStart).filter(row => row.at >= inboxExpiry).every(({ read }) => !("data" in read)), "no expired data while the replacing fetch is in flight");
    holdWrite = true;
    const pending = await reader.mutate(m("resetRead"), { chat: dm.result });
    check(pending.state === "pending" && reader.client.link() === "online", "pending prediction while online");
    check(inbox.getSnapshot().loading, "every local prediction clears the courtesy answer immediately");
    if (hooks) await until(() => hooks.read().query.loading && hooks.read().page.read.loading, "commit clears both hooks");
    const pendingBefore = requests.filter(path => path === "q/inbox").length;
    // LLP 3000.016: an unobserved resetRead writes a table the inbox reads.
    // Neither a new fallback nor the already pending response may replace it.
    const pendingPublications = snapshots.length, pendingReplies = replies.length;
    const direct = await reader.client.query(q("inbox"), {});
    check(direct.loading, "pending prediction withholds the unavailable total");
    check(requests.filter(path => path === "q/inbox").length === pendingBefore, "prediction fence prevents fallback dispatch");
    holdInbox = false; releaseInbox();
    await until(() => replies.length > pendingReplies && inbox.getSnapshot().loading, "withheld rerun after old response");
    check(snapshots.slice(pendingPublications).every(({ read }) => !("data" in read)), "no old server answer replaces the prediction");
    offline = true;
    // A fenced server-only ping cannot probe the link. Fail the actual send.
    await until(() => releaseWrite, "pending send entered"); releaseWrite();
    await until(() => reader.client.link() === "offline", "link disconnected");
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
    check(snapshots.filter(({ read }) => "data" in read).every(({ read }) => Array.isArray(read.data)), "all published lists are arrays");
    offline = false; holdWrite = false;
    const switched = await reader.auth.login("bob@example.com", "password-bob");
    check(switched.ok && reader.auth.viewer === bob.session.principal, "account switched");
    check(inbox.getSnapshot().denied?.code === "E_AUTH", "the retired app facade refuses access and clears its kept answer");
    if (hooks) await until(() => hooks.read().query.data?.[0]?.principal === bob.session.principal, "new account's hooks answer");
    if (hooks) check(hooks.read().page.items.every(row => row.principal === bob.session.principal), "pages contain only the new account's rows");
    return { initialUnread, expiryCleared: true, serverFallback: true, accountCleared: true };
  } finally {
    releaseInbox?.(); releaseWrite?.();
    await unmount?.();
    for (const watch of watches) watch.close();
    await Promise.all(apps.map(app => app.close()));
  }
}
