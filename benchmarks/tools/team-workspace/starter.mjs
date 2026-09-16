import { actionBuilder, ref } from './actions.mjs';

const people = ['owner', 'admin', 'member', 'other-owner', 'outsider', 'invited', 'expired', 'revoked', 'wrong-recipient', 'guest'];
const denied = reason => ({ status: 'rejected', reason });

// W3 and W5 are specified as standalone journeys, after the shared W1 setup.
// Tokens are obtained from actual sink mail, never derived from these aliases.
export function* invitations(a) {
  const invite = (alias, address) => a('W3', 'owner', 'invitation.create', alias,
    { organization: ref('acme'), email: `${address}@workroom.test`, role: 'member' });
  yield invite('invite.good', 'invited');
  yield a('W3', 'owner', 'background.checkpoint', null, { kind: 'email', invitation: ref('invite.good'), recipient: 'invited@workroom.test' });
  yield a('W3', 'wrong-recipient', 'invitation.accept', null, { invitation: ref('invite.good'), tokenFromSink: true }, denied('wrong-recipient'));
  yield a('W3', 'invited', 'invitation.accept', 'membership.invited', { invitation: ref('invite.good'), tokenFromSink: true });
  yield a('W3', 'invited', 'invitation.accept', null, { invitation: ref('invite.good'), tokenFromSink: true, duplicate: true },
    { status: 'applied', noChange: true });
  yield a('W3', 'owner', 'assert', null, { check: 'membership-and-audit-atomic', organization: ref('acme'), account: ref('invited'), memberships: 1 });
  yield invite('invite.again', 'invited');
  yield a('W3', 'owner', 'assert', null, { check: 'single-membership', organization: ref('acme'), account: ref('invited') });
  yield invite('invite.expired', 'expired');
  yield a('W3', 'owner', 'background.checkpoint', null, { kind: 'invitation-expired', invitation: ref('invite.expired'), clock: 'server', marginMs: 5000 });
  yield a('W3', 'expired', 'invitation.accept', null, { invitation: ref('invite.expired'), tokenFromSink: true }, denied('invitation-expired'));
  yield invite('invite.revoked', 'revoked');
  yield a('W3', 'owner', 'invitation.revoke', null, { invitation: ref('invite.revoked') });
  yield a('W3', 'revoked', 'invitation.accept', null, { invitation: ref('invite.revoked'), tokenFromSink: true }, denied('invitation-revoked'));
}

