import { hangBudget } from './helpers/wait.mjs';
// Actual generated server entries, supervised Node 24 workers and HTTP ingress.
// The local provider is a durable protocol witness, not a third-party adapter.
import test from "node:test";
import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import { KEY, entry, fixture, provider, until } from "./fixtures/routes.mjs";
import { workroomRoutes } from "./fixtures/workroom-routes.mjs";

const hook = 'route billing: post "/hooks/billing" as service:billing secrets [HOOK_KEY] retry 3 backoff 1s wait 2s\n';
const runs = p => p.inspect("SELECT id, name, state, attempts, error_code, error, result FROM _requests ORDER BY at, id");
const jsonBody = value => Buffer.from(JSON.stringify(value));
const auth = token => ({authorization:`Bearer ${token}`});
const noSuccess = response => assert.ok(response.status >= 400, `${response.status}: ${response.text}`);

test("HMAC sees exact non-UTF8 bytes; unsigned/wrong duplicates cannot admit or collect before or after success", {timeout:hangBudget(8)}, async t => {
  const p = fixture(t, hook, entry(`{billing:{verify, async handle(req, ctx) {
    const bytes = await req.rawBody();
    await save(ctx, createHash("sha256").update(bytes).digest("hex"));
    record("handled", {id:ctx.invocation.id, principal:ctx.principal, hex:Buffer.from(bytes).toString("hex")});
    return new Response(bytes, {status:201, headers:[["x-delivery", req.headers.get("x-delivery") ?? "none"], ["set-cookie", "first=1"], ["set-cookie", "second=2"]]});
  }}}`));
  const f = await p.start();
  const body = Buffer.from([0, 255, 128, 32, 123, 32, 34, 120, 34, 58, 49, 125, 13, 10]);
  const reject = async headers => {
    const before = p.snapshot(), count = p.records("verified").length;
    const response = await f.send("/hooks/billing", body, {headers});
    assert.equal(response.status, 403, response.text + "\n" + f.log());
    assert.equal(response.json.denied.code, "E_ROUTE_VERIFY");
    assert.equal(p.snapshot(), before, "invalid delivery changed data/work/audit before the next request");
    assert.equal(p.records("verified").length, count + 1, "a settled body must still be verified afresh");
    assert.equal(p.records("verified").at(-1).ok, false);
  };
  await reject({}); await reject({"x-signature":"0".repeat(64)});
  assert.equal(runs(p).length, 0); assert.equal(p.records("handled").length, 0);
  const accepted = await f.signed("/hooks/billing", body, {headers:{"x-delivery":"original"}});
  assert.equal(accepted.status, 201, accepted.text + "\n" + f.log()); assert.deepEqual(accepted.bytes, body);
  assert.deepEqual(accepted.headers.getSetCookie(), ["first=1", "second=2"]);
  assert.equal(p.records("handled")[0].principal, "service:billing");
  const after = p.snapshot();
  await reject({}); await reject({"x-signature":"f".repeat(64)});
  const replay = await f.signed("/hooks/billing", body, {headers:{"x-delivery":"new-signature-envelope"}});
  assert.equal(replay.status, 201, replay.text); assert.deepEqual(replay.bytes, body);
  assert.equal(replay.headers.get("x-delivery"), "original", "the first admitted envelope stays frozen");
  assert.equal(p.snapshot(), after); assert.equal(p.records("handled").length, 1);
  assert.equal(runs(p).length, 1); assert.equal(p.inspect("SELECT * FROM r").length, 1);
  for (const verification of p.records("verified")) {
    assert.equal(verification.hex, body.toString("hex"));
    assert.deepEqual(verification.keys, ["secrets", "signal"]); assert.deepEqual(verification.secrets, ["HOOK_KEY"]);
  }
  assert.equal(f.leakedSecret(), false);
});

