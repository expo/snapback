#!/usr/bin/env node

// @ref LLP 0050#all-aboard-no-subscriber-idle-evidence-2026-07-1112 — Recompute the
// closeout artifact's timing, raw totals, controls, and evidence limitations.

import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

const artifactPath =
  process.argv[2] ?? 'targets/cloudflare/generated/measurements.remote.idle.2026-07-12.json';

let checkCount = 0;
function check(condition, message) {
  checkCount += 1;
  if (!condition) throw new Error(message);
}

function sum(rows, pick) {
  return rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
}

function summarize(read) {
  const periodic = read.datasets.durableObjectPeriodic;
  const storage = read.datasets.durableObjectStorage;
  return {
    workerRequests: sum(read.datasets.workersInvocations, (row) => row.sum?.requests),
    workerDurationGbS: sum(read.datasets.workersInvocations, (row) => row.sum?.duration),
    durableObjectRequests: sum(read.datasets.durableObjectInvocations, (row) => row.sum?.requests),
    durableObjectActiveTimeUs: sum(periodic, (row) => row.sum?.activeTime),
    durableObjectCpuTimeUs: sum(periodic, (row) => row.sum?.cpuTime),
    websocketMessagesIn: sum(periodic, (row) => row.sum?.inboundWebsocketMsgCount),
    websocketMessagesOut: sum(periodic, (row) => row.sum?.outboundWebsocketMsgCount),
    storageReadUnits: sum(periodic, (row) => row.sum?.storageReadUnits),
    storageWriteUnits: sum(periodic, (row) => row.sum?.storageWriteUnits),
    maxStoredBytes: Math.max(0, ...storage.map((row) => row.max?.storedBytes ?? 0)),
    datasetErrors: read.errors,
  };
}

function secondsBetween(startISO, endISO) {
  const seconds = (Date.parse(endISO) - Date.parse(startISO)) / 1000;
  check(Number.isFinite(seconds), `invalid timestamp pair: ${startISO} / ${endISO}`);
  return seconds;
}

function names(rows) {
  return [...new Set(rows.map((row) => row.dimensions?.scriptName).filter(Boolean))].sort();
}

