import { actionBuilder, ref } from './actions.mjs';
import { insist } from './common.mjs';

export const PROFILES = Object.freeze({
  full: { members: 2000, projects: 120, tasks: 100000, comments: 300000, attachments: 5000, audit: 50000, small: 50 },
  tiny: { members: 4, projects: 3, tasks: 20, comments: 60, attachments: 6, audit: 100, small: 2 }
});
export const DUE_OFFSET_MS = 30 * 24 * 60 * 60 * 1000;
export const accountAlias = i => `large.user.${String(i).padStart(4, '0')}`;
const email = alias => alias.replace('.user.', '-').replaceAll('.', '-') + '@workroom.test';
const statuses = ['open', 'in-progress', 'blocked', 'done', 'cancelled'];

// @ref LLP 3000.009#101-the-brief — the envelope is an action log over authorized writes, not a database import.
export function* scaleActions(profile = 'full') {
  const config = PROFILES[profile]; insist(config, 'UNKNOWN_PROFILE');
  const a = actionBuilder(`scale-${profile}`), owner = accountAlias(0);
  for (let i = 0; i < config.members; i++) {
    const alias = accountAlias(i);
    yield a('W1', alias, 'account.register', alias, { email: email(alias), name: `Large member ${i}`, password: 'Workroom-fixture-only-2026!' });
  }
  yield a('W1', owner, 'organization.create', 'large', { name: 'Large Workroom', serverAnchor: true });
  yield a('W5', 'fixture-provider', 'payment.event', 'large.plan', { organization: ref('large'), plan: 'pro', seatLimit: config.members + 100, renewalOffsetMs: null });
  yield a('W5', 'fixture-provider', 'payment.deliver', null, { events: [ref('large.plan')], signature: 'valid', retry: true });
  yield a('W5', owner, 'background.checkpoint', null, { kind: 'billing', organization: ref('large'), event: ref('large.plan') });
  for (let i = 1; i < config.members; i++) yield a('W1', owner, 'membership.add', `large.membership.${i}`,
    { organization: ref('large'), account: ref(accountAlias(i)), role: 'member' });
  for (let i = 0; i < config.projects; i++) yield a('W2', owner, 'project.create', `large.project.${i}`,
    { organization: ref('large'), name: `Aurora project ${i}` });
  for (let i = 0; i < config.tasks; i++) {
    const task = `large.task.${i}`, actor = accountAlias(i % config.members), status = statuses[i % statuses.length];
    yield a('W2', actor, 'task.create', task, { project: ref(`large.project.${i % config.projects}`),
      title: `Aurora task ${i}`, description: `Workroom deterministic task ${i}`, assignee: ref(actor),
      dueOffsetMs: i % 2 === 0 ? -DUE_OFFSET_MS : DUE_OFFSET_MS });
    if (status === 'cancelled') yield a('W2', actor, 'task.transition', null, { task: ref(task), status });
    else for (let step = 1; step <= i % statuses.length; step++) yield a('W2', actor, 'task.transition', null, { task: ref(task), status: statuses[step] });
  }
  for (let i = 0; i < config.comments; i++) yield a('W2', accountAlias(i % config.members), 'comment.create', `large.comment.${i}`,
    { task: ref(`large.task.${i % config.tasks}`), body: `Comet comment ${i}` });
  for (let i = 0; i < config.attachments; i++) yield a('W4', accountAlias(i % config.members), 'attachment.upload', `large.attachment.${i}`,
    { task: ref(`large.task.${i % config.tasks}`), asset: i % 2 === 0 ? 'invoice' : 'pixel' });
  yield a('W4', owner, 'background.checkpoint', null, { kind: 'organization-extraction', organization: ref('large'), count: config.attachments });
  let archiveCount = 0;
  for (let i = 0; i < config.tasks; i += 100) {
    yield a('W2', owner, 'task.archive', null, { task: ref(`large.task.${i}`) }); archiveCount++;
  }
  // Owner membership + ordinary member additions + applied plan + real task archives.
  const remainingAudit = config.audit - config.members - 1 - archiveCount;
  insist(remainingAudit >= 0, 'AUDIT_TARGET_TOO_SMALL');
  for (let i = 0; i < remainingAudit; i++) yield a('W6', owner, 'membership.set-role', null,
    { organization: ref('large'), account: ref(accountAlias(1)), role: i % 2 === 0 ? 'admin' : 'member' });
  yield a('W6', owner, 'background.checkpoint', null, { kind: 'audit', organization: ref('large'), count: config.audit });
  for (let n = 0; n < config.small; n++) {
    const org = `small.${String(n).padStart(2, '0')}`, smallOwner = `${org}.user.0`, member = `${org}.user.1`;
    for (const user of [smallOwner, member]) yield a('W1', user, 'account.register', user,
      { email: email(user), name: user, password: 'Workroom-fixture-only-2026!' });
    yield a('W1', smallOwner, 'organization.create', org, { name: `Small Workroom ${n}`, serverAnchor: true });
    yield a('W1', smallOwner, 'membership.add', `${org}.membership`, { organization: ref(org), account: ref(member), role: 'member' });
    for (let i = 0; i < 2; i++) yield a('W2', smallOwner, 'project.create', `${org}.project.${i}`, { organization: ref(org), name: `Nebula project ${i}` });
    for (let i = 0; i < 4; i++) {
      const task = `${org}.task.${i}`;
      yield a('W2', member, 'task.create', task, { project: ref(`${org}.project.${i % 2}`), title: `Nebula small task ${i}`,
        description: 'Small tenant content', assignee: ref(i % 2 === 0 ? smallOwner : member), dueOffsetMs: i % 2 === 0 ? -DUE_OFFSET_MS : DUE_OFFSET_MS });
      for (let step = 1; step <= i; step++) yield a('W2', member, 'task.transition', null, { task: ref(task), status: statuses[step] });
      yield a('W2', member, 'comment.create', `${task}.comment`, { task: ref(task), body: `Small tenant comet ${n}/${i}` });
    }
    yield a('W4', member, 'attachment.upload', `${org}.attachment`, { task: ref(`${org}.task.0`), asset: 'invoice' });
    yield a('W4', smallOwner, 'background.checkpoint', null, { kind: 'organization-extraction', organization: ref(org), count: 1 });
  }
}

export function expectedEnvelope(profile = 'full') {
  const p = PROFILES[profile]; insist(p, 'UNKNOWN_PROFILE');
  let open = 0, overdue = 0, bytes = 0;
  for (let i = 0; i < p.tasks; i++) {
    if (i % 5 < 3 && i % 100 !== 0) { open++; if (i % 2 === 0) overdue++; }
  }
  for (let i = 0; i < p.attachments; i++) bytes += i % 2 === 0 ? 601 : 68;
  return {
    large: { organizations: 1, members: p.members, projects: p.projects, tasks: p.tasks, comments: p.comments,
      attachments: p.attachments, audit: p.audit, archivedTasks: Math.ceil(p.tasks / 100), open, overdue, attachmentBytes: bytes },
    total: { organizations: p.small + 1, members: p.members + 2 * p.small, projects: p.projects + 2 * p.small,
      tasks: p.tasks + 4 * p.small, comments: p.comments + 4 * p.small, attachments: p.attachments + p.small,
      audit: p.audit + 2 * p.small, archivedTasks: Math.ceil(p.tasks / 100), open: open + 3 * p.small,
      overdue: overdue + 2 * p.small, attachmentBytes: bytes + 601 * p.small }
  };
}
