import schema from './schema.mjs';
import { defineOwnedCrud } from '../../../packages/snapback-codegen/standard-patterns.mjs';

export const {
  listTodos,
  getTodo,
  createTodo,
  updateTodo,
  deleteTodo,
} = defineOwnedCrud({
  table: schema.tables.todos,
  names: {
    list: 'listTodos',
    get: 'getTodo',
    create: 'createTodo',
    update: 'updateTodo',
    delete: 'deleteTodo',
  },
  visibility: { kind: 'owner', field: 'ownerId' },
  createDefaults: { createdAt: 'now' },
  immutable: ['createdAt'],
  listIndex: 'by_owner_created',
});
