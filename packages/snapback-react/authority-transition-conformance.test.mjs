import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CLIENT_AUTHORITY_STATES,
  authorityTransitionCell,
} from '@expo/snapback-client/authority-transition';

test('React and Familiar expose the five transcribed projection cells without policy drift', () => {
  for (const state of CLIENT_AUTHORITY_STATES) {
    const cell = authorityTransitionCell('react-familiar', state);
    assert.equal(cell.terminal, 'project');
    assert.equal(cell.observable.source, 'underlying-cell');
  }
});
