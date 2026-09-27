import test from "node:test";
import assert from "node:assert/strict";
import { approvalOracle } from "./helpers/approval-oracle.mjs";

async function start(m) {
  const first = m.open(), peer = m.open();
  m.complete(m.pending.find(gate => gate.record === first)); await m.settle();
  m.complete(m.pending.find(gate => gate.record === peer)); await m.settle();
  m.publish();
  m.complete(m.pending.find(gate => gate.record === first)); await m.settle();
  m.complete(m.pending.find(gate => gate.record === peer)); await m.settle();
  return [first, peer];
}

for (const keep of [undefined, false, true]) {
  test(`oracle requires same-answer recovery for every live facade, keep=${keep}`, async t => {
    const m = approvalOracle(t, keep), [first, peer] = await start(m);
    m.publish();
    m.complete(m.pending.find(gate => gate.record === first), "refused B"); await m.settle();
    m.complete(m.pending.find(gate => gate.record === peer)); await m.settle();
    const recovering = m.open();
    m.complete(m.pending.find(gate => gate.record === recovering)); await m.settle();
    m.complete(m.pending.find(gate => gate.record === recovering)); await m.settle();
  });

  test(`oracle rejects an older success after a closed opening succeeds, keep=${keep}`, async t => {
    const m = approvalOracle(t, keep), [first, peer] = await start(m);
    m.publish();
    const old = m.pending.find(gate => gate.record === peer);
    m.complete(m.pending.find(gate => gate.record === first), "refused B"); await m.settle();
    const closed = m.open(), opening = m.pending.find(gate => gate.record === closed);
    m.close(closed); m.complete(opening); await m.settle();
    m.complete(old); await m.settle();
  });

  for (const beforeOwner of [false, true]) test(`oracle requires retired opening denial (peer attachment=${beforeOwner}), keep=${keep}`, async t => {
    const m = approvalOracle(t, keep), first = m.open();
    let opening;
    if (beforeOwner) opening = m.open();
    m.complete(m.pending.find(gate => gate.record === first)); await m.settle();
    m.publish(); m.complete(m.pending.find(gate => gate.record === first)); await m.settle();
    if (!beforeOwner) opening = m.open();
    m.close(first); if (keep) m.expireLinger(); await m.settle();
    m.complete(m.pending.find(gate => gate.record === opening), "retired opening failed"); await m.settle();
  });

  test(`oracle fences pending approval before completion, keep=${keep}`, async t => {
    const m = approvalOracle(t, keep); await start(m);
    m.publish(); const gates = [...m.pending];
    m.fence(); await m.settle();
    for (const gate of gates) m.complete(gate);
    await m.settle();
  });

  test(`oracle separates retired and recreated raw owners, keep=${keep}`, async t => {
    const m = approvalOracle(t, keep), first = await start(m);
    m.publish(); const old = [...m.pending];
    first.forEach(record => m.close(record));
    if (keep) m.expireLinger();
    await m.settle();
    await start(m);
    m.complete(old[0], "retired owner refuses");
    m.complete(old[1]); await m.settle();
  });

  test(`oracle validates every callback in batched completions, keep=${keep}`, async t => {
    const m = approvalOracle(t, keep), [first, peer] = await start(m);
    for (const order of ["success-first", "refusal-first", "two-refusals"]) {
      m.publish();
      const a = m.pending.find(gate => gate.record === first), b = m.pending.find(gate => gate.record === peer);
      m.complete(a, order === "success-first" ? undefined : `${order} A`);
      m.complete(b, order === "refusal-first" ? undefined : `${order} B`);
      await m.settle();
    }
  });

  for (const newestFirst of [false, true]) test(`oracle ignores superseded refusal (newest first=${newestFirst}), keep=${keep}`, async t => {
    const m = approvalOracle(t, keep), [first] = await start(m);
    m.publish(); const old = m.pending.find(gate => gate.record === first);
    m.publish(); const latest = m.pending.filter(gate => gate.record === first).at(-1);
    if (newestFirst) { m.complete(latest); await m.settle(); }
    m.complete(old, "obsolete refusal"); await m.settle();
    if (!newestFirst) { m.complete(latest); await m.settle(); }
  });

  test(`oracle preserves recovery across duplicate opening denial, keep=${keep}`, async t => {
    const m = approvalOracle(t, keep), [first] = await start(m);
    m.publish(); const remount = m.open(), opening = m.pending.find(gate => gate.record === remount);
    m.complete(m.pending.find(gate => gate.record === first), "replacement refused"); await m.settle();
    m.recheck(); const recovery = m.pending.filter(gate => gate.record === first).at(-1);
    m.complete(opening, "opening refused"); await m.settle();
    m.complete(recovery); await m.settle();
  });

  test(`oracle isolates a closed opening that never associated, keep=${keep}`, async t => {
    const m = approvalOracle(t, keep), closed = m.open(), opening = m.pending[0];
    m.close(closed); await m.settle(); await start(m);
    m.complete(opening, "unassociated refusal"); await m.settle();
  });

  test(`oracle isolates a closed opening of a retired owner, keep=${keep}`, async t => {
    const m = approvalOracle(t, keep), sources = await start(m), closed = m.open();
    const opening = m.pending.find(gate => gate.record === closed);
    m.close(closed); sources.forEach(record => m.close(record));
    if (keep) m.expireLinger(); await m.settle(); await start(m);
    m.complete(opening, "retired opening refusal"); await m.settle();
  });

  test(`oracle preserves closed loading across raw denial, keep=${keep}`, async t => {
    const m = approvalOracle(t, keep), [closed] = await start(m);
    m.close(closed); m.publish(); await m.settle();
    m.sourceDenial(); await m.settle();
  });

  test(`seeded independent shared approval oracle, keep=${keep}`, async t => {
    const coverage = new Map();
    for (let seed = 1; seed <= 60; seed++) await t.test(`seed ${seed}`, async t => {
      const m = approvalOracle(t, keep);
      let random = seed;
      const pick = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % n; };
      let [anchor] = await start(m);
      for (let step = 0; step < 240; step++) {
        if (step === 120) {
          for (const record of m.records) if (!record.closed) m.close(record);
          if (keep) m.expireLinger();
          await m.settle();
          [anchor] = await start(m);
          coverage.set("recreate-owner", (coverage.get("recreate-owner") ?? 0) + 1);
        }
        const live = m.records.filter(record => !record.closed && record !== anchor);
        const choices = ["publish", "publish-device", "reload", "reset", "recheck", "source-denial", "open", "host", "server", "device", "rollback"];
        if (m.pending.length) choices.push("approve", "approve", "reject", "batch");
        if (live.length) choices.push("close");
        const action = choices[pick(choices.length)];
        coverage.set(action, (coverage.get(action) ?? 0) + 1);
        m.trace.push(`step ${step} ${action}`);
        if (action === "open") m.open();
        if (action.startsWith("publish")) {
          const clock = action === "publish-device" ? "device" : "server";
          m.publish({ [clock]: m.clocks()[clock] + 1 + pick(2200) });
        }
        if (action === "approve" || action === "reject")
          m.complete(m.pending[pick(m.pending.length)], action === "reject" ? `refusal ${step}` : undefined);
        if (action === "batch") {
          const count = Math.min(m.pending.length, 2 + pick(3));
          for (let i = 0; i < count; i++) m.complete(m.pending[pick(m.pending.length)], pick(3) === 0 ? `batch ${step}.${i}` : undefined);
          if (count > 1) coverage.set("several-completions", (coverage.get("several-completions") ?? 0) + 1);
        }
        if (action === "close") m.close(live[pick(live.length)]);
        if (action === "reload") m.reload();
        if (action === "reset") m.reset();
        if (action === "recheck") m.recheck();
        if (action === "source-denial") m.sourceDenial();
        if (["host", "server", "device"].includes(action)) m.time(action, 1 + pick(1200), !!pick(2));
        if (action === "rollback") {
          m.time("host", -(1 + pick(1200))); m.time("server", -(1 + pick(1200)));
        }
        await m.settle();
      }
      // Every seed ends with this ordering, rather than hoping random selection
      // happens to leave an eligible check pending at the irreversible fence.
      m.publish(); const pending = [...m.pending];
      assert.ok(pending.length > 0);
      m.fence(); await m.settle();
      coverage.set("fence", (coverage.get("fence") ?? 0) + 1);
      for (const gate of pending) m.complete(gate);
      await m.settle();
      coverage.set("complete-after-fence", (coverage.get("complete-after-fence") ?? 0) + 1);
    });
    for (const action of ["publish", "publish-device", "approve", "reject", "batch", "several-completions", "open", "close",
      "host", "server", "device", "rollback", "reload", "reset", "recheck", "source-denial", "recreate-owner", "fence", "complete-after-fence"])
      assert.ok(coverage.get(action) > 0, `${action} is exercised`);
  });
}
