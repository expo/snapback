import test from 'node:test';
import assert from 'node:assert/strict';

import { composeIosAttendedV3 } from './compose-ios-attended-v3.mjs';

const amendmentId = 'partitime-step4-physical-ios-carrier-v3-2026-07-28';
const identity = {
  snapbackRevision: 'a'.repeat(40),
  exactRevision: 'b'.repeat(40),
  fixtureId: 'fixture',
  packageIdentity: 'packages',
};

function simulator(claimId, ids) {
  return {
    browser: 'ios-safari',
    revision: { snapback: identity.snapbackRevision, exact: identity.exactRevision },
    artifacts: { inputsHash: identity.fixtureId },
    testInventorySha256: identity.packageIdentity,
    results: [{
      name: `${claimId} synthetic`,
      ok: true,
      details: Object.fromEntries(ids.map((id) => [id, { observed: true }])),
    }],
  };
}

function physical(arm) {
  const attachment = { sha256: 'c'.repeat(64) };
  return {
    schemaVersion: 'partitime.ios-attended-physical-receipt.v1',
    instrumentId: amendmentId,
    arm,
    browser: 'ordinary-mobile-safari-xcuitest',
    safariDriverSessionAbsent: true,
    attended: { operator: 'Charlie Cheever', inputSource: 'physical-iphone-soft-keyboard' },
    device: { udid: 'device', osVersion: '26.5.2' },
    identity,
    observations: Object.fromEntries([
      'keyboard-create',
      'keyboard-rsvp',
      'keyboard-wall',
      'reduced-motion-wall',
    ].map((id) => [id, {
      status: 'pass',
      attachments: { screenshot: attachment, accessibilityTree: attachment },
    }])),
  };
}

function input() {
  const amendment = {
    amendmentId,
    status: 'ratified',
    ratification: {
      owner: 'Charlie Cheever',
      statement: `I ratify ${amendmentId}.`,
    },
  };
  return {
    amendment,
    simulatorReceipts: {
      react: {
        'STEP4.UI.KEYBOARD': simulator('STEP4.UI.KEYBOARD', ['create', 'menu', 'rsvp', 'guest', 'wall']),
        'STEP4.UI.REDUCED-MOTION': simulator('STEP4.UI.REDUCED-MOTION', ['overlay', 'rsvp', 'wall']),
      },
      contract: {
        'STEP4.UI.KEYBOARD': simulator('STEP4.UI.KEYBOARD', ['create', 'menu', 'rsvp', 'guest', 'wall']),
        'STEP4.UI.REDUCED-MOTION': simulator('STEP4.UI.REDUCED-MOTION', ['overlay', 'rsvp', 'wall']),
      },
    },
    physicalReceipts: { react: physical('react'), contract: physical('contract') },
  };
}

test('passes only when every governed simulator and physical fact passes', () => {
  const report = composeIosAttendedV3(input());
  assert.equal(report.ok, true);
  assert.equal(report.cells.length, 4);
  assert.ok(report.cells.every(({ status }) => status === 'pass'));
});

test('fails closed on a missing physical sibling', () => {
  const values = input();
  delete values.physicalReceipts.contract.observations['keyboard-wall'];
  const report = composeIosAttendedV3(values);
  assert.equal(report.ok, false);
  assert.equal(
    report.cells.find(({ arm, claimId }) => arm === 'contract' && claimId === 'STEP4.UI.KEYBOARD').status,
    'red',
  );
});

test('rejects a passing result from an unratified instrument', () => {
  const values = input();
  values.amendment.status = 'proposed-pending-owner-ratification';
  values.amendment.ratification = null;
  const report = composeIosAttendedV3(values);
  assert.equal(report.ok, false);
  assert.ok(report.errors.includes('amendment is not owner-ratified'));
});

test('rejects cross-generation identity drift', () => {
  const values = input();
  values.physicalReceipts.react.identity.exactRevision = 'd'.repeat(40);
  const report = composeIosAttendedV3(values);
  assert.equal(report.ok, false);
  assert.ok(report.cells.some(({ errors }) => errors.includes('exactRevision mismatch')));
});
