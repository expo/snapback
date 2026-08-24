import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { __test, runExpoDev } from './expo-dev.mjs';
import { resolveDevPortPlan } from './port-plan.mjs';

async function reserveFreeRange(width) {
  for (let lo = 46_000; lo <= 60_000 - width; lo += width) {
    const servers = [];
    try {
      for (let port = lo; port < lo + width; port += 1) {
        const server = createServer();
        await new Promise((resolveListen, rejectListen) => {
          server.once('error', rejectListen);
          server.listen(port, '127.0.0.1', resolveListen);
        });
        servers.push(server);
      }
      await Promise.all(servers.map((server) => new Promise((resolveClose) => server.close(resolveClose))));
      return { lo, hi: lo + width - 1 };
    } catch {
      await Promise.all(servers.map((server) => new Promise((resolveClose) => server.close(resolveClose))));
    }
  }
  throw new Error('could not locate a free loopback range');
}

const root = mkdtempSync(join(tmpdir(), 'snapback-port-refusal-'));
const holder = createServer();
await new Promise((resolveListen, rejectListen) => {
  holder.once('error', rejectListen);
  holder.listen(0, '127.0.0.1', resolveListen);
});
const port = holder.address().port;
try {
  await assert.rejects(runExpoDev({
    platform: 'web',
    projectRoot: root,
    backendDirectory: join(root, 'snapback'),
    expoDirectory: root,
    clientPort: port,
    env: { ...process.env },
  }), (error) => {
    assert.equal(error?.code, 'SNAPBACK_DEV_PORT_UNAVAILABLE');
    assert.equal(error?.diagnostic?.details?.owner, 'client');
    assert.equal(error?.diagnostic?.details?.port, port);
    assert.equal(error?.diagnostic?.details?.holder?.pid, process.pid);
    return true;
  });

  await assert.rejects(runExpoDev({
    platform: 'web',
    projectRoot: join(root, 'metro-unavailable'),
    backendDirectory: join(root, 'metro-unavailable', 'snapback'),
    expoDirectory: join(root, 'metro-unavailable'),
    metroProcessPort: port,
    env: { ...process.env },
  }), (error) => {
    assert.equal(error?.diagnostic?.details?.owner, 'metro');
    assert.equal(
      error?.diagnostic?.details?.recovery,
      `stop or reconfigure the process holding 127.0.0.1:${port}, or choose a different --port-range (metro has no pin flag)`,
    );
    return true;
  });

  const range = await reserveFreeRange(8);
  const plan = resolveDevPortPlan({
    profile: 'expo',
    platform: 'web',
    flags: { portRange: `${range.lo}-${range.hi}` },
  });
  const allocation = await __test.allocateSupervisorPortCandidates(plan);
  try {
    assert.deepEqual(
      allocation.assigned,
      { client: range.hi, bootstrap: range.hi - 1, metro: range.hi - 2 },
    );
  } finally {
    await allocation.close();
  }
  const reservedListeners = await __test.bindPlannedSupervisorListeners({
    plan,
    platform: 'web',
    attestation: { serve: () => false },
    getBootstrapPayload: async () => null,
    onControl: async () => ({ statusCode: 503, body: { ok: false } }),
    onDevIdentityCheckout: () => null,
  });
  try {
    assert.equal(
      reservedListeners.metroFront.upstreamOrigin,
      `http://127.0.0.1:${reservedListeners.metroProcessPort}`,
    );
    const contender = createServer();
    await assert.rejects(
      new Promise((resolveListen, rejectListen) => {
        contender.once('error', rejectListen);
        contender.listen(reservedListeners.metroProcessPort, '127.0.0.1', resolveListen);
      }),
      (error) => error?.code === 'EADDRINUSE',
    );
  } finally {
    await reservedListeners.close();
  }

  const exhaustedRange = await reserveFreeRange(4);
  const rangeHolders = [];
  try {
    for (let heldPort = exhaustedRange.lo; heldPort <= exhaustedRange.hi; heldPort += 1) {
      const rangeHolder = createServer();
      await new Promise((resolveListen, rejectListen) => {
        rangeHolder.once('error', rejectListen);
        rangeHolder.listen(heldPort, '127.0.0.1', resolveListen);
      });
      rangeHolders.push(rangeHolder);
    }
    const exhaustedPlan = resolveDevPortPlan({
      profile: 'expo',
      platform: 'web',
      flags: { portRange: `${exhaustedRange.lo}-${exhaustedRange.hi}` },
    });
    await assert.rejects(
      __test.bindPlannedSupervisorListeners({
        plan: exhaustedPlan,
        platform: 'web',
        attestation: { serve: () => false },
        getBootstrapPayload: async () => null,
        onControl: async () => ({ statusCode: 503, body: { ok: false } }),
        onDevIdentityCheckout: () => null,
      }),
      (error) => {
        assert.equal(error?.code, 'SNAPBACK_DEV_PORT_RANGE_EXHAUSTED');
        assert.equal(error?.diagnostic?.details?.owner, 'client');
        assert.deepEqual(error?.diagnostic?.details?.range, exhaustedRange);
        assert.deepEqual(
          error?.diagnostic?.details?.holders?.map(({ port: heldPort, pid }) => ({ port: heldPort, pid })),
          [exhaustedRange.hi, exhaustedRange.hi - 1, exhaustedRange.hi - 2, exhaustedRange.lo]
            .map((heldPort) => ({ port: heldPort, pid: process.pid })),
        );
        return true;
      },
    );
  } finally {
    await Promise.all(rangeHolders.map((server) => (
      new Promise((resolveClose) => server.close(resolveClose))
    )));
  }
  const exhaustedRebound = [];
  try {
    for (let reboundPort = exhaustedRange.lo; reboundPort <= exhaustedRange.hi; reboundPort += 1) {
      const server = createServer();
      await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(reboundPort, '127.0.0.1', resolveListen);
      });
      exhaustedRebound.push(server);
    }
  } finally {
    await Promise.all(exhaustedRebound.map((server) => (
      new Promise((resolveClose) => server.close(resolveClose))
    )));
  }

  const ownerFailureRange = await reserveFreeRange(3);
  const ownerFailureHolders = [];
  const ownerFailureBindings = [];
  try {
    for (const heldPort of [ownerFailureRange.hi - 1, ownerFailureRange.hi - 2]) {
      const rangeHolder = createServer();
      await new Promise((resolveListen, rejectListen) => {
        rangeHolder.once('error', rejectListen);
        rangeHolder.listen(heldPort, '127.0.0.1', resolveListen);
      });
      ownerFailureHolders.push(rangeHolder);
    }
    const ownerFailurePlan = resolveDevPortPlan({
      profile: 'expo',
      platform: 'web',
      flags: {
        port: ownerFailureRange.lo - 1,
        portRange: `${ownerFailureRange.lo}-${ownerFailureRange.hi}`,
      },
    });
    await assert.rejects(
      __test.bindPlannedSupervisorListeners({
        plan: ownerFailurePlan,
        platform: 'web',
        attestation: { serve: () => false },
        getBootstrapPayload: async () => null,
        onControl: async () => ({ statusCode: 503, body: { ok: false } }),
        onDevIdentityCheckout: () => null,
        afterOwnerBound(owner, boundPort) {
          ownerFailureBindings.push({ owner, port: boundPort });
        },
      }),
      (error) => {
        assert.equal(error?.code, 'SNAPBACK_DEV_PORT_RANGE_EXHAUSTED');
        assert.equal(error?.diagnostic?.details?.owner, 'bootstrap');
        assert.deepEqual(error?.diagnostic?.details?.range, ownerFailureRange);
        assert.deepEqual(
          error?.diagnostic?.details?.holders?.map(({ port: heldPort, pid }) => ({ port: heldPort, pid })),
          [ownerFailureRange.hi - 1, ownerFailureRange.hi - 2]
            .map((heldPort) => ({ port: heldPort, pid: process.pid })),
        );
        return true;
      },
    );
    assert.deepEqual(ownerFailureBindings, [
      { owner: 'client', port: ownerFailureRange.hi },
    ]);
    const reboundClient = createServer();
    await new Promise((resolveListen, rejectListen) => {
      reboundClient.once('error', rejectListen);
      reboundClient.listen(ownerFailureRange.hi, '127.0.0.1', resolveListen);
    });
    await new Promise((resolveClose) => reboundClient.close(resolveClose));
  } finally {
    await Promise.all(ownerFailureHolders.map((server) => (
      new Promise((resolveClose) => server.close(resolveClose))
    )));
  }

  const abortPorts = await reserveFreeRange(2);
  const controller = new AbortController();
  await assert.rejects(
    runExpoDev({
      platform: 'web',
      projectRoot: join(root, 'abort-allocation'),
      backendDirectory: join(root, 'abort-allocation', 'snapback'),
      expoDirectory: join(root, 'abort-allocation'),
      clientPort: abortPorts.lo,
      bootstrapPort: abortPorts.hi,
      signal: controller.signal,
      env: { ...process.env },
      afterSupervisorOwnerBound(owner) {
        if (owner === 'bootstrap') controller.abort(new Error('abort during listener allocation'));
      },
    }),
    /abort during listener allocation/u,
  );
  const rebound = [];
  try {
    for (const reboundPort of [abortPorts.lo, abortPorts.hi]) {
      const server = createServer();
      await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(reboundPort, '127.0.0.1', resolveListen);
      });
      rebound.push(server);
    }
  } finally {
    await Promise.all(rebound.map((server) => (
      new Promise((resolveClose) => server.close(resolveClose))
    )));
  }
  console.log('expo-port-refusal.test.mjs: 7 occupied-pin/Metro recovery, held allocation/placeholder, real-bind exhaustion ownership, and abort-cleanup cases passed');
} finally {
  await new Promise((resolveClose) => holder.close(resolveClose));
  rmSync(root, { recursive: true, force: true });
}
