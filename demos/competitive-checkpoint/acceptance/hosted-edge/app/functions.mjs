// Generated owner CRUD is enough: the matrix exercises the LLP 0077 sender
// admission path in FRONT of these routes, not the routes' own logic.

import { defineOwnedCrud } from '@expo/snapback-codegen/standard-patterns';
import schema from './schema.mjs';

const visibility = { kind: 'owner', field: 'ownerId' };

export const { listNotes, getNote, createNote, updateNote, deleteNote } = defineOwnedCrud({
  table: schema.tables.notes,
  names: {
    list: 'listNotes',
    get: 'getNote',
    create: 'createNote',
    update: 'updateNote',
    delete: 'deleteNote',
  },
  visibility,
  createDefaults: { createdAt: 'now' },
  immutable: ['createdAt'],
  listIndex: 'notes_by_owner',
});
