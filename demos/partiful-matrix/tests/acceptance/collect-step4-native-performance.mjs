#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateNativePerformanceCollectionResult } from './native-performance-collection-result.mjs';

// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — paired
// native calibration and holdout reverse framework order on every sample,
// preserve two warmups plus seven observations, and publish raw receipts only
// after every sample attests the same host and v2 release lane.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const demoRoot = resolve(here, '../..');
const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
};
const quick = process.argv.includes('--quick');
const cohort = option('cohort') ?? 'calibration';
assert(['calibration', 'holdout'].includes(cohort), '--cohort must be calibration or holdout');
const exactRoot = resolve(
  option('exact-root')
    ?? process.env.EXACT_ROOT
    ?? resolve(repoRoot, '../exact'),
);
const deviceId = option('device')
  ?? process.env.PARTITIME_IOS_DEVICE
  ?? 'E0E49A2F-54A7-4355-8EB4-D52138E3361B';
const calibrationRevision = option('calibration-revision');
if (cohort === 'holdout' && !quick) {
  assert.match(
    calibrationRevision ?? '',
    /^[a-f0-9]{40}$/,
    'holdout requires --calibration-revision <committed sha>',
  );
}
const receiptCount = quick ? 1 : 9;
const scratch = mkdtempSync(resolve(tmpdir(), `partitime-native-${cohort}-`));
const publishRoot = resolve(
  option('out-root')
    ?? (quick
      ? scratch
      : resolve(demoRoot, 'acceptance/results')),
);
const rawRoot = resolve(publishRoot, `step4-native-performance-${cohort}-raw`);
const inputPath = resolve(
  publishRoot,
  `step4-native-performance-${cohort}-inputs.json`,
);
const aggregatePath = resolve(
  publishRoot,
  `step4-native-performance-${cohort}.json`,
);
const scratchRaw = resolve(scratch, 'raw');
mkdirSync(scratchRaw, { recursive: true });
if (!quick) {
  for (const path of [rawRoot, inputPath, aggregatePath]) {
    assert(!existsSync(path), `refusing to overwrite native performance evidence ${path}`);
  }
}