test("verifier exceptions and non-boolean results remain unavailable without durable admission", {timeout:hangBudget(2)}, async t => {
  const p = fixture(t, `
route broken: post "/hooks/broken" as service:billing secrets [HOOK_KEY] wait 1s
route malformed: post "/hooks/malformed" as service:billing wait 1s
`, entry(`{
  broken:{verify(_, ctx) { throw Error(ctx.secrets.HOOK_KEY); }, handle() { record("forbidden", {}); return new Response(); }},
  malformed:{verify() { return "true" as unknown as boolean; }, handle() { record("forbidden", {}); return new Response(); }},
}`));
  const f = await p.start();
  for (const path of ["/hooks/broken", "/hooks/malformed"]) {
    const before = p.snapshot();
    const response = await f.send(path, Buffer.from("unavailable"));
    assert.equal(response.status, 503, response.text + "\n" + f.log());
    assert.equal(response.json.denied.code, "E_ROUTE_PENDING"); assert.equal(p.snapshot(), before);
  }
  assert.equal(runs(p).length, 0); assert.equal(p.records("forbidden").length, 0);
  assert.equal(f.leakedSecret(), false);
});

test("canonical fixture payment: signed duplicates, out-of-order revisions and durable backlog acknowledgements", {timeout:hangBudget(1)}, workroomRoutes);

function heldEntry() {
  return entry(`{billing:{verify, async handle(req, ctx) {
    record("started", {id:ctx.invocation.id, attempt:ctx.invocation.attempt});
    while (!existsSync(process.cwd() + "/release-handler")) await delay(10);
    await save(ctx, "one durable delivery");
    record("finished", {id:ctx.invocation.id});
    return Response.json({id:ctx.invocation.id, value:"settled"});
  }}}`);
}

test("a pending 503 is followed by a same-body retry collecting the settled response once", {timeout:hangBudget(6)}, async t => {
  const p = fixture(t, hook.replace("wait 2s", "wait 1s"), heldEntry());
  const f = await p.start(), body = Buffer.from("pending-delivery");
  const first = await f.signed("/hooks/billing", body);
  assert.equal(first.status, 503, first.text + "\n" + f.log()); assert.equal(first.json.denied.code, "E_ROUTE_PENDING");
  const started = await until(async () => {
    if (!runs(p).length) await f.signed("/hooks/billing", body);
    return p.records("started")[0];
  }, "admitted handler starts", f.log);
  assert.equal(runs(p).length, 1); p.release("release-handler");
  await until(() => runs(p)[0]?.state === "done", "private route settles after ingress wait", f.log);
  const retry = await f.signed("/hooks/billing", body);
  assert.equal(retry.status, 200, retry.text + "\n" + f.log()); assert.equal(retry.json.id, started.id);
  assert.equal(retry.json.value, "settled"); assert.equal(p.records("started").length, 1);
  assert.equal(p.inspect("SELECT * FROM r").length, 1);
});

test("an explicit 5xx Response retries the same invocation without duplicating its mutation", {timeout:hangBudget(5)}, async t => {
  const p = fixture(t, hook.replace("wait 2s", "wait 250ms"), entry(`{billing:{verify, async handle(_, ctx) {
    const write = await save(ctx, "retry-on-5xx");
    record("attempts", {id:ctx.invocation.id, attempt:ctx.invocation.attempt, write});
    if (ctx.invocation.attempt === 1) return new Response("temporary", {status:503});
    return Response.json({id:ctx.invocation.id, attempt:ctx.invocation.attempt});
  }}}`));
  const f = await p.start(), body = Buffer.from("retry-response");
  const first = await f.signed("/hooks/billing", body); assert.equal(first.status, 503, first.text);
  const row = await until(async () => {
    if (!runs(p).length) await f.signed("/hooks/billing", body);
    const value = runs(p)[0]; return value?.state === "done" ? value : undefined;
  }, "5xx work retries and settles", f.log);
  const retry = await f.signed("/hooks/billing", body);
  assert.equal(retry.status, 200, retry.text + "\n" + f.log()); assert.equal(retry.json.id, row.id); assert.equal(retry.json.attempt, 2);
  const attempts = p.records("attempts"); assert.deepEqual(attempts.map(value => value.attempt), [1, 2]);
  assert.equal(attempts[0].id, attempts[1].id); assert.equal(attempts[1].write.replayed, true);
  assert.equal(Object.hasOwn(attempts[1].write, "result"), false); assert.equal(p.inspect("SELECT * FROM r").length, 1);
});

