import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CLIENT_AUTHORITY_STATES,
  CLIENT_AUTHORITY_TRANSITION_CONFORMANCE_ROWS,
  authorityTransitionCell,
} from '@expo/snapback-client/authority-transition';

test('React and Familiar replay every generated matrix coordinate without policy drift', () => {
  const projectionRows = CLIENT_AUTHORITY_TRANSITION_CONFORMANCE_ROWS
    .filter(({ surface }) => surface === 'react-familiar');
  assert.equal(projectionRows.length, 5 * 9 * 5);
  for (const state of CLIENT_AUTHORITY_STATES) {
    const stateRows = projectionRows.filter((row) => row.startingState === state);
    assert.equal(stateRows.length, 9 * 5);
    for (const row of stateRows) {
      assert.deepEqual(row.expected, authorityTransitionCell('react-familiar', state));
      assert.equal(row.expected.observable.source, 'underlying-cell');
    }
  }
});
