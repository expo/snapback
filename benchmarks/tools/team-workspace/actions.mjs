import { insist, sha256 } from './common.mjs';

export const VERSION = 1;
export const OPERATIONS = Object.freeze([
  'account.register', 'auth.sign-in', 'organization.create', 'membership.add', 'membership.set-role',
  'membership.remove', 'project.create', 'project.set', 'project.archive', 'task.create', 'task.set',
  'task.transition', 'task.archive', 'comment.create', 'attachment.upload', 'attachment.delete',
  'invitation.create', 'invitation.accept', 'invitation.revoke', 'payment.event', 'payment.deliver',
  'background.checkpoint', 'assert', 'evolution.guest', 'project.add-guest'
]);
export const ref = (alias) => ({ ref: alias });
export function actionBuilder(namespace) {
  let seq = 0;
  return (milestone, actor, op, entity, input = {}, expect = { status: 'applied' }) => {
    seq++;
    return { version: VERSION, seq, key: `workroom/v1/${namespace}/${String(seq).padStart(9, '0')}`,
      milestone, actor, op, entity, input, expect };
  };
}
export function validateAction(action, expectedSeq) {
  insist(action.version === VERSION && action.seq === expectedSeq && typeof action.key === 'string'
    && action.key.length > 0 && typeof action.actor === 'string' && OPERATIONS.includes(action.op)
    && (action.entity === null || typeof action.entity === 'string')
    && action.input && typeof action.input === 'object' && !Array.isArray(action.input)
    && ['applied', 'rejected'].includes(action.expect?.status), 'INVALID_ACTION');
  if (action.expect.status === 'rejected') insist(typeof action.expect.reason === 'string', 'REJECTION_REASON_REQUIRED');
  return action;
}
export const actionDigest = (action) => sha256(JSON.stringify(action));
export function resolveRefs(value, aliases) {
  if (Array.isArray(value)) return value.map(x => resolveRefs(x, aliases));
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.ref === 'string') {
      insist(aliases.has(value.ref), 'UNBOUND_ALIAS', value.ref); return aliases.get(value.ref);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, aliases)]));
  }
  return value;
}
