import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateJsonSchema } from './lib/json-schema.mjs';
import {
  AGENTS_FILE,
  FIRST_EDIT_MARKER_FILE,
  INSTRUMENT_LINK,
  LANE_REPORT_FILE,
  MAX_LANE_STEERING_BYTES,
  OFF_ALLOWLIST_SKILL_CODE,
  ORIENTATION_FILE,
  analyzePreM1Events,
  createFirstProductEditMarker,
  generateLaneSetup,
  preflightSelectedSkills,
  resolveInstrumentArtifacts,
} from './lane-setup.mjs';
import { CURRENT_CHOREOGRAPHY_VERSION } from './social-messenger/metering/manifest.mjs';
import { CURRENT_INSTRUMENT_PIN } from './social-messenger/metering/observations.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SKILL_SOURCE = join(ROOT, 'skills/snapback-authoring/SKILL.md');

function provisionRun(prefix = 'snapback-lane-setup-') {
  const runRoot = mkdtempSync(join(tmpdir(), prefix));
  const instrumentRoot = join(runRoot, 'instrument');
  const skillPath = join(runRoot, 'skill/SKILL.md');
  cpSync(join(ROOT, 'benchmarks'), instrumentRoot, { recursive: true });
  mkdirSync(join(runRoot, 'skill'), { recursive: true });
  cpSync(SKILL_SOURCE, skillPath);
  return { runRoot, instrumentRoot, skillPath };
}

function setupOptions(run, overrides = {}) {
  return {
    laneDir: join(run.runRoot, 'lanes/sol-high-clique-explicit-r01'),
    laneId: 'sol-high-clique-explicit-r01',
    laneKind: 'snapback-web-clique',
    instrumentRoot: run.instrumentRoot,
    profile: 'snapback-explicit-v1',
    milestones: ['M1', 'M2', 'M3'],
    backendPin: '@expo/snapback-*@0.1.24',
    instrumentPin: 'social-messenger@0.3.8-m8',
    selectedSkills: ['snapback-authoring'],
    skillCarriers: [{ skillId: 'snapback-authoring', path: run.skillPath }],
    ...overrides,
  };
}

function generatedFiles(laneDir, files = [AGENTS_FILE, ORIENTATION_FILE, LANE_REPORT_FILE]) {
  return Object.fromEntries(files.map((file) => [file, readFileSync(join(laneDir, file), 'utf8')]));
}

function meteringDigest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

