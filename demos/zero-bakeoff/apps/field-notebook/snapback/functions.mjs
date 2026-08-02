// @ref LLP 0043#milestone-1-retained-reads — this authority-independent
// closed-IR query is explicitly eligible for the JS retained store.
import {
  arg, asc, defineLiveQuery, defineMutation, eq, insert, literal, patch,
  returnBinding, returnChangedCount, v,
} from '../../../../_kit/define.mjs';

export const assignedRecords = defineLiveQuery({
  table: 'records', args: {assignmentId: v.string()},
  filter: [eq('assignmentId', arg('assignmentId'))], order: [asc('title')],
  index: 'by_assignment', auth: 'public', authorityIndependent: true, publicInline: true,
});
export const createRecord = defineMutation({
  args: {assignmentId: v.string(), title: v.string(), body: v.string()},
  plan: insert('records', {
    assignmentId: arg('assignmentId'), title: arg('title'), body: arg('body'),
    checklistDone: literal(false), revision: literal(1),
  }, {bindIdAs: 'recordId'}),
  returns: returnBinding('recordId'),
});
export const updateRecord = defineMutation({
  args: {id: v.string(), body: v.string(), revision: v.integer()},
  plan: patch('records', arg('id'), {body: arg('body'), revision: arg('revision')}),
  returns: returnChangedCount(),
});