try {
  const source = await readFile(artifactPath, 'utf8');
  const artifact = JSON.parse(source);

  check(artifact.artifactKind === 'cloudflareAllAboardIdleMeasurement', 'unexpected artifactKind');
  check(artifact.artifactVersion === 1, 'unexpected artifactVersion');
  check(artifact.surface === 'real-cloudflare', 'artifact is not real-Cloudflare evidence');
  check(artifact.method.jobName === 'warmPoll', 'unexpected scheduler job');
  check(
    artifact.statusEvidence.reset?.result?.reset === true &&
      artifact.statusEvidence.reset?.result?.seeded === true,
    'reset result is missing or unsuccessful'
  );

  const expectedScripts = [...artifact.target.scripts].sort();
  check(expectedScripts.length === 3, 'expected exactly three deployed scripts');
  check(
    isDeepStrictEqual(names(artifact.target.deployedVersions.map((version) => ({
      dimensions: { scriptName: version.script },
    }))), expectedScripts),
    'deployed-version coverage does not match the target scripts'
  );
  check(
    artifact.target.deployedVersions.every((version) => version.versionId && version.sourceCommit === null),
    'deployed versions must retain version IDs and an explicit unknown source commit'
  );
  check(
    Number.isFinite(Date.parse(artifact.target.versionListing?.readAtISO)) &&
      artifact.target.versionListing?.wranglerVersion === '4.110.0' &&
      artifact.target.versionListing?.commandTemplates?.length === 3,
    'deployed-version reader provenance is incomplete'
  );

  const observations = artifact.statusEvidence.zeroDemandObservations;
  check(observations.length >= 5, 'too few retained zero-demand observations');
  check(
    observations.every(
      (observation) =>
        observation.activation?.state === 'inactive:no-demand' &&
        observation.activation?.demand === 0 &&
        observation.nextRun === null &&
        observation.lastRun === null
    ),
    'a retained pre-window observation is not fully disarmed'
  );
  check(
    artifact.statusEvidence.disarmBoundaryAtISO === observations.at(-1).observedAtISO,
    'disarm boundary does not match the final retained zero-demand observation'
  );
  const post = artifact.statusEvidence.postWindowObservation;
  check(
    post.activation?.state === 'inactive:no-demand' &&
      post.activation?.demand === 0 &&
      post.nextRun === null &&
      post.lastRun === null,
    'the retained post-window observation is not fully disarmed'
  );
  check(
    artifact.publicLivenessWitness.queryOk === true &&
      artifact.publicLivenessWitness.refreshOk === true &&
      artifact.publicLivenessWitness.stationCount === 21 &&
      artifact.publicLivenessWitness.refreshResultSource === '511-siri-stop-monitoring',
    'public liveness witness is incomplete'
  );

  const { preControl, quiet, postControl } = artifact.billingEvidence;
  for (const [label, window] of Object.entries({ preControl, quiet, postControl })) {
    check(
      isDeepStrictEqual([...window.window.scripts].sort(), expectedScripts),
      `${label} script filter does not match the deployed scripts`
    );
    for (const form of ['aggregate', 'hourly']) {
      const read = window[form];
      check(isDeepStrictEqual(read.errors, []), `${label}.${form} contains dataset errors`);
      check(
        isDeepStrictEqual(read.summary, summarize(read)),
        `${label}.${form} raw rows do not reconcile to the stored summary`
      );
    }
    check(
      isDeepStrictEqual(window.aggregate.summary, window.hourly.summary),
      `${label} aggregate and hourly summaries differ`
    );
  }

  check(
    Object.values(quiet.aggregate.datasets).every((rows) => rows.length === 0) &&
      Object.values(quiet.hourly.datasets).every((rows) => rows.length === 0),
    'quiet-window raw datasets are not empty'
  );
  check(
    quiet.aggregate.summary.workerRequests === 0 &&
      quiet.aggregate.summary.workerDurationGbS === 0 &&
      quiet.aggregate.summary.durableObjectRequests === 0 &&
      quiet.aggregate.summary.durableObjectActiveTimeUs === 0,
    'quiet-window request, execution, or account-wide active-time estimate is nonzero'
  );
  check(
    isDeepStrictEqual(artifact.interpretation.derivedQuietTotals, {
      estimatedWorkerRequests: 0,
      estimatedWorkerExecutionGbS: 0,
      estimatedDurableObjectRequests: 0,
      observedAccountWideDurableObjectActiveTimeUs: 0,
    }),
    'interpreted quiet totals do not match the validated zero estimates'
  );
  check(
    preControl.aggregate.summary.workerRequests > 0 &&
      preControl.aggregate.summary.durableObjectRequests > 0 &&
      preControl.aggregate.summary.durableObjectActiveTimeUs > 0 &&
      postControl.aggregate.summary.workerRequests > 0 &&
      postControl.aggregate.summary.durableObjectRequests > 0 &&
      postControl.aggregate.summary.durableObjectActiveTimeUs > 0,
    'a request or periodic positive control is missing'
  );

  const workerControlNames = names([
    ...preControl.aggregate.datasets.workersInvocations,
    ...postControl.aggregate.datasets.workersInvocations,
  ]);
  const durableObjectControlNames = names([
    ...preControl.aggregate.datasets.durableObjectInvocations,
    ...postControl.aggregate.datasets.durableObjectInvocations,
  ]);
  check(
    isDeepStrictEqual(workerControlNames, [artifact.target.scripts[0]]),
    'Worker controls must cover only the gateway as documented'
  );
  check(
    isDeepStrictEqual(durableObjectControlNames, expectedScripts),
    'Durable Object request controls do not cover all deployed scripts'
  );
  check(
    isDeepStrictEqual([...new Set([...workerControlNames, ...durableObjectControlNames])].sort(), expectedScripts),
    'the script-attributed control union is incomplete'
  );
  check(
    [preControl, quiet, postControl].every(
      (window) =>
        window.aggregate.datasets.durableObjectStorage.length === 0 &&
        window.hourly.datasets.durableObjectStorage.length === 0
    ),
    'storage unexpectedly has a positive row; revisit the telemetry-absence caveat'
  );

  const quietSeconds = secondsBetween(quiet.window.start, quiet.window.end);
  check(quietSeconds === 7200, `quiet window is ${quietSeconds}s, expected 7200s`);
  check(
    artifact.method.quietWindowDurationSeconds === quietSeconds,
    'stored quiet-window duration does not match its timestamps'
  );
  check(
    secondsBetween(artifact.statusEvidence.disarmBoundaryAtISO, quiet.window.start) === 300,
    'post-disarm guard is not 300s'
  );
  check(
    secondsBetween(quiet.window.end, post.observedAtISO) === 123,
    'post-window probe fence is not 123s'
  );
  check(
    secondsBetween(quiet.window.end, artifact.method.finalQuietReadAtISO) === 3954,
    'final quiet read settlement delay is not 3954s'
  );

  const sampling = artifact.method.sampling.sampleIntervalProbe;
  check(
    Number.isFinite(Date.parse(sampling.readAtISO)) &&
      sampling.reader?.endpoint === 'https://api.cloudflare.com/client/v4/graphql' &&
      sampling.reader?.queryTemplate?.includes('avg { sampleInterval }'),
    'sample-interval reader provenance is incomplete'
  );
  check(
    sampling.quiet.workersInvocationsAdaptive.length === 0 &&
      sampling.quiet.durableObjectsInvocationsAdaptiveGroups.length === 0,
    'quiet sampling probe unexpectedly has rows; retain their intervals if so'
  );
  check(
    sampling.preControl.window.start === preControl.window.start &&
      sampling.preControl.window.end === preControl.window.end &&
      sampling.quiet.window.start === quiet.window.start &&
      sampling.quiet.window.end === quiet.window.end &&
      sampling.postControl.window.start === postControl.window.start &&
      sampling.postControl.window.end === postControl.window.end,
    'sample-interval probe windows do not match the retained billing windows'
  );
  check(
    sampling.preControl.durableObjectsInvocationsAdaptiveGroups.some(
      (row) => row.sampleInterval > 1
    ) &&
      sampling.postControl.durableObjectsInvocationsAdaptiveGroups.some(
        (row) => row.sampleInterval > 1
      ),
    'sampled control rows are missing; revisit estimate terminology'
  );
  check(
    /observed zero estimate/.test(artifact.method.sampling.quietWindowLimitation) &&
      /no positive storage control/.test(artifact.interpretation.storageTelemetryCaveat),
    'sampling or storage evidence limitation is missing'
  );

  check(!/\/Users\/|\.agent-local-secrets/.test(source), 'private locator found');
  check(!/cf(?:at|ut)_[A-Za-z0-9_-]{20,}/.test(source), 'Cloudflare token literal found');
  check(!/\b[0-9a-f]{48,64}\b/i.test(source), 'token-shaped hex literal found');

  console.log(`validate-idle-measurement: ok — ${checkCount} checks`);
} catch (error) {
  console.error(`validate-idle-measurement: FAILED — ${error.message}`);
  process.exitCode = 1;
}