test("actual worker crashes replay a completed step or reconcile uncertain provider acceptance", {timeout:hangBudget(5)}, async t => {
  const p = fixture(t, hook.replace("[HOOK_KEY]", "[HOOK_KEY, PROVIDER_URL]").replace("wait 2s", "wait 500ms"), entry(`{billing:{verify, async handle(req, ctx) {
    const {mode} = JSON.parse(Buffer.from(await req.rawBody()).toString("utf8")) as {mode:string};
    const write = await save(ctx, mode);
    record("attempts", {id:ctx.invocation.id, mode, attempt:ctx.invocation.attempt, write, pid:process.pid});
    async function contact(key:string, lookup=false):Promise<{value:string}> {
      const response = await fetch(ctx.secrets.PROVIDER_URL + (lookup ? "/lookup?key=" + encodeURIComponent(key) : "/accept"),
        lookup ? {} : {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({key})});
      if (!response.ok) throw Error("provider did not establish an outcome");
      return response.json() as Promise<{value:string}>;
    }
    function crash(stage:string):Promise<never> {
      record("crashes", {id:ctx.invocation.id, mode, pid:process.pid, stage});
      process.kill(process.pid, "SIGKILL"); return new Promise<never>(() => {});
    }
    const result = await ctx.step("provider", {mode}, async key => {
      const receipt = await contact(key);
      if (mode === "uncertain" && ctx.invocation.attempt === 1) return crash("accepted-before-step-record");
      return receipt;
    }, {reconcile:key => contact(key, true)});
    if (mode === "completed" && ctx.invocation.attempt === 1) return crash("step-recorded-before-response");
    return Response.json({id:ctx.invocation.id, attempt:ctx.invocation.attempt, value:result.value});
  }}}`, {lease:1}));
  const remote = await provider(t, p.directory), f = await p.start({env:{PROVIDER_URL:remote.url}});
  for (const mode of ["completed", "uncertain"]) {
    const body = jsonBody({mode}), first = await f.signed("/hooks/billing", body);
    assert.equal(first.status, 503, first.text + "\n" + f.log());
    const result = await until(async () => { const value = await f.signed("/hooks/billing", body); return value.status === 200 ? value : undefined; }, `${mode} step recovers after process death`, f.log);
    assert.equal(result.json.attempt, 2);
    const attempts = p.records("attempts").filter(value => value.mode === mode);
    assert.deepEqual(attempts.map(value => value.attempt), [1, 2]); assert.equal(attempts[0].id, attempts[1].id);
    assert.notEqual(attempts[0].pid, attempts[1].pid); assert.equal(attempts[1].write.replayed, true);
    assert.equal(Object.hasOwn(attempts[1].write, "result"), false);
    assert.ok(f.workerPids().includes(attempts[0].pid), "only this fixture's supervised child killed itself");
    const step = p.inspect("SELECT provider_key, state FROM _action_steps WHERE invocation = ?", result.json.id)[0];
    assert.equal(step.state, "done");
    assert.deepEqual(remote.requests().filter(value => value.key === step.provider_key).map(value => value.method), mode === "completed" ? ["POST"] : ["POST", "GET"]);
    assert.equal(remote.receipts().filter(value => value.key === step.provider_key).length, 1);
  }
  assert.equal(p.records("crashes").length, 2); assert.equal(p.inspect("SELECT * FROM r").length, 2);
});

