import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BROWSER_IR_LOCAL_EFFECT_CLASS,
  evaluateLocalMutationIrV1,
} from '../../../../../../packages/snapback-client/ir-evaluator.mjs';
import {
  CALENDAR_COMMON_PATH_STEP_KINDS,
  CALENDAR_FROZEN_CHECKS,
  CALENDAR_RESERVE_ARGS,
  CALENDAR_RESERVE_PLAN,
  CALENDAR_SCHEMA,
} from './calendar-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../../..');
const manifest = JSON.parse(await readFile(resolve(
  ROOT,
  'demos/zero-bakeoff/protocol/acceptance/contention-calendar.v1.json',
), 'utf8'));
const functionsSource = await readFile(resolve(
  ROOT,
  'demos/zero-bakeoff/apps/contention-calendar/snapback/functions.mjs',
), 'utf8');
const acceptanceSource = await readFile(resolve(
  ROOT,
  'demos/zero-bakeoff/apps/contention-calendar/snapback/tests/acceptance.mjs',
), 'utf8');

assert.deepEqual(manifest.checks, CALENDAR_FROZEN_CHECKS);
assert.equal(manifest.fixture.resources, 20);
assert.equal(manifest.fixture.contenders, 2);
assert.match(functionsSource, /export const clearReservations = defineJsMutation/u);
assert.doesNotMatch(
  acceptanceSource,
  /api\.clearReservations/u,
  'the frozen common-path acceptance must not be widened by the unused cleanup utility',
);
assert.deepEqual(
  CALENDAR_RESERVE_PLAN.steps.map((step) => Object.keys(step)[0]),
  CALENDAR_COMMON_PATH_STEP_KINDS,
);

const prediction = evaluateLocalMutationIrV1({
  name: 'contention-calendar:reserve',
  schema: CALENDAR_SCHEMA,
  initialRows: { reservations: [] },
  plan: CALENDAR_RESERVE_PLAN,
  args: CALENDAR_RESERVE_ARGS,
  ctxLedger: {
    version: 1,
    ids: ['provisional-reservation-alice-room-00-slot-final'],
    now: CALENDAR_RESERVE_ARGS.now,
  },
  declaredEffectClass: BROWSER_IR_LOCAL_EFFECT_CLASS,
  readAdmission: 'ready',
  layerId: 'calendar-intent-alice-room-00-slot-final',
});

assert.equal(prediction.classification, 'ready');
assert.equal(prediction.execution.status, 'committed');
assert.equal(
  prediction.execution.result,
  'provisional-reservation-alice-room-00-slot-final',
);
assert.equal(prediction.layer.writes.length, 1);
assert.equal(prediction.layer.writes[0].operation, 'insert');
assert.equal(prediction.layer.writes[0].row.resourceSlotKey, 'room-00|slot-final');
assert.equal(prediction.ledgerClaim.authority, 'never-authority');

console.log('rung2 Calendar common-path fixture: Insert-only prediction passed');
