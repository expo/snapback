import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AGENTS_FILE,
  LANE_REPORT_FILE,
  MAX_LANE_STEERING_BYTES,
  ORIENTATION_FILE,
  analyzePreM1Events,
  createFirstProductEditMarker,
  generateLaneSetup,
  preflightSelectedSkills,
} from './lane-setup.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function setupOptions(laneDir) {
  return {
    laneDir,
    laneId: 'sol-high-clique-explicit-r01',
    instrumentRoot: ROOT,
    sourceRoot: ROOT,
    profile: 'snapback-explicit-v1',
    milestones: ['M1', 'M2', 'M3'],
    backendPin: '@expo/snapback-*@0.1.24',
    instrumentPin: 'social-messenger@0.3.2-m8',
    selectedSkills: ['snapback-authoring'],
  };
}

test('lane setup emits one bounded, deterministic orientation packet at the lane root', () => {
  const laneDir = mkdtempSync(join(tmpdir(), 'snapback-lane-setup-'));
  const first = generateLaneSetup(setupOptions(laneDir));
  const before = Object.fromEntries(first.files.map((file) => [file, readFileSync(join(laneDir, file), 'utf8')]));
  const second = generateLaneSetup(setupOptions(laneDir));
  const after = Object.fromEntries(second.files.map((file) => [file, readFileSync(join(laneDir, file), 'utf8')]));

  assert.deepEqual(after, before);
  assert.deepEqual(first.files, [AGENTS_FILE, ORIENTATION_FILE, LANE_REPORT_FILE]);
  assert.ok(first.orientation.deliveredBytes <= MAX_LANE_STEERING_BYTES);
  assert.equal(first.orientation.uniqueBytes, first.orientation.deliveredBytes);
  assert.deepEqual(first.orientation.selectedSkills, ['snapback-authoring']);

  const agents = before[AGENTS_FILE];
  assert.match(agents, /Web-only Expo Router benchmark/);
  assert.match(agents, /No physical-device or delivery workflow/);
  assert.match(agents, /Do not substitute a generic Expo, Tuft/);
  assert.match(agents, /only applicable skill set is: `snapback-authoring`/);

  const orientation = before[ORIENTATION_FILE];
  assert.match(orientation, /sole benchmark\s+orientation artifact/);
  assert.match(orientation, /\| M1 \| Accounts and profiles \| 7 \| 3 \| 3 \| 0 \|/);
  assert.match(orientation, /starter-m1\.log/);
  assert.match(orientation, /coverage-manifest\.json/);
  assert.match(orientation, /firstProductEdit[\s\S]+harness-native snapshot/);

  const report = JSON.parse(before[LANE_REPORT_FILE]);
  assert.equal(report.orientation.deliveredBytes, first.orientation.deliveredBytes);
  assert.deepEqual(report.orientation.preflightWarnings, []);
  assert.deepEqual(report.firstProductEdit, {
    at: null,
    orientationBytes: null,
    orientationTokens: {
      input: null,
      output: null,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    },
    selectedSkills: [],
  });
  assert.deepEqual(
    createFirstProductEditMarker(report.orientation, '2026-08-21T12:34:56.000Z'),
    {
      at: '2026-08-21T12:34:56.000Z',
      orientationBytes: first.orientation.deliveredBytes,
      selectedSkills: ['snapback-authoring'],
    },
  );
});

test('skill preflight warns for device delivery and generic scaffold families only', () => {
  const warnings = preflightSelectedSkills([
    'tuft-app-builder',
    'snapback-authoring',
    'expo-app-delivery',
    'tuft-app-builder',
  ]);
  assert.deepEqual(
    warnings.map(({ code, skill }) => ({ code, skill })),
    [
      {
        code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_GENERIC_APP_SCAFFOLD_SKILL',
        skill: 'tuft-app-builder',
      },
      {
        code: 'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_DEVICE_EAS_SKILL',
        skill: 'expo-app-delivery',
      },
    ],
  );
});

test('social-messenger schema consumes the lane orientation and shared token-count shape additively', () => {
  const schema = JSON.parse(readFileSync(
    join(ROOT, 'benchmarks/schema/social-messenger/run-record-extension.schema.json'),
    'utf8',
  ));
  const orientation = schema.properties.orientation;
  assert.ok(orientation);
  assert.equal(schema.required.includes('orientation'), false);
  assert.equal(schema.required.includes('firstProductEdit'), false);
  assert.equal(orientation.properties.deliveredBytes.maximum, MAX_LANE_STEERING_BYTES);
  assert.equal(schema.properties.firstProductEdit.$ref, '#/$defs/firstProductEditSnapshot');
  const editRecord = schema.$defs.firstProductEditSnapshot;
  assert.deepEqual(editRecord.required, [
    'at',
    'orientationBytes',
    'orientationTokens',
    'selectedSkills',
  ]);
  assert.equal(editRecord.properties.orientationTokens.$ref, '#/$defs/tokenCounts');
  assert.deepEqual(schema.$defs.tokenCounts.properties.reasoning.type, ['integer', 'null']);
});

test('event preflight stops skill accounting at the first product edit', () => {
  const laneDir = '/tmp/benchmark-lane';
  const events = [
    {
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: "sed -n '1,200p' /tmp/benchmark-lane/.agents/skills/expo-app-delivery/SKILL.md",
      },
    },
    {
      type: 'item.completed',
      item: {
        type: 'file_change',
        changes: [{ path: '/tmp/benchmark-lane/run-log.md', kind: 'add' }],
      },
    },
    {
      type: 'item.completed',
      item: {
        type: 'file_change',
        changes: [{ path: '/tmp/benchmark-lane/app/index.tsx', kind: 'add' }],
      },
    },
    {
      type: 'skill.loaded',
      skill: 'tuft-app-builder',
    },
  ];

  const result = analyzePreM1Events(events, { laneDir });
  assert.deepEqual(result.selectedSkills, ['expo-app-delivery']);
  assert.deepEqual(result.firstProductEdit, { eventIndex: 2, paths: ['app/index.tsx'] });
  assert.deepEqual(result.warnings.map((warning) => warning.code), [
    'BENCHMARK_PREFLIGHT_OUT_OF_SCOPE_DEVICE_EAS_SKILL',
  ]);
});