test("bounded invalid responses are terminal; only application GiveUp acknowledges, never infrastructure or ParkStep", {timeout:hangBudget(4)}, async t => {
  const p = fixture(t, hook, entry(`{billing:{verify, async handle(req, ctx) {
    const mode = Buffer.from(await req.rawBody()).toString("utf8");
    await save(ctx, mode); record("handled", {mode, id:ctx.invocation.id});
    if (mode === "oversize") return new Response(new Uint8Array(65537));
    if (mode === "transport-header") return new Response("x", {headers:{"content-length":"1"}});
    if (mode === "giveup") throw new GiveUp("declined " + ctx.secrets.HOOK_KEY);
    if (mode === "park") throw new ParkStep();
    throw new ServerError("E_SECRET_MISSING", "typed infrastructure failure");
  }}}`));
  const f = await p.start();
  for (const mode of ["oversize", "transport-header", "giveup", "park", "infrastructure"]) {
    const body = Buffer.from(mode), response = await f.signed("/hooks/billing", body);
    assert.equal(response.status, mode === "giveup" ? 204 : 503, response.text + "\n" + f.log());
    if (mode === "giveup") assert.equal(response.bytes.length, 0);
    const id = p.records("handled").find(value => value.mode === mode)?.id;
    const row = runs(p).find(value => value.id === id); assert.ok(row, f.log()); assert.equal(row.attempts, 1);
    if (mode === "oversize" || mode === "transport-header") assert.equal(row.error_code, "E_ROUTE_RESULT");
    assert.equal((await f.signed("/hooks/billing", body)).status, response.status);
    assert.equal(p.records("handled").filter(value => value.mode === mode).length, 1);
    assert.equal(JSON.stringify(row).includes(KEY), false);
  }
  assert.equal(p.inspect("SELECT * FROM r").length, 5);
  assert.deepEqual((await f.post("/actions/claim", {action:"@route/billing", wait:0, lease:1})).requests, [], "terminal output failures are not claimable again");
  assert.equal(f.leakedSecret(), false);
});

test("session routes isolate identical bodies by principal and admitting session family", {timeout:hangBudget(11)}, async t => {
  const p = fixture(t, 'route session: post "/session" wait 2s\n', entry(`{async session(req, ctx) {
    await save(ctx, "session delivery"); record("handled", {id:ctx.invocation.id, principal:ctx.principal});
    return Response.json({id:ctx.invocation.id, principal:ctx.principal});
  }}`));
  const f = await p.start(), body = Buffer.from("same-body");
  const before = p.snapshot(); noSuccess(await f.send("/session", body)); assert.equal(p.snapshot(), before);
  const alice = (await f.post("/auth/session", {principal:"member:alice"})).session;
  const bob = (await f.post("/auth/session", {principal:"member:bob"})).session;
  const a = await f.send("/session", body, {headers:auth(alice.token)}), b = await f.send("/session", body, {headers:auth(bob.token)});
  assert.equal(a.status, 200, a.text); assert.equal(b.status, 200, b.text);
  assert.equal(a.json.principal, "member:alice"); assert.equal(b.json.principal, "member:bob"); assert.notEqual(a.json.id, b.json.id);
  assert.deepEqual((await f.send("/session", body, {headers:auth(alice.token)})).json, a.json);
  await f.post("/auth/logout", {}, alice.token);
  const closed = await f.send("/session", body, {headers:auth(alice.token)}); noSuccess(closed); assert.equal(closed.text.includes(a.json.id), false);
  const fresh = (await f.post("/auth/session", {principal:"member:alice"})).session;
  const replacement = await f.send("/session", body, {headers:auth(fresh.token)});
  assert.equal(replacement.status, 200, replacement.text); assert.notEqual(replacement.json.id, a.json.id);
  assert.equal(p.records("handled").length, 3); assert.equal(p.inspect("SELECT * FROM r").length, 3);
});