test('lane setup verifies the frozen manifest and never falls back to live source', () => {
  const run = provisionRun();
  const artifacts = resolveInstrumentArtifacts({
    instrumentRoot: run.instrumentRoot,
    instrumentPin: 'social-messenger@0.3.8-m8',
  });
  assert.deepEqual(artifacts.manifest.versions, {
    schema: '0.3.0-m8',
    ui: '0.3.3-m8',
    choreography: '0.3.8-m8',
  });
  assert.equal(artifacts.manifest.instrumentPin, CURRENT_INSTRUMENT_PIN);
  assert.equal(artifacts.manifest.versions.choreography, CURRENT_CHOREOGRAPHY_VERSION);
  assert.equal(artifacts.assertions.logicalPath, 'schema/social-messenger/assertions.json');
  assert.equal(
    artifacts.runRecordExtensionSchema.logicalPath,
    'schema/social-messenger/run-record-extension.schema.json',
  );
  assert.equal(artifacts.meteringRoot.logicalPath, 'tools/social-messenger/metering');
  assert.equal(artifacts.observabilityRoot.logicalPath, 'tools/social-messenger/observability');

  rmSync(join(run.instrumentRoot, 'schema/social-messenger/assertions.json'));
  assert.throws(
    () => generateLaneSetup(setupOptions(run)),
    /does not resolve within the frozen instrument snapshot/,
  );

  const versionRun = provisionRun();
  const manifestPath = join(versionRun.instrumentRoot, 'instrument.manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.versions.choreography = '0.3.2-m7';
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(
    () => generateLaneSetup(setupOptions(versionRun)),
    /choreography VERSION mismatch/,
  );

  const digestRun = provisionRun();
  writeFileSync(join(digestRun.instrumentRoot, 'briefs/social-messenger.md'), 'tampered\n');
  assert.throws(
    () => generateLaneSetup(setupOptions(digestRun)),
    /artifact brief digest mismatch/,
  );
});

test('lane setup refuses a plan pin different from social-messenger@0.3.8-m8', () => {
  const run = provisionRun();
  assert.throws(
    () => resolveInstrumentArtifacts({
      instrumentRoot: run.instrumentRoot,
      instrumentPin: 'social-messenger@wrong',
    }),
    /instrument pin mismatch/,
  );
});

test('lane setup emits deterministic bounded steering with the full skill body inventoried', () => {
  const run = provisionRun();
  const options = setupOptions(run);
  const first = generateLaneSetup(options);
  const before = generatedFiles(options.laneDir, first.files);
  const second = generateLaneSetup(options);
  const after = generatedFiles(options.laneDir, second.files);

  assert.deepEqual(after, before);
  assert.deepEqual(first.files, [AGENTS_FILE, ORIENTATION_FILE, LANE_REPORT_FILE]);
  assert.ok(first.orientation.deliveredBytes <= MAX_LANE_STEERING_BYTES);
  assert.equal(first.orientation.uniqueBytes, first.orientation.deliveredBytes);
  assert.deepEqual(first.orientation.selectedSkills, ['snapback-authoring']);

  const skillCarrier = first.orientation.artifacts.find(({ kind }) => kind === 'skill-body');
  assert.equal(skillCarrier.bytes, readFileSync(SKILL_SOURCE).byteLength);
  assert.match(skillCarrier.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(skillCarrier.deduplicated, false);
  assert.equal(first.orientation.artifacts.length, 3);
  assert.equal(first.orientation.laneKind, 'snapback-web-clique');
  assert.equal(first.orientation.instrument.pin, 'social-messenger@0.3.8-m8');

  const agents = before[AGENTS_FILE];
  assert.match(agents, /Web-only Expo Router Clique benchmark/);
  assert.match(agents, /two-browser-context interaction proof/);
  assert.match(agents, /skill allowlist is: `snapback-authoring`/);

  const orientation = before[ORIENTATION_FILE];
  assert.match(orientation, /lane-local/);
  assert.match(orientation, /\(instrument\/briefs\/social-messenger\.md\)/);
  assert.match(orientation, /\| M1 \| Accounts and profiles \| 7 \| 3 \| 3 \| 0 \|/);
  assert.match(orientation, /starter-m1\.log/);
  assert.match(orientation, /firstProductEdit/);
  assert.match(orientation, /harness-native/);

  const report = JSON.parse(before[LANE_REPORT_FILE]);
  assert.deepEqual(report.orientation.preflightWarnings, []);
  assert.deepEqual(report.firstProductEdit.orientationTokens, {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
  });
  assert.deepEqual(
    createFirstProductEditMarker(
      report.orientation,
      '2026-08-21T12:34:56.000Z',
      'sol-high-clique-explicit-r01',
    ),
    {
      laneRunId: 'sol-high-clique-explicit-r01',
      at: '2026-08-21T12:34:56.000Z',
      orientationBytes: first.orientation.deliveredBytes,
      selectedSkills: ['snapback-authoring'],
    },
  );
});

test('lane setup represents the full continuous journey without inventing starter segments', () => {
  const run = provisionRun();
  const options = setupOptions(run, {
    laneId: 'sol-clique-full-r01',
    laneDir: join(run.runRoot, 'lanes/sol-clique-full-r01'),
    milestones: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M8'],
  });

  generateLaneSetup(options);
  const agents = readFileSync(join(options.laneDir, AGENTS_FILE), 'utf8');
  const orientation = readFileSync(join(options.laneDir, ORIENTATION_FILE), 'utf8');

  assert.match(agents, /milestones M1, M2, M3, M4, M5, M6, M8/u);
  assert.match(orientation, /Build Clique for `M1`, `M2`, `M3`, `M4`, `M5`, `M6`, `M8`, in order/u);
  assert.match(orientation, /M4, M5, M6, M8 have no separate starter logs/u);
  assert.match(orientation, /continue from the M3 state/u);
  assert.doesNotMatch(orientation, /starter-m4\.log/u);
  for (const milestone of ['m1', 'm2', 'm3']) {
    assert.match(orientation, new RegExp(`starter-${milestone}\\.log`, 'u'));
  }
  for (const milestone of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M8']) {
    assert.match(orientation, new RegExp(`\\| ${milestone} \\|`, 'u'));
  }

  const missingCanonical = provisionRun('snapback-lane-setup-missing-starter-');
  rmSync(join(missingCanonical.instrumentRoot, 'fixtures/social-messenger/starter-m2.log'));
  assert.throws(
    () => generateLaneSetup(setupOptions(missingCanonical, {
      milestones: ['M1', 'M2', 'M3'],
    })),
    /instrument artifact fixtureRoot digest mismatch|instrument child is missing.*starter-m2\.log/u,
  );

  const orphanContinuation = provisionRun('snapback-lane-setup-orphan-continuation-');
  assert.throws(
    () => generateLaneSetup(setupOptions(orphanContinuation, {
      milestones: ['M4'],
    })),
    /continuation milestone M4 requires preceding milestones.*M3/u,
  );
});

test('lane kind is explicit and renders matching web, native-simulator, and competitor instructions', () => {
  const run = provisionRun();
  assert.throws(
    () => generateLaneSetup(setupOptions(run, { laneKind: undefined })),
    /laneKind is required/,
  );

  const native = setupOptions(run, {
    laneDir: join(run.runRoot, 'lanes/native'),
    laneId: 'native',
    laneKind: 'snapback-native-simulator',
  });
  generateLaneSetup(native);
  const nativeFiles = generatedFiles(native.laneDir);
  assert.match(nativeFiles[AGENTS_FILE], /Native-carrier Clique/);
  assert.match(nativeFiles[AGENTS_FILE], /xcrun simctl/);
  assert.doesNotMatch(nativeFiles[AGENTS_FILE], /Web-only Expo Router Clique/);
  assert.match(nativeFiles[ORIENTATION_FILE], /native iOS Simulator lane/);
  assert.match(nativeFiles[ORIENTATION_FILE], /simulator\.md/);

  const competitor = setupOptions(run, {
    laneDir: join(run.runRoot, 'lanes/competitor'),
    laneId: 'competitor',
    laneKind: 'competitor-web',
    profile: 'convex-web-v1',
    backendPin: 'convex@1.26.2',
    selectedSkills: [],
    skillCarriers: [],
  });
  generateLaneSetup(competitor);
  const competitorFiles = generatedFiles(competitor.laneDir);
  assert.match(competitorFiles[AGENTS_FILE], /competitor-control benchmark/);
  assert.match(competitorFiles[AGENTS_FILE], /Convex profile/);
  assert.doesNotMatch(competitorFiles[AGENTS_FILE], /Snapback profile/);
  assert.match(competitorFiles[ORIENTATION_FILE], /Backend\/profile: Convex/);
  assert.doesNotMatch(competitorFiles[ORIENTATION_FILE], /Backend\/profile: Snapback/);
});

test('steering inventory deduplicates identical carriers and enforces the true aggregate cap', () => {
  const duplicateRun = provisionRun();
  const duplicate = generateLaneSetup(setupOptions(duplicateRun, {
    skillCarriers: [
      { skillId: 'snapback-authoring', path: duplicateRun.skillPath },
      { skillId: 'snapback-authoring', path: duplicateRun.skillPath },
    ],
  }));
  const skillCarriers = duplicate.orientation.artifacts.filter(({ kind }) => kind === 'skill-body');
  assert.equal(skillCarriers.length, 2);
  assert.deepEqual(skillCarriers.map(({ deduplicated }) => deduplicated), [false, true]);
  assert.equal(
    duplicate.orientation.deliveredBytes,
    duplicate.orientation.artifacts.filter(({ deduplicated }) => !deduplicated)
      .reduce((sum, { bytes }) => sum + bytes, 0),
  );

  const capRun = provisionRun();
  const secondBody = join(capRun.runRoot, 'skill/SECOND.md');
  writeFileSync(secondBody, 'x'.repeat(10_000));
  assert.throws(
    () => generateLaneSetup(setupOptions(capRun, {
      skillCarriers: [
        { skillId: 'snapback-authoring', path: capRun.skillPath },
        { skillId: 'snapback-authoring', path: secondBody, logicalPath: 'skills/snapback-authoring/SECOND.md' },
      ],
    })),
    /lane steering is .* maximum is 16384/,
  );
});

test('generated artifacts are byte-identical after relocating an equivalent run tree', () => {
  const left = provisionRun('snapback-relocation-left-');
  const right = provisionRun('snapback-relocation-right-');
  const leftOptions = setupOptions(left, { laneDir: join(left.runRoot, 'lanes/lane'), laneId: 'relocation-lane' });
  const rightOptions = setupOptions(right, { laneDir: join(right.runRoot, 'lanes/lane'), laneId: 'relocation-lane' });
  generateLaneSetup(leftOptions);
  generateLaneSetup(rightOptions);

  assert.deepEqual(generatedFiles(leftOptions.laneDir), generatedFiles(rightOptions.laneDir));
  assert.doesNotMatch(readFileSync(join(leftOptions.laneDir, ORIENTATION_FILE), 'utf8'), new RegExp(left.runRoot));
  assert.doesNotMatch(readFileSync(join(rightOptions.laneDir, ORIENTATION_FILE), 'utf8'), new RegExp(right.runRoot));
});

test('orientation bytes and hashes are identical across shallow and nested lane layouts', () => {
  const run = provisionRun('snapback-cross-layout-');
  const shallow = setupOptions(run, {
    laneDir: join(run.runRoot, 'lanes/layout-lane'),
    laneId: 'layout-lane',
  });
  const nested = setupOptions(run, {
    laneDir: join(run.runRoot, 'work/lanes/layout-lane'),
    laneId: 'layout-lane',
  });
  generateLaneSetup(shallow);
  generateLaneSetup(nested);

  assert.deepEqual(generatedFiles(shallow.laneDir), generatedFiles(nested.laneDir));
  const shallowReport = JSON.parse(readFileSync(join(shallow.laneDir, LANE_REPORT_FILE), 'utf8'));
  const nestedReport = JSON.parse(readFileSync(join(nested.laneDir, LANE_REPORT_FILE), 'utf8'));
  assert.equal(shallowReport.orientation.deliveredBytes, nestedReport.orientation.deliveredBytes);
  assert.deepEqual(
    shallowReport.orientation.artifacts.map(({ sha256 }) => sha256),
    nestedReport.orientation.artifacts.map(({ sha256 }) => sha256),
  );
  for (const laneDir of [shallow.laneDir, nested.laneDir]) {
    const linkPath = join(laneDir, INSTRUMENT_LINK);
    assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
    assert.equal(realpathSync(linkPath), realpathSync(run.instrumentRoot));
  }
});

test('preflight uses registered metadata, the allowlist, and the explicit marker timestamp', () => {
  assert.deepEqual(
    preflightSelectedSkills(['native-delivery'], { allowedSkillIds: ['native-delivery'] }),
    [],
  );
  assert.deepEqual(
    preflightSelectedSkills(['ios-device-build'], { allowedSkillIds: ['snapback-authoring'] })
      .map(({ code, skill }) => ({ code, skill })),
    [{ code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_DEVICE_EAS_SKILL', skill: 'ios-device-build' }],
  );
  assert.deepEqual(
    preflightSelectedSkills(['an-unregistered-native-delivery-name'], { allowedSkillIds: [] }),
    [],
  );
  assert.deepEqual(
    preflightSelectedSkills(['snapback-authoring'], {
      allowedSkillIds: [],
      laneKind: 'competitor-web',
    }).map(({ code, skill }) => ({ code, skill })),
    [{ code: OFF_ALLOWLIST_SKILL_CODE, skill: 'snapback-authoring' }],
  );

  const events = [
    {
      at: '2026-08-21T12:00:00.000Z',
      type: 'item.completed',
      item: { type: 'file_change', changes: [{ path: 'app/index.tsx', kind: 'add' }] },
    },
    {
      at: '2026-08-21T12:00:01.000Z',
      type: 'skill.loaded',
      skill: 'ios-device-build',
    },
    {
      at: '2026-08-21T12:00:03.000Z',
      type: 'skill.loaded',
      skill: 'tuft-app-builder',
    },
  ];
  const result = analyzePreM1Events(events, {
    firstEditAt: '2026-08-21T12:00:02.000Z',
    allowedSkillIds: ['snapback-authoring'],
    laneKind: 'snapback-web-clique',
  });
  assert.deepEqual(result.selectedSkills, ['ios-device-build']);
  assert.deepEqual(result.firstProductEdit, {
    at: '2026-08-21T12:00:02.000Z',
    source: 'explicit-marker',
  });
  assert.deepEqual(result.warnings.map(({ skill }) => skill), ['ios-device-build']);
});

test('deterministic preflight join retains detected warnings in lane-report.json', () => {
  const run = provisionRun();
  const options = setupOptions(run);
  generateLaneSetup(options);
  const reportPath = join(options.laneDir, LANE_REPORT_FILE);
  const marker = createFirstProductEditMarker(
    JSON.parse(readFileSync(reportPath, 'utf8')).orientation,
    '2026-08-21T12:00:02.000Z',
    options.laneId,
  );
  writeFileSync(join(options.laneDir, FIRST_EDIT_MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`);
  const eventsPath = join(run.runRoot, 'events.jsonl');
  writeFileSync(eventsPath, `${JSON.stringify({
    at: '2026-08-21T12:00:01.000Z',
    type: 'skill.loaded',
    skill: 'expo-app-delivery',
  })}\n`);
  const command = [
    join(ROOT, 'benchmarks/tools/lane-setup.mjs'),
    'preflight',
    '--lane-dir', options.laneDir,
    '--lane-report', reportPath,
    '--first-edit-marker', join(options.laneDir, FIRST_EDIT_MARKER_FILE),
    '--events', eventsPath,
  ];
  const first = spawnSync(process.execPath, command, { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_DEVICE_EAS_SKILL/);
  const once = readFileSync(reportPath, 'utf8');
  const second = spawnSync(process.execPath, command, { encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  const twice = readFileSync(reportPath, 'utf8');
  assert.equal(twice, once);
  assert.deepEqual(
    JSON.parse(twice).orientation.preflightWarnings.map(({ skill }) => skill),
    ['expo-app-delivery'],
  );
});

test('stamped first-edit marker round-trips through the meter manifest handshake', () => {
  const run = provisionRun();
  const options = setupOptions(run);
  generateLaneSetup(options);
  const reportPath = join(options.laneDir, LANE_REPORT_FILE);
  const stamp = spawnSync(process.execPath, [
    join(ROOT, 'benchmarks/tools/lane-setup.mjs'),
    'mark-first-edit',
    '--lane-report', reportPath,
    '--lane-id', options.laneId,
    '--at', '2026-08-21T12:00:02.000Z',
  ], { encoding: 'utf8' });
  assert.equal(stamp.status, 0, stamp.stderr);

  const markerPath = join(options.laneDir, FIRST_EDIT_MARKER_FILE);
  const markerText = readFileSync(markerPath, 'utf8');
  const boundariesPath = join(options.laneDir, 'metering-boundaries.json');
  const boundariesText = `${JSON.stringify({
    laneRunId: options.laneId,
    driverId: 'lane-setup-round-trip-driver',
    milestones: {
      M1: {
        status: 'aborted',
        authoring: {
          suitePassAt: null,
          choreoPassAt: null,
          firstGreenAt: null,
          terminalAt: '2026-08-21T12:00:03.000Z',
          terminalSequence: 1,
          terminalReason: 'abort',
        },
      },
    },
  }, null, 2)}\n`;
  writeFileSync(boundariesPath, boundariesText);
  const manifestPath = join(options.laneDir, 'metering-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify({
    manifestVersion: 'social-messenger-metering-manifest.v1',
    laneRunId: options.laneId,
    capFamily: 'gpt-frontier',
    adapter: 'unavailable',
    unavailableReason: 'round-trip-fixture-has-no-native-stream',
    driver: {
      id: 'lane-setup-round-trip-driver',
      stampedAt: '2026-08-21T12:00:04.000Z',
      startedAt: '2026-08-21T12:00:00.000Z',
    },
    clockCorrelation: {
      method: 'rfc3339-with-bounded-skew',
      maxSkewMillis: 0,
      evidence: 'one fixture process and clock stamps marker and boundaries',
    },
    sessions: [],
    receipts: [],
    boundaries: {
      path: 'metering-boundaries.json',
      sha256: meteringDigest(boundariesText),
    },
    firstProductEdit: {
      path: FIRST_EDIT_MARKER_FILE,
      sha256: meteringDigest(markerText),
    },
  }, null, 2)}\n`);

  const meter = spawnSync(process.execPath, [
    join(ROOT, 'benchmarks/tools/social-messenger/metering/meter.mjs'),
    '--manifest', manifestPath,
  ], { encoding: 'utf8' });
  assert.equal(meter.status, 0, meter.stderr);
  const metering = JSON.parse(meter.stdout);
  assert.deepEqual(metering.firstProductEdit, {
    at: '2026-08-21T12:00:02.000Z',
    orientationBytes: JSON.parse(readFileSync(reportPath, 'utf8')).orientation.deliveredBytes,
    orientationTokens: {
      input: null,
      output: null,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    },
    selectedSkills: ['snapback-authoring'],
  });
  assert.equal(metering.meteringProvenance.laneRunId, options.laneId);
  assert.deepEqual(metering.meteringProvenance.firstProductEdit, {
    path: FIRST_EDIT_MARKER_FILE,
    sha256: meteringDigest(markerText),
  });
  assert.equal(
    Object.hasOwn(metering.firstProductEdit, 'laneRunId'),
    false,
  );
});

test('social-messenger schema resolves local refs and requires the joiner five-counter shape', () => {
  const schema = JSON.parse(readFileSync(
    join(ROOT, 'benchmarks/schema/social-messenger/run-record-extension.schema.json'),
    'utf8',
  ));
  assert.equal(schema.required.includes('orientation'), false);
  assert.equal(schema.required.includes('firstProductEdit'), true);
  assert.equal(schema.properties.orientation.properties.deliveredBytes.maximum, MAX_LANE_STEERING_BYTES);
  assert.equal(
    schema.$defs.firstProductEditSnapshot.properties.orientationTokens.$ref,
    '#/$defs/firstEditTokenCounts',
  );
  assert.deepEqual(schema.$defs.firstEditTokenCounts.required, [
    'input',
    'output',
    'cacheRead',
    'cacheWrite',
    'reasoning',
  ]);

  const schemaRun = provisionRun();
  const schemaOptions = setupOptions(schemaRun);
  generateLaneSetup(schemaOptions);
  const generatedOrientation = JSON.parse(readFileSync(
    join(schemaOptions.laneDir, LANE_REPORT_FILE),
    'utf8',
  )).orientation;
  assert.deepEqual(validateJsonSchema(
    schema.properties.orientation,
    generatedOrientation,
    { rootSchema: schema },
  ), []);

  const valid = {
    at: '2026-08-21T12:00:02.000Z',
    orientationBytes: 16000,
    orientationTokens: {
      input: 1,
      output: 2,
      cacheRead: null,
      cacheWrite: 0,
      reasoning: null,
    },
    selectedSkills: ['snapback-authoring'],
  };
  assert.deepEqual(validateJsonSchema(
    schema.$defs.firstProductEditSnapshot,
    valid,
    { rootSchema: schema },
  ), []);
  const invalid = structuredClone(valid);
  invalid.orientationTokens = { input: 1, output: 2 };
  const errors = validateJsonSchema(
    schema.$defs.firstProductEditSnapshot,
    invalid,
    { rootSchema: schema },
  );
  assert.ok(errors.some((error) => error.includes('/cacheRead: required field is missing')));
  assert.ok(errors.some((error) => error.includes('/reasoning: required field is missing')));
});