export function* billing(a, backlogSize = 200) {
  for (const [id, plan, seats] of [['older', 'free', 4], ['newer', 'pro', 10]]) {
    yield a('W5', 'fixture-provider', 'payment.event', `billing.${id}`, { organization: ref('acme'), plan, seatLimit: seats, renewalOffsetMs: null });
  }
  yield a('W5', 'fixture-provider', 'payment.deliver', null, { events: [ref('billing.newer')], signature: 'wrong', retry: false });
  yield a('W5', 'fixture-provider', 'payment.deliver', null, { events: [ref('billing.newer')], signature: 'unsigned', retry: false });
  yield a('W5', 'fixture-provider', 'payment.deliver', null, { events: [ref('billing.newer'), ref('billing.older'), ref('billing.newer')], signature: 'valid', retry: true });
  yield a('W5', 'owner', 'background.checkpoint', null, { kind: 'billing', organization: ref('acme'), event: ref('billing.newer') });
  yield a('W5', 'owner', 'assert', null, { check: 'latest-plan-once', organization: ref('acme'), plan: 'pro', seatLimit: 10 });
  yield a('W5', 'fixture-provider', 'payment.event', 'billing.due', { organization: ref('acme'), plan: 'past_due', seatLimit: 10, renewalOffsetMs: null });
  yield a('W5', 'fixture-provider', 'payment.deliver', null, { events: [ref('billing.due')], signature: 'valid', retry: true });
  yield a('W5', 'owner', 'background.checkpoint', null, { kind: 'billing', organization: ref('acme'), event: ref('billing.due') });
  yield a('W5', 'member', 'project.set', null, { project: ref('project'), name: 'Refused edit' }, denied('past-due'));
  yield a('W5', 'owner', 'assert', null, { check: 'past-due-readable', organization: ref('acme') });
  yield a('W5', 'fixture-provider', 'payment.event', 'billing.limit', { organization: ref('acme'), plan: 'free', seatLimit: 4, renewalOffsetMs: null });
  yield a('W5', 'fixture-provider', 'payment.deliver', null, { events: [ref('billing.limit')], signature: 'valid', retry: true });
  yield a('W5', 'owner', 'background.checkpoint', null, { kind: 'billing', organization: ref('acme'), event: ref('billing.limit') });
  yield a('W5', 'owner', 'invitation.create', null, { organization: ref('acme'), email: 'outsider@workroom.test', role: 'member' }, denied('seat-limit'));
  yield a('W5', 'fixture-driver', 'harness.control', null, { target: 'receiver', command: 'stop' });
  const backlog = [];
  for (let n = 0; n < backlogSize; n++) {
    const entity = `billing.backlog.${n}`; backlog.push(ref(entity));
    yield a('W5', 'fixture-provider', 'payment.event', entity, { organization: ref('acme'),
      plan: n % 2 === 0 ? 'free' : 'pro', seatLimit: 20, renewalOffsetMs: null });
  }
  yield a('W5', 'fixture-provider', 'payment.deliver', null, { events: backlog, signature: 'valid', retry: true });
  yield a('W5', 'fixture-driver', 'background.checkpoint', null, { kind: 'provider-unacknowledged', events: backlog, minimumAttempts: 1 });
  yield a('W5', 'fixture-driver', 'harness.control', null, { target: 'provider', command: 'restart-preserving-journal' });
  yield a('W5', 'fixture-driver', 'harness.control', null, { target: 'receiver', command: 'start', responseFaults: ['503-once', 'commit-then-drop-once'] });
  yield a('W5', 'owner', 'background.checkpoint', null, { kind: 'billing', organization: ref('acme'), event: backlog.at(-1), requireAllAcknowledged: backlog });
  yield a('W5', 'fixture-driver', 'harness.control', null, { target: 'receiver', command: 'restart-preserving-data' });
  yield a('W5', 'owner', 'assert', null, { check: 'backlog-restart-durable-ack', organization: ref('acme'), events: backlog, finalPlan: 'pro', seatLimit: 20 });
}