test("logout while a session route waits revokes its context before any later write or response", {timeout:hangBudget(6)}, async t => {
  const p = fixture(t, 'route session: post "/session" wait 2s\n', entry(`{async session(_, ctx) {
    record("started", {id:ctx.invocation.id});
    if (!ctx.invocation.signal.aborted) await new Promise<void>(resolve => ctx.invocation.signal.addEventListener("abort", () => resolve(), {once:true}));
    const write = await ctx.mutate(api.record, {body:"must not commit"}); record("ended", {write});
    return new Response("must-not-disclose");
  }}`));
  const f = await p.start(), session = (await f.post("/auth/session", {principal:"member:alice"})).session;
  const pending = f.send("/session", Buffer.from("waiting"), {headers:auth(session.token)});
  await until(() => p.records("started").length, "session route begins", f.log);
  await f.post("/auth/logout", {}, session.token);
  const ended = await until(() => p.records("ended")[0], "logout abort reaches route context", f.log);
  assert.equal(ended.write.state, "failed"); assert.equal(ended.write.why.code, "E_ACTION_AUTHORITY");
  const response = await pending; noSuccess(response); assert.equal(response.text.includes("must-not-disclose"), false);
  assert.equal(p.inspect("SELECT * FROM r").length, 0);
});

test("disconnect after admission does not undo route work or force a new invocation", {timeout:hangBudget(5)}, async t => {
  const p = fixture(t, hook, heldEntry()), f = await p.start(), stop = new AbortController(), body = Buffer.from("disconnect-after-admission");
  const pending = f.signed("/hooks/billing", body, {signal:stop.signal});
  // Observe the rejection immediately, so the deliberate abort cannot become
  // an unhandled promise while the fixture inspects durable completion.
  const disconnected = pending.then(() => false, () => true);
  const started = await until(() => p.records("started")[0], "route is durably admitted before disconnect", f.log);
  stop.abort(); assert.equal(await disconnected, true);
  p.release("release-handler"); await until(() => runs(p)[0]?.state === "done", "disconnected route completes", f.log);
  const replay = await f.signed("/hooks/billing", body);
  assert.equal(replay.status, 200, replay.text + "\n" + f.log()); assert.equal(replay.json.id, started.id);
  assert.equal(p.records("started").length, 1); assert.equal(p.inspect("SELECT * FROM r").length, 1);
});

test("actual non-loopback peers reach declared routes, but not dev personas or old worker/core doors", {timeout:hangBudget(8)}, async t => {
  const ip = Object.values(networkInterfaces()).flat().find(value => value && !value.internal && value.family === "IPv4")?.address;
  if (!ip) { t.skip("no non-loopback IPv4 interface: real peer witness unavailable"); return; }
  const p = fixture(t, hook + 'route session: post "/session" wait 2s\n', entry(`{
    billing:{verify, async handle(req) { return new Response(await req.rawBody()); }},
    async session(_, ctx) { return Response.json({principal:ctx.principal}); },
  }`));
  const f = await p.start({bind:"0.0.0.0"}), origin = `http://${ip}:${f.port}`, body = Buffer.from("foreign-peer");
  const hookReply = await f.signed("/hooks/billing", body, {origin});
  assert.equal(hookReply.status, 200, hookReply.text + "\n" + f.log()); assert.deepEqual(hookReply.bytes, body);
  const before = p.snapshot();
  noSuccess(await f.send("/session", body, {origin, headers:{"x-snapback-persona":"alice"}}));
  assert.equal(p.snapshot(), before, "a remote persona must not admit private work");
  const member = (await f.post("/auth/session", {principal:"member:remote"})).session;
  const sessionReply = await f.send("/session", body, {origin, headers:auth(member.token)});
  assert.equal(sessionReply.status, 200, sessionReply.text); assert.equal(sessionReply.json.principal, "member:remote");
  for (const path of ["/q/mine", "/actions/claim", "/routes/verify/claim", "/auth/session", "/never-declared"]) {
    noSuccess(await f.send(path, jsonBody({routes:["billing"], action:"@route/billing", args:{}}), {origin, headers:{...auth(f.token), "content-type":"application/json"}}));
  }
  noSuccess(await f.send("/schema", undefined, {origin, method:"GET", headers:auth(f.token)}));
  noSuccess(await f.send("/hooks/billing", undefined, {origin, method:"GET"}));
});

