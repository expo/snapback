import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  __test,
  runDev,
  scaffoldApp,
  spawnManagedRuntime,
} from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY ?? join(packageDir, '..', '..', 'target', 'debug', 'snapback'),
);

assert.equal(__test.portFromUrl('http://127.0.0.1:80'), 80);
assert.equal(__test.portFromUrl('https://127.0.0.1:443'), 443);

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
  throw new Error('could not locate a free loopback range for the dev test');
}

const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-dev-port-range-')));
let dev = null;
let pinnedDev = null;
const attachedHandles = [];
try {
  const project = join(root, 'app');
  const scaffolded = scaffoldApp(project, { template: 'todo-contract' });
  assert.equal(scaffolded.ok ?? true, true, JSON.stringify(scaffolded));
  const range = await reserveFreeRange(4);
  const readyEvents = [];
  const inheritedPosture = process.env.SNAPBACK_DEV_ADMISSION_POSTURE;
  let spawnedEnvironment = null;
  process.env.SNAPBACK_DEV_ADMISSION_POSTURE = 'hostile-ambient-value';
  try {
    dev = await runDev({
      backendDirectory: join(project, 'snapback'),
      projectRoot: project,
      runtimeBinary,
      portRange: `${range.lo}-${range.hi}`,
      watch: false,
      env: process.env,
      serverStdio: ['ignore', 'ignore', 'ignore'],
      spawnManagedRuntime(binary, args, launchOptions) {
        spawnedEnvironment = launchOptions.env;
        return spawnManagedRuntime(binary, args, launchOptions);
      },
      onEvent(event) {
        if (event.state === 'generated-and-loaded') readyEvents.push(event);
      },
    });
  } finally {
    if (inheritedPosture === undefined) {
      delete process.env.SNAPBACK_DEV_ADMISSION_POSTURE;
    } else {
      process.env.SNAPBACK_DEV_ADMISSION_POSTURE = inheritedPosture;
    }
  }
  assert.notEqual(spawnedEnvironment, null, 'managed runtime spawn was inspected');
  assert.equal(
    spawnedEnvironment.SNAPBACK_DEV_ADMISSION_POSTURE,
    'loopback-any',
    'a polluted parent posture must be overwritten by the managed lifecycle owner',
  );
  assert.equal(Object.hasOwn(spawnedEnvironment, 'SNAPBACK_DEV_AUTH_ORIGINS'), false);
  assert.equal(dev.ok, true);
  const backendPort = Number(new URL(dev.serverUrl).port);
  assert.ok(backendPort >= range.lo && backendPort <= range.hi);
  assert.deepEqual(dev.portPlan, {
    range: { ...range, source: 'flag' },
    owners: [{ owner: 'backend', port: backendPort, source: 'range', declaredBy: null }],
  });
  assert.equal(readyEvents.length, 1);
  assert.deepEqual(readyEvents[0].portPlan, dev.portPlan);

  const exhaustedProject = join(root, 'exhausted-app');
  const exhaustedScaffold = scaffoldApp(exhaustedProject, { template: 'todo-contract' });
  assert.equal(exhaustedScaffold.ok ?? true, true, JSON.stringify(exhaustedScaffold));
  const exhaustedRange = await reserveFreeRange(3);
  const holders = [];
  let spawnedChildren = 0;
  try {
    for (let port = exhaustedRange.lo; port <= exhaustedRange.hi; port += 1) {
      const holder = createServer();
      await new Promise((resolveListen, rejectListen) => {
        holder.once('error', rejectListen);
        holder.listen(port, '127.0.0.1', resolveListen);
      });
      holders.push(holder);
    }
    await assert.rejects(
      runDev({
        backendDirectory: join(exhaustedProject, 'snapback'),
        projectRoot: exhaustedProject,
        runtimeBinary,
        portRange: `${exhaustedRange.lo}-${exhaustedRange.hi}`,
        watch: false,
        env: { ...process.env, SNAPBACK_CRON_DISABLED: '1' },
        serverStdio: ['ignore', 'ignore', 'ignore'],
        spawnManagedRuntime() {
          spawnedChildren += 1;
          throw new Error('the exhausted-range pre-scan must run before child spawn');
        },
      }),
      (error) => {
        assert.equal(error?.code, 'SNAPBACK_DEV_PORT_RANGE_EXHAUSTED');
        assert.equal(error?.diagnostic?.details?.owner, 'backend');
        assert.deepEqual(error?.diagnostic?.details?.range, exhaustedRange);
        assert.equal(error?.diagnostic?.details?.holders?.length, 3);
        return true;
      },
    );
    assert.equal(spawnedChildren, 0);
    assert.equal(existsSync(join(exhaustedProject, '.snapback', 'dev.ready.json')), false);
  } finally {
    await Promise.all(holders.map((holder) => (
      new Promise((resolveClose) => holder.close(resolveClose))
    )));
  }

  const attachedProject = join(root, 'attached-app');
  const attachedScaffold = scaffoldApp(attachedProject, { template: 'todo-contract' });
  assert.equal(attachedScaffold.ok ?? true, true, JSON.stringify(attachedScaffold));
  const attachedPort = (await reserveFreeRange(1)).lo;
  const attachedBackend = join(attachedProject, 'snapback');
  const attachedOptions = {
    backendDirectory: attachedBackend,
    projectRoot: attachedProject,
    runtimeBinary,
    watch: false,
    env: { ...process.env, SNAPBACK_CRON_DISABLED: '1' },
    serverStdio: ['ignore', 'ignore', 'ignore'],
  };
  pinnedDev = await runDev({ ...attachedOptions, port: attachedPort });
  assert.equal(pinnedDev.managed, true);

  const exactDeclaredRange = `${attachedPort}-${attachedPort}`;
  const explicitInRange = await runDev({
    ...attachedOptions,
    attach: true,
    portRange: exactDeclaredRange,
  });
  attachedHandles.push(explicitInRange);
  assert.equal(explicitInRange.managed, false);
  assert.deepEqual(explicitInRange.portPlan.owners, [
    { owner: 'backend', port: attachedPort, source: 'attached', declaredBy: null },
  ]);
  await explicitInRange.close();
  attachedHandles.pop();

  const automaticInRange = await runDev({
    ...attachedOptions,
    portRange: exactDeclaredRange,
  });
  attachedHandles.push(automaticInRange);
  assert.equal(automaticInRange.managed, false);
  assert.equal(automaticInRange.portPlan.owners[0].source, 'attached');
  await automaticInRange.close();
  attachedHandles.pop();

  const outsideRange = `${attachedPort - 2}-${attachedPort - 1}`;
  for (const attachCase of [
    { attach: true, portRange: outsideRange },
    {
      attach: false,
      env: {
        ...attachedOptions.env,
        SNAPBACK_DEV_PORT_RANGE: outsideRange,
      },
    },
  ]) {
    await assert.rejects(
      runDev({
        ...attachedOptions,
        ...attachCase,
      }),
      (error) => {
        assert.equal(error?.code, 'SNAPBACK_DEV_ATTACH_PORT_OUT_OF_RANGE');
        assert.equal(error?.diagnostic?.details?.port, attachedPort);
        assert.deepEqual(error?.diagnostic?.details?.range, {
          lo: attachedPort - 2,
          hi: attachedPort - 1,
        });
        return true;
      },
    );
  }

  const defaultRangeAttach = await runDev(attachedOptions);
  attachedHandles.push(defaultRangeAttach);
  assert.equal(defaultRangeAttach.managed, false);
  assert.equal(defaultRangeAttach.portPlan.range.source, 'default');
  assert.equal(defaultRangeAttach.portPlan.owners[0].source, 'attached');
  assert.equal(defaultRangeAttach.portPlan.owners[0].port, attachedPort);
  await defaultRangeAttach.close();
  attachedHandles.pop();

  console.log('dev-port-range.test.mjs: 7 ranged backend, exhaustion-before-spawn, and explicit/automatic attach provenance cases passed');
} finally {
  await Promise.all(attachedHandles.map((handle) => handle.close?.()));
  await pinnedDev?.close?.();
  await dev?.close?.();
  rmSync(root, { recursive: true, force: true });
}
