// Helper boundary descriptors for the graffiti wall. Every export the .contract
// imports must appear here or the Contract verifier reports an opaque-import
// diagnostic for the missing one. The Presence shapes mirror the generated
// BoardCursorsEntry/BoardCursorsValue shapes so row-shape analysis still checks
// member access on entries that pass through these helpers.

import { defineContractModule, pure, shape } from '@exact/contract/exports';

export default defineContractModule('./data.ts', {
  palette: pure({ params: [], result: 'Swatch[]', depends: 'args' }),
  wallCells: pure({ params: ['rows'], result: 'WallCell[]', depends: 'args' }),
  blankWall: pure({ params: [], result: 'WallCell[]', depends: 'args' }),
  remoteCursors: pure({ params: ['entries'], result: 'PresenceEntry[]', depends: 'args' }),
  cursorLeft: pure({ params: ['p'], result: 'number', depends: 'args' }),
  cursorTop: pure({ params: ['p'], result: 'number', depends: 'args' }),
  swatchRing: pure({ params: ['swatchColor', 'selected'], result: 'string', depends: 'args' }),
  initial: pure({ params: ['p'], result: 'string', depends: 'args' }),
  presenceHeading: pure({ params: ['entries'], result: 'string', depends: 'args' }),
  boardWidth: pure({ params: [], result: 'number', depends: 'args' }),
  boardHeight: pure({ params: [], result: 'number', depends: 'args' }),
  Swatch: shape({ fields: { id: 'string', color: 'string', label: 'string' } }),
  WallCell: shape({ fields: { id: 'string', x: 'number', y: 'number', color: 'string' } }),
  PresenceEntry: shape({
    fields: {
      key: 'string',
      value: 'PresenceValue',
      updatedAt: 'number',
      expiresAt: { type: 'number', optional: true },
      sourceClientId: 'string',
      self: 'boolean',
    },
  }),
  PresenceValue: shape({
    fields: { x: 'number', y: 'number', color: 'string', name: { type: 'string', optional: true } },
  }),
});