test("raw body and header bounds refuse before verification or private work admission", {timeout:hangBudget(3)}, async t => {
  const p = fixture(t, hook, entry(`{billing:{verify, async handle(req) { record("handled", {}); return new Response(await req.rawBody()); }}}`));
  const f = await p.start();
  for (const [body, headers] of [[Buffer.alloc(65537, 255), {}], [Buffer.from("headers"), Object.fromEntries(Array.from({length:80}, (_, i) => [`x-field-${i}`, "value"]))]]) {
    const before = p.snapshot(), verified = p.records("verified").length;
    noSuccess(await f.signed("/hooks/billing", body, {headers}));
    assert.equal(p.snapshot(), before); assert.equal(p.records("verified").length, verified);
  }
  const boundary = Buffer.alloc(65536, 255), accepted = await f.signed("/hooks/billing", boundary);
  assert.equal(accepted.status, 200, accepted.text.slice(0, 500) + "\n" + f.log()); assert.deepEqual(accepted.bytes, boundary);
  assert.equal(p.records("handled").length, 1);
});

test("32 idle actions and 129 service routes still verify and complete the last route", {timeout:hangBudget(3)}, async t => {
  const actions = Array.from({length:32}, (_, i) => `idle${String(i).padStart(3, "0")}`);
  const routes = Array.from({length:129}, (_, i) => `route${String(i).padStart(3, "0")}`);
  const last = routes.at(-1), path = `/hooks/${last}`;
  const schema = actions.map(name => `action ${name}() returns {}\n`).join("")
    + routes.map(name => `route ${name}: post "/hooks/${name}" as service:billing secrets [HOOK_KEY] wait 25s\n`).join("");
  const source = entry(`{${routes.map(name => `${JSON.stringify(name)}:routeHandler`).join(",")}}`, {
    // Long waits expose slot starvation and require bounded chunk rotation.
    wait:25,
    actions:`{${actions.map(name => `${JSON.stringify(name)}:() => { record("unexpected-idle-action", {name:${JSON.stringify(name)}}); return {}; }`).join(",")}}`,
    setup:`const routeHandler = {
      async verify(req:RouteRequest, ctx:VerificationContext<"HOOK_KEY">) {
        const ok = await verify(req, ctx);
        record("registry-verified", {path:req.path, delivery:req.headers.get("x-delivery"), ok});
        return ok;
      },
      async handle(req:RouteRequest, ctx:ServerContext<"HOOK_KEY">) {
        await save(ctx, "last registered route");
        const value = {id:ctx.invocation.id, path:req.path, principal:ctx.principal, delivery:req.headers.get("x-delivery")};
        record("registry-handled", value);
        return Response.json(value);
      },
    };`,
  });
  const p = fixture(t, schema, source), f = await p.start(), body = Buffer.from("large-registry-delivery");
  const first = await f.signed(path, body, {headers:{"x-delivery":"first"}, timeoutMs:hangBudget()});
  assert.equal(first.status, 200, first.text + "\n" + f.log());
  assert.deepEqual(first.json, {id:runs(p)[0]?.id, path, principal:"service:billing", delivery:"first"});
  assert.deepEqual(p.records("registry-verified"), [{path, delivery:"first", ok:true}]);
  assert.deepEqual(p.records("registry-handled"), [first.json]);

  // Collection of an already settled body must reach that last verifier
  // afresh, while retaining the first admitted envelope and outcome.
  const replay = await f.signed(path, body, {headers:{"x-delivery":"replay"}, timeoutMs:hangBudget()});
  assert.equal(replay.status, 200, replay.text + "\n" + f.log()); assert.deepEqual(replay.json, first.json);
  assert.deepEqual(p.records("registry-verified"), [{path, delivery:"first", ok:true}, {path, delivery:"replay", ok:true}]);
  assert.deepEqual(p.records("registry-handled"), [first.json]);
  assert.equal(p.records("unexpected-idle-action").length, 0);
  const work = runs(p); assert.equal(work.length, 1); assert.equal(work[0].name, `@route/${last}`);
  assert.equal(work[0].state, "done"); assert.equal(work[0].attempts, 1);
  assert.equal(p.inspect("SELECT * FROM r").length, 1); assert.equal(f.workerPids().length, 1, f.log());
});