const reactReceipts = [];
const exactReceipts = [];
const pairOrder = [];
let hostIdentity = null;
try {
  for (let index = 0; index < receiptCount; index += 1) {
    const order = index % 2 === 0
      ? ['react', 'exact']
      : ['exact', 'react'];
    pairOrder.push(order.join('-then-'));
    for (const framework of order) {
      const number = String(index + 1).padStart(2, '0');
      const path = resolve(scratchRaw, `${framework}-${number}.json`);
      process.stderr.write(
        `[partitime-native-performance] ${cohort} pair ${index + 1}/${receiptCount} `
          + `${framework} (${order.join('-then-')})\n`,
      );
      if (framework === 'react') {
        await runChecked(process.execPath, [
          resolve(here, 'native-react-expo.mjs'),
          '--platform', 'ios',
          '--performance-only',
          '--receipt', path,
        ], {
          cwd: repoRoot,
          env: {
            ...process.env,
            PARTITIME_IOS_DEVICE: deviceId,
          },
          timeoutMs: 1_800_000,
        });
        reactReceipts.push(path);
      } else {
        await runChecked(process.execPath, [
          resolve(here, 'native-exact-performance.mjs'),
          ...(quick ? ['--quick'] : []),
          '--exact-root', exactRoot,
          '--device', deviceId,
          '--receipt', path,
        ], {
          cwd: repoRoot,
          env: {
            ...process.env,
            PARTITIME_IOS_DEVICE: deviceId,
            EXACT_ROOT: exactRoot,
          },
          timeoutMs: 1_800_000,
        });
        exactReceipts.push(path);
      }
      const receipt = JSON.parse(readFileSync(path, 'utf8'));
      assert.equal(receipt.ok, true, `${framework} receipt ${number} is red`);
      assert.equal(
        receipt.performance?.sample?.definitionVersion,
        'partitime.native-launch-stage.v2',
        `${framework} receipt ${number} did not use the v2 launch method`,
      );
      if (framework === 'exact') {
        assert.equal(
          receipt.observer?.build?.featureBound,
          true,
          `Exact receipt ${number} did not bind the observer feature`,
        );
        assert.deepEqual(
          receipt.performance?.sample?.candidateObserver?.runtimeMarkers,
          {
            ibexAuthenticatedSubstitution: true,
            ibexLoopbackFetchSubstituted: true,
            ibexPostureVerified: true,
            exactObserverEnabled: true,
            exactObserverRuntimeCreated: true,
            exactCarrierDispatchInstalled: true,
          },
          `Exact receipt ${number} omitted an observer runtime marker`,
        );
      }
      if (hostIdentity === null) hostIdentity = receipt.environment;
      assert.deepEqual(
        receipt.environment,
        hostIdentity,
        `${framework} receipt ${number} was captured on a different host`,
      );
    }
  }

  assert(hostIdentity, 'native collection produced no host identity');
  assert.equal(reactReceipts.length, receiptCount);
  assert.equal(exactReceipts.length, receiptCount);
  mkdirSync(rawRoot, { recursive: true });
  const publish = (paths, framework) => paths.map((source, index) => {
    const destination = resolve(
      rawRoot,
      `${framework}-${String(index + 1).padStart(2, '0')}.json`,
    );
    copyFileSync(source, destination);
    return relative(dirname(inputPath), destination);
  });
  const inputs = {
    schemaVersion: 'partitime.native-performance-inputs.v1',
    platform: 'ios',
    cohort,
    recordedAt: new Date().toISOString(),
    samplePlan: {
      warmups: quick ? 0 : 2,
      samples: quick ? 1 : 7,
      pairedReceipts: receiptCount,
      order: pairOrder,
      cacheProtocol:
        'Each receipt performs an in-process incremental Release rebuild; app termination '
        + 'precedes launch; framework order reverses on every pair.',
    },
    hostIdentity,
    react: {
      hostIdentity,
      receipts: publish(reactReceipts, 'react'),
    },
    exact: {
      hostIdentity,
      receipts: publish(exactReceipts, 'exact'),
    },
  };
  mkdirSync(dirname(inputPath), { recursive: true });
  writeFileSync(inputPath, `${JSON.stringify(inputs, null, 2)}\n`);

  await runChecked(process.execPath, [
    resolve(here, 'step4-native-performance.mjs'),
    ...(quick ? ['--quick'] : []),
    '--cohort', cohort,
    '--inputs', inputPath,
    '--out', aggregatePath,
    ...(cohort === 'holdout' && !quick
      ? ['--calibration-revision', calibrationRevision]
      : []),
  ], {
    cwd: repoRoot,
    timeoutMs: 120_000,
  });

  const aggregate = JSON.parse(readFileSync(aggregatePath, 'utf8'));
  validateNativePerformanceCollectionResult(aggregate, { cohort, quick });
  console.log(JSON.stringify({
    ok: true,
    cohort,
    quick,
    verdict: aggregate.outcome,
    inputs: inputPath,
    aggregate: aggregatePath,
    rawReceipts: {
      react: reactReceipts.length,
      exact: exactReceipts.length,
    },
    hostIdentity,
  }));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  console.error(JSON.stringify({
    ok: false,
    cohort,
    quick,
    scratch,
    publishRoot,
  }));
  process.exitCode = 1;
} finally {
  if (!quick && process.exitCode !== 1) {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function runChecked(command, args, { cwd, env = process.env, timeoutMs }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const text = chunk.toString();
      if (text.includes('SETUP FAILURE') || text.includes('FAIL ')) {
        process.stderr.write(text);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, timeoutMs);
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      if (status === 0) {
        resolveRun({ status, signal, stdout, stderr });
        return;
      }
      rejectRun(new Error(
        `${command} ${args.join(' ')} exited ${status ?? signal}: `
          + `${stderr.slice(-5000)}\n${stdout.slice(-5000)}`,
      ));
    });
  });
}
