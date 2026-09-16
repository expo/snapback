import { insist } from './common.mjs';
import { validateAction } from './actions.mjs';

const alias = value => value.ref;
const empty = () => ({ organizations: 0, members: 0, projects: 0, tasks: 0, comments: 0,
  attachments: 0, audit: 0, archivedTasks: 0, open: 0, overdue: 0, attachmentBytes: 0 });

// Independent state reducer computes report truth by applying the log, not by
// reading the profile's formulas. It does not stand in for an application replay.
export class ReportReducer {
  constructor(assets) {
    this.assets = new Map(assets.map(x => [x.id, x])); this.seq = 0;
    this.accounts = new Set(); this.organizations = new Map(); this.projects = new Map();
    this.tasks = new Map(); this.events = new Map(); this.delivered = new Set();
  }
  org(id) { const org = this.organizations.get(id); insist(org, 'REDUCER_UNKNOWN_ORG'); return org; }
  task(id) { const task = this.tasks.get(id); insist(task, 'REDUCER_UNKNOWN_TASK'); return task; }
  apply(action) {
    validateAction(action, ++this.seq); insist(action.expect.status === 'applied', 'REDUCER_SCALE_ONLY');
    const i = action.input, e = action.entity;
    switch (action.op) {
      case 'account.register': insist(!this.accounts.has(e), 'REDUCER_DUPLICATE_ACCOUNT'); this.accounts.add(e); break;
      case 'organization.create': {
        insist(this.accounts.has(action.actor) && !this.organizations.has(e), 'REDUCER_INVALID_OWNER');
        this.organizations.set(e, { counts: { ...empty(), organizations: 1, members: 1, audit: 1 },
          members: new Map([[action.actor, 'owner']]), revision: 0, plan: 'free', seatLimit: 5 }); break;
      }
      case 'membership.add': {
        const org = this.org(alias(i.organization)), member = alias(i.account);
        insist(this.accounts.has(member) && !org.members.has(member) && org.members.size < org.seatLimit, 'REDUCER_INVALID_MEMBERSHIP');
        org.members.set(member, i.role); org.counts.members++; org.counts.audit++; break;
      }
      case 'membership.set-role': {
        const org = this.org(alias(i.organization)), member = alias(i.account);
        insist(org.members.has(member) && org.members.get(member) !== i.role, 'REDUCER_ROLE_NOOP');
        org.members.set(member, i.role); org.counts.audit++; break;
      }
      case 'payment.event': this.events.set(e, { ...i, revision: this.events.size + 1 }); break;
      case 'payment.deliver': {
        if (i.signature !== 'valid') break;
        for (const eventRef of i.events) {
          const id = alias(eventRef), event = this.events.get(id); insist(event, 'REDUCER_UNKNOWN_EVENT');
          if (this.delivered.has(id)) continue; this.delivered.add(id);
          const org = this.org(alias(event.organization));
          if (event.revision <= org.revision) continue;
          if (org.plan !== event.plan || org.seatLimit !== event.seatLimit) org.counts.audit++;
          org.revision = event.revision; org.plan = event.plan; org.seatLimit = event.seatLimit;
        }
        break;
      }
      case 'project.create': {
        const org = alias(i.organization); insist(!this.projects.has(e), 'REDUCER_DUPLICATE_PROJECT');
        this.projects.set(e, org); this.org(org).counts.projects++; break;
      }
      case 'task.create': {
        const org = this.projects.get(alias(i.project)); insist(org && !this.tasks.has(e), 'REDUCER_INVALID_TASK');
        insist(this.org(org).members.has(alias(i.assignee)), 'REDUCER_INVALID_ASSIGNEE');
        this.tasks.set(e, { org, assignee: alias(i.assignee), status: 'open', due: i.dueOffsetMs, archived: false, bytes: 0 });
        this.org(org).counts.tasks++; break;
      }
      case 'task.transition': {
        const task = this.task(alias(i.task));
        insist(i.status === 'cancelled' || ({ open: 'in-progress', 'in-progress': 'blocked', blocked: 'done' })[task.status] === i.status,
          'REDUCER_INVALID_TRANSITION'); task.status = i.status; break;
      }
      case 'task.archive': {
        const task = this.task(alias(i.task)); insist(!task.archived, 'REDUCER_ARCHIVE_NOOP'); task.archived = true;
        this.org(task.org).counts.audit++; this.org(task.org).counts.archivedTasks++; break;
      }
      case 'comment.create': this.org(this.task(alias(i.task)).org).counts.comments++; break;
      case 'attachment.upload': {
        const task = this.task(alias(i.task)), asset = this.assets.get(i.asset); insist(asset, 'REDUCER_UNKNOWN_MEDIA');
        task.bytes += asset.bytes; const counts = this.org(task.org).counts; counts.attachments++; counts.attachmentBytes += asset.bytes; break;
      }
      case 'background.checkpoint': {
        const org = this.org(alias(i.organization));
        if (i.kind === 'audit') insist(org.counts.audit === i.count, 'REDUCER_AUDIT_MISMATCH');
        if (i.kind === 'organization-extraction') insist(org.counts.attachments === i.count, 'REDUCER_ATTACHMENT_MISMATCH');
        break;
      }
      default: throw Object.assign(new Error(action.op), { code: 'REDUCER_UNSUPPORTED_SCALE_OP' });
    }
  }
  report() {
    const organizations = {}, total = empty();
    for (const [id, org] of this.organizations) {
      organizations[id] = { counts: { ...org.counts }, members: Object.fromEntries([...org.members].map(([id]) => [id,
        { open: 0, overdue: 0, attachmentBytes: 0 }])) };
    }
    for (const task of this.tasks.values()) {
      const org = organizations[task.org], member = org.members[task.assignee]; member.attachmentBytes += task.bytes;
      if (!task.archived && ['open', 'in-progress', 'blocked'].includes(task.status)) {
        org.counts.open++; member.open++;
        if (task.due < 0) { org.counts.overdue++; member.overdue++; }
      }
    }
    for (const org of Object.values(organizations)) for (const key of Object.keys(total)) total[key] += org.counts[key];
    return { large: organizations.large.counts, total, organizations };
  }
}
