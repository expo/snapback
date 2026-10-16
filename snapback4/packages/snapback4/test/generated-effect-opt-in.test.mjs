import { hangBudget } from './helpers/wait.mjs';
// Compiler-to-runtime acceptance: an effect-only application needs no server directive.
import test from "node:test";
import { startServer } from "../dist/server.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");

test("effect-only generated handler keeps secrets, steps, retry, cancellation and authority loss", { timeout: hangBudget(6) }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-effect-only-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "snapback"));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(join(root, "packages/snapback4"), join(dir, "node_modules/snapback4"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  const source = `effect mail secrets [MAIL_KEY] retry 3 backoff 1s deadline 1h cancellation allow
mutation send():
  emit mail { to: 'member@example.test' }
`;
  assert.doesNotMatch(source, /use server/);
  writeFileSync(join(dir, "snapback/schema.q"), source);
  const checked = spawnSync(binary, ["check", "--json"], { cwd: dir, encoding: "utf8", timeout: hangBudget() });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.equal(JSON.parse(checked.stdout).ok, true);
  assert.doesNotMatch(readFileSync(join(dir, "snapback/generated/api.ts"), "utf8"), /\b(?:Action|Route)\b/);
  const { server, manifest } = await import(pathToFileURL(join(dir, "snapback/generated/server.ts")).href);
  assert.deepEqual(manifest.actions, {});
  assert.deepEqual(manifest.routes, {});
  // The manifest carries the digest of this structured WorkSpec, in Rust's
  // declaration order; every policy field must survive compilation unchanged.
  const declaration = {
    secrets: ["MAIL_KEY"],
    policy: { max_attempts: 3, backoff_ms: 1_000, deadline_ms: 3_600_000, cancellable: true },
  };
  const contract = createHash("sha256").update(JSON.stringify(["effect-payload:generic-value:v1", "mail", declaration])).digest("hex");
  assert.deepEqual(manifest.effects.mail, { contract, secrets: declaration.secrets });

  // The generated module and production runtime run against a protocol double.
  for (const mode of ["retry", "cancel", "authority", "contract-mismatch"]) await t.test(mode, async () => {
    const stop = new AbortController(), paths = [], errors = [], attempts = [], observations = [], statusCodes = [], steps = new Map();
    let claims = 0, failures = 0, providerCalls = 0, settled = 0, handlerCalls = 0;
    const worker = server(startServer, { effects: { async mail(payload, ctx) {
      handlerCalls++;
      assert.deepEqual(payload, { to: "member@example.test" });
      assert.deepEqual(Object.keys(ctx.secrets), ["MAIL_KEY"]);
      assert.equal(ctx.secrets.MAIL_KEY, "fixture-secret");
      for (const name of ["query", "mutate", "principal", "writeIdFor"]) assert.equal(name in ctx, false);
      attempts.push(ctx.invocation.attempt);
      if (mode !== "retry") {
        const { signal } = ctx.invocation;
        if (!signal.aborted) await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
        observations.push({ aborted: signal.aborted, cancelled: ctx.invocation.cancelled,
          code: signal.reason?.refusal?.code, attempt: ctx.invocation.attempt, deadline: ctx.invocation.deadline });
        stop.abort();
        return "must not settle";
      }
      const receipt = await ctx.step("send", payload, key => {
        providerCalls++;
        assert.equal(key, "stable-provider-key");
        return { delivered: true };
      });
      assert.deepEqual(receipt, { delivered: true });
      if (ctx.invocation.attempt === 1) throw Error("retry after the durable step");
      return receipt;
    } } }, {
      url: "http://effect-only.test", token: "service-fixture", env: { MAIL_KEY: "fixture-secret", OTHER_KEY: "inaccessible" },
      signal: stop.signal, wait: 0, statusIntervalMs: 1, onError: error => errors.push(error),
      fetch: async (url, init) => {
        const path = new URL(url).pathname, body = JSON.parse(init.body); paths.push(path);
        assert.equal(init.headers.authorization, "Bearer service-fixture");
        if (path === "/effects/claim") {
          assert.equal(body.declarationContract, manifest.effects.mail.contract);
          assert.equal(body.fenced, true);
          assert.equal(body.effect, "mail");
          assert.ok(++claims <= (mode === "retry" ? 2 : 1), "no repoll after loss or settlement");
          return Response.json({ effects: [{ id: "mail-1", effect: "mail", payload: { to: "member@example.test" },
            attempt: claims, seq: 1, at: 10, deadline: 3_600_010, leaseToken: `lease-${claims}`,
            declarationContract: mode === "contract-mismatch" ? "a-different-declaration" : manifest.effects.mail.contract }] });
        }
        assert.equal(init.headers["x-snapback-effect-lease"], `lease-${claims}`);
        if (path.endsWith("/status")) {
          const response = mode === "authority"
            ? Response.json({ denied: { code: "E_AUTH", family: "auth", message: "service authority revoked" } }, { status: 401 })
            : Response.json({ id: "mail-1", attempt: claims, state: mode === "cancel" ? "failed" : "running",
              cancelled: mode === "cancel", ...(mode === "cancel" ? { errorCode: "E_EFFECT_CANCELLED" } : {}) });
          statusCodes.push(response.status);
          return response;
        }
        if (path.endsWith("/steps/send/begin")) return Response.json({ step: steps.has("send")
          ? { state: "done", key: "stable-provider-key", result: steps.get("send") }
          : { state: "run", key: "stable-provider-key" } });
        if (path.endsWith("/steps/send/done")) { steps.set("send", body.result); return Response.json({ ok: true }); }
        if (path.endsWith("/failed")) { failures++; assert.equal(body.retry, true); return Response.json({ ok: true }); }
        if (path.endsWith("/done")) { settled++; queueMicrotask(() => stop.abort()); return Response.json({ ok: true }); }
        throw Error(`unexpected effect-only request ${path}`);
      },
    });
    t.after(() => stop.abort());
    if (mode === "contract-mismatch") await assert.rejects(worker.done, /E_EFFECT_GENERATION/);
    // Status authority loss reports through onError; after our stop, done resolves.
    // Only generation loss (including a mismatched claim) rejects done here.
    else await assert.doesNotReject(worker.done);
    assert.ok(paths.every(path => path.startsWith("/effects/")));
    if (mode === "retry") {
      assert.deepEqual(attempts, [1, 2]);
      assert.equal(providerCalls, 1, "the second attempt reuses its completed durable step");
      assert.equal(failures, 1); assert.equal(settled, 1); assert.deepEqual(errors, []);
    } else {
      assert.equal(failures, 0); assert.equal(settled, 0); assert.equal(claims, 1);
      assert.equal(paths.some(path => path.endsWith("/done") || path.endsWith("/failed")), false);
      if (mode === "contract-mismatch") {
        assert.equal(handlerCalls, 0);
        assert.deepEqual(paths, ["/effects/claim"]);
        assert.deepEqual(observations, []);
        assert.deepEqual(errors.map(error => error.message), ["E_EFFECT_GENERATION: claimed effect mail-1 did not match generated declaration mail"]);
      } else {
        assert.equal(handlerCalls, 1);
        assert.deepEqual(attempts, [1]);
        assert.deepEqual(observations, [{ aborted: true, cancelled: mode === "cancel",
          code: mode === "cancel" ? "E_EFFECT_CANCELLED" : "E_AUTH", attempt: 1, deadline: 3_600_010 }]);
        assert.deepEqual(statusCodes, [mode === "authority" ? 401 : 200]);
        assert.deepEqual(errors.map(error => error.message), [mode === "cancel"
          ? "E_EFFECT_CANCELLED: the effect was cancelled" : "E_AUTH: service authority revoked"]);
      }
    }
  });
});