export function* starterActions({ conformance = false } = {}) {
  const a = actionBuilder(conformance ? 'conformance' : 'starter');
  for (const person of people) yield a('W1', person, 'account.register', person,
    { email: `${person}@workroom.test`, password: 'Workroom-fixture-only-2026!', name: person });
  yield a('W1', 'owner', 'auth.sign-in', null, { account: ref('owner') });
  yield a('W1', 'owner', 'organization.create', 'acme', { name: 'Acme Workroom' });
  yield a('W1', 'other-owner', 'organization.create', 'other', { name: 'Other Workroom' });
  for (const member of ['admin', 'member']) yield a('W1', 'owner', 'membership.add', `membership.${member}`,
    { organization: ref('acme'), account: ref(member), role: 'member' });
  yield a('W1', 'owner', 'membership.set-role', null, { organization: ref('acme'), account: ref('admin'), role: 'admin' });
  yield a('W1', 'member', 'membership.set-role', null, { organization: ref('acme'), account: ref('admin'), role: 'member' }, denied('role-forbidden'));
  yield a('W1', 'owner', 'membership.add', 'membership.temporary', { organization: ref('acme'), account: ref('outsider'), role: 'member' });
  yield a('W1', 'owner', 'membership.remove', null, { organization: ref('acme'), account: ref('outsider') });
  yield a('W1', 'outsider', 'assert', null, { check: 'tenant-denied', organization: ref('acme') });
  yield a('W2', 'member', 'project.create', 'project', { organization: ref('acme'), name: 'Aurora launch' });
  yield a('W2', 'member', 'project.create', 'project.history', { organization: ref('acme'), name: 'Old project' });
  yield a('W2', 'admin', 'project.archive', null, { project: ref('project.history') });
  yield a('W2', 'member', 'project.set', null, { project: ref('project'), name: 'Aurora launch revised' });
  yield a('W2', 'member', 'task.create', 'task', { project: ref('project'), title: 'Aurora delivery', description: 'Nebula packaging', assignee: ref('member'), dueOffsetMs: -2592000000 });
  yield a('W2', 'member', 'task.set', null, { task: ref('task'), title: 'Aurora delivery revised', assignee: ref('admin'), dueOffsetMs: 2592000000 });
  yield a('W2', 'member', 'task.transition', null, { task: ref('task'), status: 'done' }, denied('invalid-transition'));
  for (const status of ['in-progress', 'blocked', 'done']) yield a('W2', 'member', 'task.transition', null, { task: ref('task'), status });
  yield a('W2', 'member', 'comment.create', 'comment', { task: ref('task'), body: 'Aurora comment comet' });
  yield* invitations(a);
  for (const asset of ['invoice', 'pixel']) yield a('W4', 'member', 'attachment.upload', `attachment.${asset}`, { task: ref('task'), asset });
  yield a('W4', 'member', 'background.checkpoint', null, { kind: 'extraction', attachments: [ref('attachment.invoice'), ref('attachment.pixel')] });
  yield a('W4', 'admin', 'task.archive', null, { task: ref('task') });
  yield a('W4', 'member', 'assert', null, { check: 'archived-attachment-readable', attachment: ref('attachment.invoice') });
  yield a('W4', 'admin', 'attachment.delete', null, { attachment: ref('attachment.pixel') });
  yield a('W4', 'member', 'assert', null, { check: 'deleted-attachment-unreachable', attachment: ref('attachment.pixel') });
  yield a('W4', 'member', 'assert', null, { check: 'interrupted-upload-cleanup', task: ref('task'), asset: 'invoice', clock: 'server' });
  yield* billing(a, conformance ? 2 : 200);
  yield a('W6', 'owner', 'assert', null, { check: 'audit-append-only-and-admin-only', organization: ref('acme'), member: ref('member') });
  yield a('W6', 'fixture-provider', 'payment.event', 'billing.renewal.near', { organization: ref('acme'), plan: 'pro', seatLimit: 20, renewalOffsetMs: 240000 });
  yield a('W6', 'fixture-provider', 'payment.event', 'billing.renewal.far', { organization: ref('other'), plan: 'pro', seatLimit: 20, renewalOffsetMs: 3600000 });
  yield a('W6', 'fixture-provider', 'payment.deliver', null, { events: [ref('billing.renewal.near'), ref('billing.renewal.far')], signature: 'valid', retry: true });
  yield a('W6', 'owner', 'background.checkpoint', null, { kind: 'billing', organization: ref('acme'), event: ref('billing.renewal.near') });
  yield a('W6', 'fixture-driver', 'harness.control', null, { target: 'receiver', command: 'restart-preserving-data' });
  yield a('W6', 'owner', 'assert', null, { check: 'renewal-once-across-restart', organization: ref('acme'), farOrganization: ref('other'), clock: 'server' });
  yield a('W6', 'owner', 'background.checkpoint', null, { kind: 'reminder', organization: ref('acme') });
  yield a('W7', 'member', 'assert', null, { check: 'authorized-search', organization: ref('acme'), terms: ['aurora', 'nebula', 'comet'] });
  yield a('W8', 'owner', 'evolution.guest', null, { freshSession: true, duringMigrationWrite: 'comment', existingMembersUnchanged: true });
  yield a('W8', 'owner', 'membership.add', 'membership.guest', { organization: ref('acme'), account: ref('guest'), role: 'guest' });
  yield a('W8', 'owner', 'project.add-guest', null, { project: ref('project'), account: ref('guest') });
  yield a('W8', 'guest', 'assert', null, { check: 'guest-scoped-projects', allowed: ref('project'), denied: ref('project.history') });
  yield a('W8', 'guest', 'invitation.create', null, { organization: ref('acme'), email: 'outsider@workroom.test', role: 'member' }, denied('role-forbidden'));
}
