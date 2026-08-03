import {
  defineAction,
  defineConfig,
  defineCron,
  defineJsLiveQuery,
  defineJsMutation,
  defineJsQuery,
  results,
  v,
} from '@expo/snapback-codegen/define';

// LLP 0137 A6 operations and workflow ledger.
// Every protected operation gates through the orgMembers scoped-role
// declaration (dispatcher/operator); the outsider gets the uniform
// SNAPBACK_AUTH_PERMISSION_DENIED on read, subscribe, and write.
// Inline handler v1 does not capture sibling helpers, so each handler is a
// self-contained expression (activity/receipt append logic repeated inline;
// dynamic computed member access avoided — status counts use filters).

// ---- membership entry ----

export const redeemInvite = defineJsMutation({
  args: { code: v.string() },
  reads: ['invites'],
  writes: ['invites', 'orgMembers'],
  authorityCreating: true,
  result: results.value(v.object({
    orgId: v.id('orgs'),
    role: v.string(),
    inviteCode: v.string(),
  })),
  handler: async (ctx, args) => {
    const invites = await ctx.db.query('invites').withIndex('by_code').eq('code', args.code).collect();
    const invite = invites[0];
    if (!invite || invite.consumed) throw new Error('invite code is not redeemable');
    await ctx.membership.orgMembers.insert({
      orgId: invite.orgId,
      userId: ctx.auth.userId,
      role: invite.role === 'dispatcher' ? 'dispatcher' : 'operator',
    });
    await ctx.db.patch('invites', invite._id, { consumed: true });
    return { orgId: invite.orgId, role: invite.role, inviteCode: invite.code };
  },
});

export const leaveOrg = defineJsMutation({
  args: { orgId: v.id('orgs') },
  writes: ['orgMembers'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ctx.membership.orgMembers.removeSelf(args.orgId);
    return true;
  },
});

// ---- reads ----

export const customerList = defineJsLiveQuery({
  args: { orgId: v.id('orgs') },
  reads: ['customers', 'orgMembers'],
  result: results.records(v.object({
    _id: v.id('customers'),
    name: v.string(),
    region: v.string(),
    createdAt: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'dispatcher', 'operator');
    const rows = await ctx.db.query('customers').withIndex('by_org').eq('orgId', args.orgId).take(100).collect();
    rows.sort((a, b) => (a.name < b.name ? -1 : 1));
    return rows.map((c) => ({ _id: c._id, name: c.name, region: c.region, createdAt: c.createdAt }));
  },
});

// Live operational dashboard with a scheduledFor range filter.
export const orgDashboard = defineJsLiveQuery({
  args: { orgId: v.id('orgs'), fromMs: v.integer(), toMs: v.integer() },
  reads: ['orgs', 'customers', 'jobs', 'jobSteps', 'activity', 'jobAttempts', 'dispatches', 'maintenanceRuns', 'followUpRuns', 'orgMembers'],
  result: results.records(v.object({
    orgName: v.string(),
    jobSeq: v.integer(),
    customers: v.integer(),
    jobsTotal: v.integer(),
    jobsOpen: v.integer(),
    jobsClaimed: v.integer(),
    jobsDone: v.integer(),
    jobsCancelled: v.integer(),
    jobsInRange: v.integer(),
    settledInRange: v.integer(),
    steps: v.integer(),
    stepsDone: v.integer(),
    activityRows: v.integer(),
    attemptReceipts: v.integer(),
    dispatchReceipts: v.integer(),
    maintenanceReceipts: v.integer(),
    followUpReceipts: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'dispatcher', 'operator');
    const org = await ctx.db.get('orgs', args.orgId);
    if (!org) throw new Error('org not found');
    const customers = await ctx.db.query('customers').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const jobs = await ctx.db.query('jobs').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const steps = await ctx.db.query('jobSteps').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const acts = await ctx.db.query('activity').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const attempts = await ctx.db.query('jobAttempts').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const dispatches = await ctx.db.query('dispatches').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const maint = await ctx.db.query('maintenanceRuns').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const followUps = await ctx.db.query('followUpRuns').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const inRange = jobs.filter((j) => j.scheduledFor >= args.fromMs && j.scheduledFor < args.toMs);
    const settledInRange = jobs.filter((j) => j.settledAt >= args.fromMs && j.settledAt < args.toMs);
    return [{
      orgName: org.name,
      jobSeq: jobs.reduce((maximum, job) => Math.max(maximum, job.seq), 0),
      customers: customers.length,
      jobsTotal: jobs.length,
      jobsOpen: jobs.filter((j) => j.status === 'open').length,
      jobsClaimed: jobs.filter((j) => j.status === 'claimed').length,
      jobsDone: jobs.filter((j) => j.status === 'done').length,
      jobsCancelled: jobs.filter((j) => j.status === 'cancelled').length,
      jobsInRange: inRange.length,
      settledInRange: settledInRange.length,
      steps: steps.length,
      stepsDone: steps.filter((s) => s.state === 'done').length,
      activityRows: acts.length,
      attemptReceipts: attempts.length,
      dispatchReceipts: dispatches.length,
      maintenanceReceipts: maint.length,
      followUpReceipts: followUps.length,
    }];
  },
});

// Bounded job list with range and status filters (newest sequence first).
export const jobList = defineJsLiveQuery({
  args: { orgId: v.id('orgs'), fromMs: v.integer(), toMs: v.integer(), status: v.string() },
  reads: ['jobs', 'customers', 'orgMembers'],
  result: results.records(v.object({
    _id: v.id('jobs'),
    seq: v.integer(),
    display: v.string(),
    title: v.string(),
    customerName: v.string(),
    status: v.string(),
    ownerName: v.string(),
    fence: v.integer(),
    attemptCount: v.integer(),
    scheduledFor: v.integer(),
    settledAt: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'dispatcher', 'operator');
    const rows = await ctx.db.query('jobs').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const filtered = rows.filter((j) => {
      const inRange = args.toMs <= 0 || (j.scheduledFor >= args.fromMs && j.scheduledFor < args.toMs);
      const statusOk = args.status === '' || j.status === args.status;
      return inRange && statusOk;
    });
    filtered.sort((a, b) => b.seq - a.seq);
    const bounded = filtered.slice(0, 100);
    const out = [];
    for (const j of bounded) {
      const customer = await ctx.db.get('customers', j.customerId);
      out.push({
        _id: j._id,
        seq: j.seq,
        display: `JOB-${j.seq}`,
        title: j.title,
        customerName: customer ? customer.name : '',
        status: j.status,
        ownerName: j.ownerName,
        fence: j.fence,
        attemptCount: j.attemptCount,
        scheduledFor: j.scheduledFor,
        settledAt: j.settledAt,
      });
    }
    return out;
  },
});

// One job with bounded children: steps (50) and newest activity (20).
export const jobDetail = defineJsLiveQuery({
  args: { jobId: v.id('jobs') },
  reads: ['jobs', 'customers', 'jobSteps', 'activity', 'jobAttempts', 'orgMembers'],
  result: results.records(v.object({
    _id: v.id('jobs'),
    seq: v.integer(),
    display: v.string(),
    title: v.string(),
    customerName: v.string(),
    status: v.string(),
    ownerId: v.string(),
    ownerName: v.string(),
    fence: v.integer(),
    attemptCount: v.integer(),
    leaseUntil: v.integer(),
    scheduledFor: v.integer(),
    settledAt: v.integer(),
    terminalDetail: v.string(),
    followUpPlatformJobId: v.string(),
    steps: v.json(), // bounded: first 50 by seq
    recentActivity: v.json(), // bounded: newest 20
    stepsTotal: v.integer(),
    stepsDone: v.integer(),
    activityTotal: v.integer(),
    activityShown: v.integer(),
    attemptReceipts: v.integer(),
  })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get('jobs', args.jobId);
    if (!job) throw new Error('job not found');
    await ctx.permissions.orgMembers.requireRole(job.orgId, 'dispatcher', 'operator');
    const customer = await ctx.db.get('customers', job.customerId);
    const steps = await ctx.db.query('jobSteps').withIndex('by_job').eq('jobId', args.jobId).take(50).collect();
    steps.sort((a, b) => a.seq - b.seq);
    const acts = await ctx.db.query('activity').withIndex('by_job_seq').eq('jobId', `${args.jobId}`).take(300).collect();
    acts.sort((a, b) => b.seq - a.seq);
    const recent = acts.slice(0, 20);
    const attempts = await ctx.db.query('jobAttempts').withIndex('by_job_seq').eq('jobId', args.jobId).take(200).collect();
    return [{
      _id: job._id,
      seq: job.seq,
      display: `JOB-${job.seq}`,
      title: job.title,
      customerName: customer ? customer.name : '',
      status: job.status,
      ownerId: job.ownerId,
      ownerName: job.ownerName,
      fence: job.fence,
      attemptCount: job.attemptCount,
      leaseUntil: job.leaseUntil,
      scheduledFor: job.scheduledFor,
      settledAt: job.settledAt,
      terminalDetail: job.terminalDetail,
      followUpPlatformJobId: job.followUpPlatformJobId,
      steps: steps.map((s) => ({ seq: s.seq, title: s.title, state: s.state, doneByName: s.doneByName, at: s.at })),
      recentActivity: recent.map((a) => ({ seq: a.seq, actorName: a.actorName, kind: a.kind, detail: a.detail, at: a.at })),
      stepsTotal: steps.length,
      stepsDone: steps.filter((s) => s.state === 'done').length,
      activityTotal: acts.length,
      activityShown: recent.length,
      attemptReceipts: attempts.length,
    }];
  },
});

export const attemptLedger = defineJsQuery({
  args: { jobId: v.id('jobs') },
  reads: ['jobs', 'jobAttempts', 'orgMembers'],
  result: results.records(v.object({
    seq: v.integer(),
    attemptSeq: v.integer(),
    event: v.string(),
    actorName: v.string(),
    outcome: v.string(),
    detail: v.string(),
    at: v.integer(),
  })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get('jobs', args.jobId);
    if (!job) throw new Error('job not found');
    await ctx.permissions.orgMembers.requireRole(job.orgId, 'dispatcher', 'operator');
    const rows = await ctx.db.query('jobAttempts').withIndex('by_job_seq').eq('jobId', args.jobId).take(200).collect();
    rows.sort((a, b) => a.seq - b.seq);
    return rows.map((r) => ({
      seq: r.seq, attemptSeq: r.attemptSeq, event: r.event,
      actorName: r.actorName, outcome: r.outcome, detail: r.detail, at: r.at,
    }));
  },
});

export const dispatchLedger = defineJsQuery({
  args: { orgId: v.id('orgs') },
  reads: ['dispatches', 'orgMembers'],
  result: results.records(v.object({
    jobSeqNum: v.integer(),
    dedupeKey: v.string(),
    outcome: v.string(),
    providerStatus: v.integer(),
    bytes: v.integer(),
    detail: v.string(),
    at: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'dispatcher');
    const rows = await ctx.db.query('dispatches').withIndex('by_org').eq('orgId', args.orgId).take(200).collect();
    rows.sort((a, b) => a.at - b.at || (a.dedupeKey < b.dedupeKey ? -1 : 1));
    return rows.map((r) => ({
      jobSeqNum: r.jobSeqNum, dedupeKey: r.dedupeKey, outcome: r.outcome,
      providerStatus: r.providerStatus, bytes: r.bytes, detail: r.detail, at: r.at,
    }));
  },
});

export const maintenanceLedger = defineJsQuery({
  args: { orgId: v.id('orgs') },
  reads: ['maintenanceRuns', 'orgMembers'],
  result: results.records(v.object({
    dedupeKey: v.string(),
    nominalMs: v.integer(),
    timedOutCount: v.integer(),
    outcome: v.string(),
    detail: v.string(),
    at: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'dispatcher');
    const rows = await ctx.db.query('maintenanceRuns').withIndex('by_org').eq('orgId', args.orgId).take(200).collect();
    rows.sort((a, b) => a.nominalMs - b.nominalMs);
    return rows.map((r) => ({
      dedupeKey: r.dedupeKey, nominalMs: r.nominalMs, timedOutCount: r.timedOutCount,
      outcome: r.outcome, detail: r.detail, at: r.at,
    }));
  },
});

export const followUpLedger = defineJsQuery({
  args: { orgId: v.id('orgs') },
  reads: ['followUpRuns', 'orgMembers'],
  result: results.records(v.object({
    jobSeqNum: v.integer(),
    dedupeKey: v.string(),
    detail: v.string(),
    at: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'dispatcher', 'operator');
    const rows = await ctx.db.query('followUpRuns').withIndex('by_org').eq('orgId', args.orgId).take(200).collect();
    rows.sort((a, b) => a.at - b.at);
    return rows.map((r) => ({ jobSeqNum: r.jobSeqNum, dedupeKey: r.dedupeKey, detail: r.detail, at: r.at }));
  },
});

// The generated declared job-status live query (defineJobStatusQuery) is
// UNBOOTABLE on packaged 0.1.7: codegen accepts it and emits a plan
// referencing table `_snapback_jobs`, but the server refuses the whole app
// at load with SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID (the runtime's
// platform table is `_snapback_jobs_v1`). Finding 0137-a6-f1; probe
// evidence retained. One-off job status is read through the admin route
// GET /_snapback/api/jobs/{id} instead.

// Full-ledger export: id-free natural-key projection (jobs keyed by seq,
// customers by name, children by (jobSeq, seq), receipts by dedupeKey), so
// restore can rebuild rows whose _ids necessarily change on re-insert.
export const exportLedger = defineJsQuery({
  args: { orgId: v.id('orgs') },
  reads: ['orgs', 'customers', 'jobs', 'jobSteps', 'activity', 'jobAttempts', 'dispatches', 'maintenanceRuns', 'followUpRuns', 'orgMembers'],
  result: results.records(v.object({
    org: v.json(),
    customers: v.json(),
    jobs: v.json(),
    steps: v.json(),
    activity: v.json(),
    attempts: v.json(),
    dispatches: v.json(),
    maintenanceRuns: v.json(),
    followUpRuns: v.json(),
    counts: v.json(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'dispatcher');
    const org = await ctx.db.get('orgs', args.orgId);
    if (!org) throw new Error('org not found');
    const customers = await ctx.db.query('customers').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const jobs = await ctx.db.query('jobs').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const steps = await ctx.db.query('jobSteps').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const acts = await ctx.db.query('activity').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const attempts = await ctx.db.query('jobAttempts').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const dispatches = await ctx.db.query('dispatches').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const maint = await ctx.db.query('maintenanceRuns').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const followUps = await ctx.db.query('followUpRuns').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const jobSeqById = new Map();
    for (const j of jobs) jobSeqById.set(j._id, j.seq);
    const customerNameById = new Map();
    for (const c of customers) customerNameById.set(c._id, c.name);
    customers.sort((a, b) => (a.name < b.name ? -1 : 1));
    jobs.sort((a, b) => a.seq - b.seq);
    steps.sort((a, b) => (jobSeqById.get(a.jobId) - jobSeqById.get(b.jobId)) || (a.seq - b.seq));
    acts.sort((a, b) => {
      const ak = a.jobId === '' ? 0 : jobSeqById.get(a.jobId);
      const bk = b.jobId === '' ? 0 : jobSeqById.get(b.jobId);
      return (ak - bk) || (a.seq - b.seq);
    });
    attempts.sort((a, b) => (jobSeqById.get(a.jobId) - jobSeqById.get(b.jobId)) || (a.seq - b.seq));
    dispatches.sort((a, b) => (a.dedupeKey < b.dedupeKey ? -1 : 1));
    maint.sort((a, b) => a.nominalMs - b.nominalMs);
    followUps.sort((a, b) => (a.dedupeKey < b.dedupeKey ? -1 : 1));
    return [{
      org: {
        name: org.name,
        jobSeq: jobs.reduce((maximum, job) => Math.max(maximum, job.seq), 0),
      },
      customers: customers.map((c) => ({ name: c.name, region: c.region, createdAt: c.createdAt })),
      jobs: jobs.map((j) => ({
        seq: j.seq, title: j.title, customerName: customerNameById.get(j.customerId) ?? '',
        status: j.status, ownerId: j.ownerId, ownerName: j.ownerName, fence: j.fence,
        attemptCount: j.attemptCount, leaseUntil: j.leaseUntil, scheduledFor: j.scheduledFor,
        dedupeKey: j.dedupeKey, followUpPlatformJobId: j.followUpPlatformJobId,
        createdAt: j.createdAt, updatedAt: j.updatedAt, settledAt: j.settledAt,
        terminalDetail: j.terminalDetail,
      })),
      steps: steps.map((s) => ({
        jobSeq: jobSeqById.get(s.jobId) ?? 0, seq: s.seq, title: s.title,
        state: s.state, doneByName: s.doneByName, at: s.at,
      })),
      activity: acts.map((a) => ({
        jobSeq: a.jobId === '' ? 0 : (jobSeqById.get(a.jobId) ?? 0), seq: a.seq,
        actorName: a.actorName, kind: a.kind, detail: a.detail, at: a.at,
      })),
      attempts: attempts.map((r) => ({
        jobSeq: jobSeqById.get(r.jobId) ?? 0, seq: r.seq, attemptSeq: r.attemptSeq,
        event: r.event, actorName: r.actorName, outcome: r.outcome, detail: r.detail, at: r.at,
      })),
      dispatches: dispatches.map((d) => ({
        jobSeq: d.jobSeqNum, dedupeKey: d.dedupeKey, outcome: d.outcome,
        providerStatus: d.providerStatus, bytes: d.bytes, detail: d.detail, at: d.at,
      })),
      maintenanceRuns: maint.map((m) => ({
        dedupeKey: m.dedupeKey, nominalMs: m.nominalMs, timedOutCount: m.timedOutCount,
        outcome: m.outcome, detail: m.detail, at: m.at,
      })),
      followUpRuns: followUps.map((f) => ({
        jobSeq: f.jobSeqNum, dedupeKey: f.dedupeKey, detail: f.detail, at: f.at,
      })),
      counts: {
        customers: customers.length, jobs: jobs.length, steps: steps.length,
        activity: acts.length, attempts: attempts.length, dispatches: dispatches.length,
        maintenanceRuns: maint.length, followUpRuns: followUps.length,
      },
    }];
  },
});

// ---- job lifecycle mutations ----

// Brownfield fixture bridge: the literal seed predates the framework counter
// and already contains JOB-1..JOB-3. Acceptance records those three historical
// allocation events through the real primitive before concurrent creates.
// This is ordinary committed allocation (deleted rows need not survive), not
// an authored start/step or a direct counter-table write.
export const primeJobSequence = defineJsMutation({
  args: { orgId: v.id('orgs') },
  reads: ['orgs'],
  writes: [],
  sequences: [{
    name: 'jobNumber',
    scopeTable: 'orgs',
    scopeAccess: { declaration: 'orgMembers', roles: ['dispatcher', 'operator'] },
  }],
  result: results.value(v.object({ sequence: v.integer() })),
  handler: async (ctx, args) => ({
    sequence: await ctx.sequence.allocate('jobNumber', args.orgId),
  }),
});

export const createJob = defineJsMutation({
  args: {
    orgId: v.id('orgs'),
    title: v.string(),
    customerId: v.id('customers'),
    scheduledFor: v.integer(),
    dedupeKey: v.string(),
    creatorName: v.string(),
    followUpDelayMs: v.integer(),
  },
  reads: ['orgs', 'jobs', 'customers', 'activity'],
  writes: ['jobs', 'jobSteps', 'activity'],
  sequences: [{
    name: 'jobNumber',
    scopeTable: 'orgs',
    scopeAccess: {
      declaration: 'orgMembers',
      roles: ['dispatcher', 'operator'],
    },
  }],
  result: results.value(v.object({
    jobId: v.id('jobs'),
    seq: v.integer(),
    display: v.string(),
    deduped: v.boolean(),
    platformJobId: v.string(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'dispatcher', 'operator');
    const existing = await ctx.db.query('jobs').withIndex('by_org_dedupe')
      .eq('orgId', args.orgId).eq('dedupeKey', args.dedupeKey).collect();
    if (existing.length > 0) {
      const j = existing[0];
      return { jobId: j._id, seq: j.seq, display: `JOB-${j.seq}`, deduped: true, platformJobId: j.followUpPlatformJobId };
    }
    const customer = await ctx.db.get('customers', args.customerId);
    if (!customer || customer.orgId !== args.orgId) throw new Error('customer not found in org');
    // @ref LLP 0135#12-allocation-surfaces — scope is explicit at the call,
    // and the host buffers this counter advance with every write below.
    const seq = await ctx.sequence.allocate('jobNumber', args.orgId);
    const now = ctx.runtime.now();
    // One-off transactional schedule: the follow-up sweep is enqueued in
    // the SAME transaction as the job insert (jobs_one_off_v1), so a
    // rejected create schedules nothing.
    let platformJobId = '';
    const jobId = await ctx.db.insert('jobs', {
      orgId: args.orgId,
      seq,
      title: args.title,
      customerId: args.customerId,
      status: 'open',
      ownerId: '',
      ownerName: '',
      fence: 0,
      attemptCount: 0,
      leaseUntil: 0,
      scheduledFor: args.scheduledFor,
      dedupeKey: args.dedupeKey,
      followUpPlatformJobId: '',
      createdAt: now,
      updatedAt: now,
      settledAt: 0,
      terminalDetail: '',
    });
    if (args.followUpDelayMs > 0) {
      const enq = await ctx.jobs.enqueue('followUpSweep', {
        jobId: `${jobId}`,
        orgId: `${args.orgId}`,
        jobSeqNum: seq,
        runKey: `followup-run-${seq}`,
      }, {
        delayMs: args.followUpDelayMs,
        idempotencyKey: `followup-${seq}`,
        maxAttempts: 1,
      });
      platformJobId = `${enq && enq.jobId ? enq.jobId : enq}`;
      await ctx.db.patch('jobs', jobId, { followUpPlatformJobId: platformJobId });
    }
    await ctx.db.insert('activity', {
      orgId: args.orgId, jobId: `${jobId}`, seq: 1, actorName: args.creatorName,
      kind: 'created', detail: `JOB-${seq} created (${args.title})`, at: now,
    });
    return { jobId, seq, display: `JOB-${seq}`, deduped: false, platformJobId };
  },
});

export const addJobNote = defineJsMutation({
  args: { jobId: v.id('jobs'), actorName: v.string(), detail: v.string() },
  reads: ['jobs', 'activity'],
  writes: ['activity'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    const job = await ctx.db.get('jobs', args.jobId);
    if (!job) throw new Error('job not found');
    await ctx.permissions.orgMembers.requireRole(job.orgId, 'dispatcher', 'operator');
    const acts = await ctx.db.query('activity').withIndex('by_job_seq').eq('jobId', `${args.jobId}`).take(300).collect();
    const seq = acts.length + 1;
    await ctx.db.insert('activity', {
      orgId: job.orgId, jobId: `${args.jobId}`, seq, actorName: args.actorName,
      kind: 'note', detail: args.detail, at: ctx.runtime.now(),
    });
    return seq;
  },
});

export const claimJob = defineJsMutation({
  args: { jobId: v.id('jobs'), actorName: v.string(), leaseMs: v.integer() },
  reads: ['jobs', 'jobAttempts', 'activity'],
  writes: ['jobs', 'jobAttempts', 'activity'],
  result: results.value(v.object({
    claimed: v.boolean(),
    status: v.string(),
    fence: v.integer(),
    attemptSeq: v.integer(),
    owner: v.string(),
    reason: v.string(),
  })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get('jobs', args.jobId);
    if (!job) throw new Error('job not found');
    await ctx.permissions.orgMembers.requireRole(job.orgId, 'dispatcher', 'operator');
    const now = ctx.runtime.now();
    const receipts = await ctx.db.query('jobAttempts').withIndex('by_job_seq').eq('jobId', args.jobId).take(200).collect();
    const nextReceiptSeq = receipts.length + 1;
    if (job.status !== 'open') {
      // Concurrent-claim loser or late claim: receipt only, no state change.
      await ctx.db.insert('jobAttempts', {
        jobId: job._id, orgId: job.orgId, seq: nextReceiptSeq, attemptSeq: job.attemptCount,
        event: 'claim-rejected', actorName: args.actorName, outcome: job.status,
        detail: `claim rejected: job is ${job.status}${job.ownerName ? ` (owner ${job.ownerName})` : ''}`, at: now,
      });
      return { claimed: false, status: job.status, fence: job.fence, attemptSeq: job.attemptCount, owner: job.ownerName, reason: `job is ${job.status}` };
    }
    const fence = job.fence + 1;
    const attemptSeq = job.attemptCount + 1;
    await ctx.db.patch('jobs', args.jobId, {
      status: 'claimed', ownerId: `${ctx.auth.userId}`, ownerName: args.actorName,
      fence, attemptCount: attemptSeq,
      leaseUntil: now + (args.leaseMs > 0 ? args.leaseMs : 60000), updatedAt: now,
    });
    await ctx.db.insert('jobAttempts', {
      jobId: job._id, orgId: job.orgId, seq: nextReceiptSeq, attemptSeq,
      event: 'claimed', actorName: args.actorName, outcome: 'claimed',
      detail: `attempt ${attemptSeq} claimed with fence ${fence}`, at: now,
    });
    const acts = await ctx.db.query('activity').withIndex('by_job_seq').eq('jobId', `${args.jobId}`).take(300).collect();
    await ctx.db.insert('activity', {
      orgId: job.orgId, jobId: `${args.jobId}`, seq: acts.length + 1, actorName: args.actorName,
      kind: 'claimed', detail: `JOB-${job.seq} claimed (attempt ${attemptSeq}, fence ${fence})`, at: now,
    });
    return { claimed: true, status: 'claimed', fence, attemptSeq, owner: args.actorName, reason: '' };
  },
});

export const completeStep = defineJsMutation({
  args: { jobId: v.id('jobs'), stepSeq: v.integer(), fence: v.integer(), actorName: v.string() },
  reads: ['jobs', 'jobSteps', 'jobAttempts', 'activity'],
  writes: ['jobSteps', 'jobAttempts', 'activity'],
  result: results.value(v.object({
    fenced: v.boolean(),
    stepState: v.string(),
    reason: v.string(),
  })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get('jobs', args.jobId);
    if (!job) throw new Error('job not found');
    await ctx.permissions.orgMembers.requireRole(job.orgId, 'dispatcher', 'operator');
    const now = ctx.runtime.now();
    // Ownership fence: the caller must be the CURRENT owner holding the
    // CURRENT fence; anything else writes only an append-only receipt.
    if (job.status !== 'claimed' || job.ownerId !== `${ctx.auth.userId}` || job.fence !== args.fence) {
      const receipts = await ctx.db.query('jobAttempts').withIndex('by_job_seq').eq('jobId', args.jobId).take(200).collect();
      await ctx.db.insert('jobAttempts', {
        jobId: job._id, orgId: job.orgId, seq: receipts.length + 1, attemptSeq: job.attemptCount,
        event: 'fenced', actorName: args.actorName, outcome: 'completeStep',
        detail: `late step write fenced: status=${job.status} fence=${job.fence} presented=${args.fence}`, at: now,
      });
      return { fenced: true, stepState: '', reason: `status=${job.status} fence=${job.fence} presented=${args.fence}` };
    }
    const steps = await ctx.db.query('jobSteps').withIndex('by_job_seq')
      .eq('jobId', args.jobId).eq('seq', args.stepSeq).collect();
    const step = steps[0];
    if (!step) throw new Error('step not found');
    await ctx.db.patch('jobSteps', step._id, { state: 'done', doneByName: args.actorName, at: now });
    const acts = await ctx.db.query('activity').withIndex('by_job_seq').eq('jobId', `${args.jobId}`).take(300).collect();
    await ctx.db.insert('activity', {
      orgId: job.orgId, jobId: `${args.jobId}`, seq: acts.length + 1, actorName: args.actorName,
      kind: 'step-done', detail: `step ${args.stepSeq} (${step.title}) done`, at: now,
    });
    return { fenced: false, stepState: 'done', reason: '' };
  },
});

export const completeJob = defineJsMutation({
  args: { jobId: v.id('jobs'), fence: v.integer(), actorName: v.string() },
  reads: ['jobs', 'jobSteps', 'jobAttempts', 'activity'],
  writes: ['jobs', 'jobAttempts', 'activity'],
  result: results.value(v.object({
    fenced: v.boolean(),
    status: v.string(),
    settledAt: v.integer(),
    stepsDone: v.integer(),
    reason: v.string(),
  })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get('jobs', args.jobId);
    if (!job) throw new Error('job not found');
    await ctx.permissions.orgMembers.requireRole(job.orgId, 'dispatcher', 'operator');
    const now = ctx.runtime.now();
    if (job.status !== 'claimed' || job.ownerId !== `${ctx.auth.userId}` || job.fence !== args.fence) {
      const receipts = await ctx.db.query('jobAttempts').withIndex('by_job_seq').eq('jobId', args.jobId).take(200).collect();
      await ctx.db.insert('jobAttempts', {
        jobId: job._id, orgId: job.orgId, seq: receipts.length + 1, attemptSeq: job.attemptCount,
        event: 'fenced', actorName: args.actorName, outcome: 'completeJob',
        detail: `late completion fenced: status=${job.status} fence=${job.fence} presented=${args.fence}`, at: now,
      });
      return { fenced: true, status: job.status, settledAt: job.settledAt, stepsDone: 0, reason: `status=${job.status} fence=${job.fence} presented=${args.fence}` };
    }
    const steps = await ctx.db.query('jobSteps').withIndex('by_job').eq('jobId', args.jobId).take(50).collect();
    const stepsDone = steps.filter((s) => s.state === 'done').length;
    await ctx.db.patch('jobs', args.jobId, {
      status: 'done', leaseUntil: 0, updatedAt: now, settledAt: now,
      terminalDetail: `completed by ${args.actorName} (${stepsDone}/${steps.length} steps done)`,
    });
    const receipts = await ctx.db.query('jobAttempts').withIndex('by_job_seq').eq('jobId', args.jobId).take(200).collect();
    await ctx.db.insert('jobAttempts', {
      jobId: job._id, orgId: job.orgId, seq: receipts.length + 1, attemptSeq: job.attemptCount,
      event: 'completed', actorName: args.actorName, outcome: 'done',
      detail: `attempt ${job.attemptCount} completed the job`, at: now,
    });
    const acts = await ctx.db.query('activity').withIndex('by_job_seq').eq('jobId', `${args.jobId}`).take(300).collect();
    await ctx.db.insert('activity', {
      orgId: job.orgId, jobId: `${args.jobId}`, seq: acts.length + 1, actorName: args.actorName,
      kind: 'status', detail: `JOB-${job.seq} settled done`, at: now,
    });
    return { fenced: false, status: 'done', settledAt: now, stepsDone, reason: '' };
  },
});

export const releaseJob = defineJsMutation({
  args: { jobId: v.id('jobs'), fence: v.integer(), actorName: v.string(), reason: v.string() },
  reads: ['jobs', 'jobAttempts', 'activity'],
  writes: ['jobs', 'jobAttempts', 'activity'],
  result: results.value(v.object({
    fenced: v.boolean(),
    status: v.string(),
    reason: v.string(),
  })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get('jobs', args.jobId);
    if (!job) throw new Error('job not found');
    await ctx.permissions.orgMembers.requireRole(job.orgId, 'dispatcher', 'operator');
    const now = ctx.runtime.now();
    if (job.status !== 'claimed' || job.ownerId !== `${ctx.auth.userId}` || job.fence !== args.fence) {
      const receipts = await ctx.db.query('jobAttempts').withIndex('by_job_seq').eq('jobId', args.jobId).take(200).collect();
      await ctx.db.insert('jobAttempts', {
        jobId: job._id, orgId: job.orgId, seq: receipts.length + 1, attemptSeq: job.attemptCount,
        event: 'fenced', actorName: args.actorName, outcome: 'releaseJob',
        detail: `late release fenced: status=${job.status} fence=${job.fence} presented=${args.fence}`, at: now,
      });
      return { fenced: true, status: job.status, reason: `status=${job.status} fence=${job.fence} presented=${args.fence}` };
    }
    await ctx.db.patch('jobs', args.jobId, {
      status: 'open', ownerId: '', ownerName: '', leaseUntil: 0, updatedAt: now,
    });
    const receipts = await ctx.db.query('jobAttempts').withIndex('by_job_seq').eq('jobId', args.jobId).take(200).collect();
    await ctx.db.insert('jobAttempts', {
      jobId: job._id, orgId: job.orgId, seq: receipts.length + 1, attemptSeq: job.attemptCount,
      event: 'released', actorName: args.actorName, outcome: 'open',
      detail: `attempt ${job.attemptCount} released: ${args.reason}`, at: now,
    });
    const acts = await ctx.db.query('activity').withIndex('by_job_seq').eq('jobId', `${args.jobId}`).take(300).collect();
    await ctx.db.insert('activity', {
      orgId: job.orgId, jobId: `${args.jobId}`, seq: acts.length + 1, actorName: args.actorName,
      kind: 'released', detail: `JOB-${job.seq} released back to open: ${args.reason}`, at: now,
    });
    return { fenced: false, status: 'open', reason: '' };
  },
});

export const cancelJob = defineJsMutation({
  args: { jobId: v.id('jobs'), reason: v.string(), actorName: v.string() },
  reads: ['jobs', 'jobAttempts', 'activity'],
  writes: ['jobs', 'jobAttempts', 'activity'],
  result: results.value(v.object({
    fenced: v.boolean(),
    status: v.string(),
    settledAt: v.integer(),
  })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get('jobs', args.jobId);
    if (!job) throw new Error('job not found');
    await ctx.permissions.orgMembers.requireRole(job.orgId, 'dispatcher');
    const now = ctx.runtime.now();
    const receipts = await ctx.db.query('jobAttempts').withIndex('by_job_seq').eq('jobId', args.jobId).take(200).collect();
    if (job.status === 'done' || job.status === 'cancelled') {
      await ctx.db.insert('jobAttempts', {
        jobId: job._id, orgId: job.orgId, seq: receipts.length + 1, attemptSeq: job.attemptCount,
        event: 'fenced', actorName: args.actorName, outcome: 'cancelJob',
        detail: `late cancellation fenced: job already ${job.status}`, at: now,
      });
      return { fenced: true, status: job.status, settledAt: job.settledAt };
    }
    await ctx.db.patch('jobs', args.jobId, {
      status: 'cancelled', ownerId: '', ownerName: '', leaseUntil: 0,
      updatedAt: now, settledAt: now, terminalDetail: `cancelled by ${args.actorName}: ${args.reason}`,
    });
    await ctx.db.insert('jobAttempts', {
      jobId: job._id, orgId: job.orgId, seq: receipts.length + 1, attemptSeq: job.attemptCount,
      event: 'cancelled', actorName: args.actorName, outcome: 'cancelled',
      detail: `cancelled: ${args.reason}`, at: now,
    });
    const acts = await ctx.db.query('activity').withIndex('by_job_seq').eq('jobId', `${args.jobId}`).take(300).collect();
    await ctx.db.insert('activity', {
      orgId: job.orgId, jobId: `${args.jobId}`, seq: acts.length + 1, actorName: args.actorName,
      kind: 'cancelled', detail: `JOB-${job.seq} cancelled: ${args.reason}`, at: now,
    });
    return { fenced: false, status: 'cancelled', settledAt: now };
  },
});

// ---- recurring maintenance (cron) ----

// One maintenance pass per nominal: expires overdue claims (lease timeout)
// and writes exactly one receipt. The scheduler invokes this with system
// authority; a direct human call requires a dispatcher seat.
export const maintenanceStep = defineJsMutation({
  args: {},
  reads: ['orgs', 'jobs', 'jobAttempts', 'activity', 'maintenanceRuns'],
  writes: ['jobs', 'jobAttempts', 'activity', 'maintenanceRuns'],
  result: results.value(v.object({
    alreadyRan: v.boolean(),
    dedupeKey: v.string(),
    nominalMs: v.integer(),
    timedOutCount: v.integer(),
    expiredSeqs: v.json(),
  })),
  handler: async (ctx) => {
    const orgs = await ctx.db.query('orgs').take(10).collect();
    const org = orgs[0];
    if (!org) throw new Error('org missing from seed');
    if (ctx.auth && ctx.auth.userId) {
      await ctx.permissions.orgMembers.requireRole(org._id, 'dispatcher');
    }
    const nominalMs = ctx.runtime.now();
    const dedupeKey = `maint:${nominalMs}`;
    const existing = await ctx.db.query('maintenanceRuns').withIndex('by_dedupe').eq('dedupeKey', dedupeKey).collect();
    if (existing.length > 0) {
      return { alreadyRan: true, dedupeKey, nominalMs, timedOutCount: existing[0].timedOutCount, expiredSeqs: [] };
    }
    const jobs = await ctx.db.query('jobs').withIndex('by_org').eq('orgId', org._id).take(500).collect();
    const overdue = jobs.filter((j) => j.status === 'claimed' && j.leaseUntil > 0 && j.leaseUntil < nominalMs);
    const expiredSeqs = [];
    for (const job of overdue) {
      await ctx.db.patch('jobs', job._id, {
        status: 'open', ownerId: '', ownerName: '', leaseUntil: 0, updatedAt: nominalMs,
      });
      const receipts = await ctx.db.query('jobAttempts').withIndex('by_job_seq').eq('jobId', job._id).take(200).collect();
      await ctx.db.insert('jobAttempts', {
        jobId: job._id, orgId: job.orgId, seq: receipts.length + 1, attemptSeq: job.attemptCount,
        event: 'timed-out', actorName: 'maintenance', outcome: 'open',
        detail: `attempt ${job.attemptCount} lease expired (leaseUntil ${job.leaseUntil} < ${nominalMs})`, at: nominalMs,
      });
      const acts = await ctx.db.query('activity').withIndex('by_job_seq').eq('jobId', `${job._id}`).take(300).collect();
      await ctx.db.insert('activity', {
        orgId: job.orgId, jobId: `${job._id}`, seq: acts.length + 1, actorName: 'maintenance',
        kind: 'timed-out', detail: `JOB-${job.seq} lease expired; returned to open`, at: nominalMs,
      });
      expiredSeqs.push(job.seq);
    }
    const orgActs = await ctx.db.query('activity').withIndex('by_job_seq').eq('jobId', '').take(300).collect();
    await ctx.db.insert('activity', {
      orgId: org._id, jobId: '', seq: orgActs.length + 1, actorName: 'maintenance',
      kind: 'maintenance', detail: `maintenance pass: ${overdue.length} lease(s) expired`, at: nominalMs,
    });
    await ctx.db.insert('maintenanceRuns', {
      orgId: org._id, dedupeKey, nominalMs, timedOutCount: overdue.length,
      outcome: 'swept', detail: `expired ${overdue.length} overdue claim(s)`, at: nominalMs,
    });
    return { alreadyRan: false, dedupeKey, nominalMs, timedOutCount: overdue.length, expiredSeqs };
  },
});

export const runMaintenance = defineAction({
  args: { trigger: v.optional(v.string()) },
  result: results.value(v.object({
    alreadyRan: v.boolean(),
    dedupeKey: v.string(),
    nominalMs: v.integer(),
    timedOutCount: v.integer(),
  })),
  writes: ['jobs', 'jobAttempts', 'activity', 'maintenanceRuns'],
  handler: async (ctx) => {
    const pass = await ctx.runMutation('maintenanceStep', {});
    return {
      alreadyRan: pass.alreadyRan,
      dedupeKey: pass.dedupeKey,
      nominalMs: pass.nominalMs,
      timedOutCount: pass.timedOutCount,
    };
  },
});

// jitter:false — the 1s cadence is this acceptance rig's fixed scan
// interval; every scheduler run in the suite is a deterministic
// authenticated tick (SNAPBACK_CRON_DISABLED=1). The epoch-0 catch-up
// nominal is a known everyMs behavior (0137-a4-f4, cited in evidence).
export const maintenanceCron = defineCron({
  maintenanceTick: {
    schedule: { everyMs: 1_000, jitter: false },
    action: 'runMaintenance',
  },
});

// ---- one-off follow-up sweep (jobs_one_off_v1 callee) ----

export const recordFollowUp = defineJsMutation({
  args: { orgId: v.id('orgs'), jobId: v.string(), jobSeqNum: v.integer(), runKey: v.string() },
  reads: ['followUpRuns', 'activity'],
  writes: ['followUpRuns', 'activity'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    if (ctx.auth && ctx.auth.userId) {
      await ctx.permissions.orgMembers.requireRole(args.orgId, 'dispatcher');
    }
    const existing = await ctx.db.query('followUpRuns').withIndex('by_dedupe').eq('dedupeKey', args.runKey).collect();
    if (existing.length > 0) return 'deduped';
    const now = ctx.runtime.now();
    await ctx.db.insert('followUpRuns', {
      orgId: args.orgId, jobId: args.jobId, jobSeqNum: args.jobSeqNum,
      dedupeKey: args.runKey, detail: `follow-up sweep ran for JOB-${args.jobSeqNum}`, at: now,
    });
    const acts = await ctx.db.query('activity').withIndex('by_job_seq').eq('jobId', args.jobId).take(300).collect();
    await ctx.db.insert('activity', {
      orgId: args.orgId, jobId: args.jobId, seq: acts.length + 1, actorName: 'follow-up',
      kind: 'follow-up', detail: `scheduled follow-up sweep ran for JOB-${args.jobSeqNum}`, at: now,
    });
    return 'ran';
  },
});

export const followUpSweep = defineAction({
  args: { jobId: v.string(), orgId: v.string(), jobSeqNum: v.integer(), runKey: v.string() },
  result: results.value(v.string()),
  writes: ['followUpRuns', 'activity'],
  handler: async (ctx, args) => {
    const outcome = await ctx.runMutation('recordFollowUp', {
      orgId: args.orgId, jobId: args.jobId, jobSeqNum: args.jobSeqNum, runKey: args.runKey,
    });
    return outcome;
  },
});

// ---- idempotent external dispatch ----

export const appConfig = defineConfig({
  dispatchToken: {
    description: 'Bearer token for the external dispatch provider endpoint',
    purpose: 'Authorizes outbound job-dispatch calls; never readable by clients',
    required: false,
  },
});

export const setDispatchEndpoint = defineJsMutation({
  args: { orgId: v.id('orgs'), url: v.string() },
  reads: ['dispatchSettings'],
  writes: ['dispatchSettings'],
  result: results.value(v.integer()),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'dispatcher');
    const rows = await ctx.db.query('dispatchSettings').withIndex('by_org').eq('orgId', args.orgId).collect();
    if (rows.length === 0) throw new Error('dispatch settings row missing from seed');
    await ctx.db.patch('dispatchSettings', rows[0]._id, { url: args.url, updatedAt: ctx.runtime.now() });
    return 1;
  },
});

export const beginDispatch = defineJsMutation({
  args: { jobId: v.id('jobs') },
  // declared write-set is an upper bound; this mutation only reads, but
  // defineJsMutation refuses an empty writes list (a5 arm observation)
  reads: ['jobs', 'dispatchSettings', 'dispatches'],
  writes: ['dispatches'],
  result: results.value(v.object({
    enabled: v.boolean(),
    alreadyRan: v.boolean(),
    priorOutcome: v.string(),
    url: v.string(),
    dedupeKey: v.string(),
    orgId: v.string(),
    jobSeqNum: v.integer(),
    title: v.string(),
  })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get('jobs', args.jobId);
    if (!job) throw new Error('job not found');
    await ctx.permissions.orgMembers.requireRole(job.orgId, 'dispatcher', 'operator');
    const settings = await ctx.db.query('dispatchSettings').withIndex('by_org').eq('orgId', job.orgId).collect();
    const dedupeKey = `dispatch-${job.seq}`;
    const existing = await ctx.db.query('dispatches').withIndex('by_dedupe').eq('dedupeKey', dedupeKey).collect();
    return {
      enabled: settings.length > 0 && settings[0].url !== '',
      alreadyRan: existing.length > 0,
      priorOutcome: existing.length > 0 ? existing[0].outcome : '',
      url: settings.length > 0 ? settings[0].url : '',
      dedupeKey,
      orgId: `${job.orgId}`,
      jobSeqNum: job.seq,
      title: job.title,
    };
  },
});

export const recordDispatch = defineJsMutation({
  args: {
    orgId: v.id('orgs'),
    jobId: v.id('jobs'),
    jobSeqNum: v.integer(),
    dedupeKey: v.string(),
    outcome: v.string(),
    providerStatus: v.integer(),
    bytes: v.integer(),
    detail: v.string(),
  },
  reads: ['dispatches', 'activity'],
  writes: ['dispatches', 'activity'],
  result: results.value(v.string()),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'dispatcher', 'operator');
    const existing = await ctx.db.query('dispatches').withIndex('by_dedupe').eq('dedupeKey', args.dedupeKey).collect();
    if (existing.length > 0) return existing[0].outcome;
    const now = ctx.runtime.now();
    await ctx.db.insert('dispatches', {
      orgId: args.orgId, jobId: args.jobId, jobSeqNum: args.jobSeqNum,
      dedupeKey: args.dedupeKey, outcome: args.outcome, providerStatus: args.providerStatus,
      bytes: args.bytes, detail: args.detail, at: now,
    });
    const acts = await ctx.db.query('activity').withIndex('by_job_seq').eq('jobId', `${args.jobId}`).take(300).collect();
    await ctx.db.insert('activity', {
      orgId: args.orgId, jobId: `${args.jobId}`, seq: acts.length + 1, actorName: 'dispatch',
      kind: 'dispatched', detail: `JOB-${args.jobSeqNum} dispatch ${args.outcome} (provider ${args.providerStatus})`, at: now,
    });
    return args.outcome;
  },
});

export const dispatchJob = defineAction({
  args: { jobId: v.string(), trigger: v.optional(v.string()) },
  result: results.value(v.object({
    outcome: v.string(),
    dedupeKey: v.string(),
    providerStatus: v.integer(),
    bytes: v.integer(),
    detail: v.string(),
  })),
  uses: ['dispatchToken'],
  writes: ['dispatches', 'activity'],
  handler: async (ctx, args) => {
    const begin = await ctx.runMutation('beginDispatch', { jobId: args.jobId });
    if (!begin.enabled) {
      return { outcome: 'skipped-disabled', dedupeKey: begin.dedupeKey, providerStatus: 0, bytes: 0, detail: 'dispatch endpoint not configured' };
    }
    if (begin.alreadyRan) {
      return { outcome: 'deduped', dedupeKey: begin.dedupeKey, providerStatus: 0, bytes: 0, detail: `dispatch already settled (${begin.priorOutcome})` };
    }
    const token = ctx.secrets.get('dispatchToken');
    // The STREAMED egress lane is the only working egress on 0.1.7 (known
    // 0137-a5-f1 / 0137-a4-f1): streamAttempt custody keyed by the dispatch
    // dedupe key + fetchStream with the secret staged server-side.
    let outcome = 'failed';
    let detail = '';
    let providerStatus = 0;
    let bytes = 0;
    let attempt = null;
    try {
      attempt = await ctx.streamAttempt.start(begin.dedupeKey);
      if (attempt.terminal) {
        return {
          outcome: 'deduped', dedupeKey: begin.dedupeKey, providerStatus: 0, bytes: 0,
          detail: `attempt already terminal (${attempt.terminal.cause})`,
        };
      }
      const response = await ctx.fetchStream({
        url: begin.url,
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.expose()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ dedupeKey: begin.dedupeKey, job: `JOB-${begin.jobSeqNum}`, title: begin.title }),
        idempotencyKey: begin.dedupeKey,
        attemptToken: attempt.attemptToken,
      });
      providerStatus = response.status;
      if (!response.ok) {
        detail = `provider status ${response.status}`;
      } else {
        const reader = response.body.getReader();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
        }
        outcome = 'sent';
        detail = `provider acknowledged (${bytes} bytes)`;
      }
    } catch (error) {
      // Value-free diagnostic summary only; the token never enters detail.
      detail = String(error && error.message ? error.message : error).slice(0, 160);
    }
    if (attempt && attempt.attemptToken) {
      try {
        await ctx.streamAttempt.settle(attempt.attemptToken, outcome === 'sent' ? 'complete' : 'failed');
      } catch (error) {
        // Lease loss/abandonment: the trusted terminalizer owns the winner.
      }
    }
    await ctx.runMutation('recordDispatch', {
      orgId: begin.orgId, jobId: args.jobId, jobSeqNum: begin.jobSeqNum,
      dedupeKey: begin.dedupeKey, outcome, providerStatus, bytes, detail,
    });
    return { outcome, dedupeKey: begin.dedupeKey, providerStatus, bytes, detail };
  },
});

// ---- restore (export round-trip) ----

// Rebuilds runtime rows from an exportLedger payload after a receipted
// versioned reset-install: upsert by natural key (jobs by seq, customers by
// name, children by (jobSeq, seq), receipts by dedupeKey), remapping the
// _ids that necessarily changed. Dispatcher-only.
export const restoreLedger = defineJsMutation({
  args: { orgId: v.id('orgs'), payload: v.json() },
  reads: ['orgs', 'customers', 'jobs', 'jobSteps', 'activity', 'jobAttempts', 'dispatches', 'maintenanceRuns', 'followUpRuns'],
  writes: ['customers', 'jobs', 'jobSteps', 'activity', 'jobAttempts', 'dispatches', 'maintenanceRuns', 'followUpRuns'],
  result: results.value(v.object({
    jobsInserted: v.integer(),
    jobsPatched: v.integer(),
    rowsInserted: v.integer(),
    rowsSkipped: v.integer(),
  })),
  handler: async (ctx, args) => {
    await ctx.permissions.orgMembers.requireRole(args.orgId, 'dispatcher');
    const payload = args.payload;
    if (!payload || !payload.org || !payload.jobs) throw new Error('restore payload malformed');
    const now = ctx.runtime.now();
    let rowsInserted = 0;
    let rowsSkipped = 0;
    // customers by name
    const customers = await ctx.db.query('customers').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const customerIdByName = new Map();
    for (const c of customers) customerIdByName.set(c.name, c._id);
    for (const c of payload.customers) {
      if (customerIdByName.has(c.name)) { rowsSkipped += 1; continue; }
      const id = await ctx.db.insert('customers', {
        orgId: args.orgId, name: c.name, region: c.region, createdAt: c.createdAt,
      });
      customerIdByName.set(c.name, id);
      rowsInserted += 1;
    }
    // jobs by seq (patch existing back to exported state; insert missing)
    const jobs = await ctx.db.query('jobs').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const jobIdBySeq = new Map();
    for (const j of jobs) jobIdBySeq.set(j.seq, j._id);
    let jobsInserted = 0;
    let jobsPatched = 0;
    for (const j of payload.jobs) {
      const customerId = customerIdByName.get(j.customerName);
      if (!customerId) throw new Error(`restore: customer ${j.customerName} missing`);
      const fields = {
        title: j.title, customerId, status: j.status, ownerId: j.ownerId,
        ownerName: j.ownerName, fence: j.fence, attemptCount: j.attemptCount,
        leaseUntil: j.leaseUntil, scheduledFor: j.scheduledFor,
        followUpPlatformJobId: j.followUpPlatformJobId, createdAt: j.createdAt,
        updatedAt: j.updatedAt, settledAt: j.settledAt, terminalDetail: j.terminalDetail,
      };
      const existingId = jobIdBySeq.get(j.seq);
      if (existingId) {
        await ctx.db.patch('jobs', existingId, fields);
        jobsPatched += 1;
      } else {
        const id = await ctx.db.insert('jobs', {
          orgId: args.orgId, seq: j.seq, dedupeKey: j.dedupeKey, ...fields,
        });
        jobIdBySeq.set(j.seq, id);
        jobsInserted += 1;
      }
    }
    // steps by (jobSeq, seq)
    const steps = await ctx.db.query('jobSteps').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const jobSeqById = new Map();
    for (const entry of jobIdBySeq.entries()) jobSeqById.set(entry[1], entry[0]);
    const stepKeys = new Set();
    for (const s of steps) stepKeys.add(`${jobSeqById.get(s.jobId)}:${s.seq}`);
    for (const s of payload.steps) {
      if (stepKeys.has(`${s.jobSeq}:${s.seq}`)) {
        // patch state back onto the seeded step
        const jobId = jobIdBySeq.get(s.jobSeq);
        const existingStep = steps.filter((x) => x.jobId === jobId && x.seq === s.seq)[0];
        if (existingStep && (existingStep.state !== s.state || existingStep.doneByName !== s.doneByName)) {
          await ctx.db.patch('jobSteps', existingStep._id, { state: s.state, doneByName: s.doneByName, at: s.at });
        }
        rowsSkipped += 1;
        continue;
      }
      const jobId = jobIdBySeq.get(s.jobSeq);
      if (!jobId) throw new Error(`restore: job seq ${s.jobSeq} missing for step`);
      await ctx.db.insert('jobSteps', {
        jobId, orgId: args.orgId, seq: s.seq, title: s.title,
        state: s.state, doneByName: s.doneByName, at: s.at,
      });
      rowsInserted += 1;
    }
    // activity by (jobSeq, seq); jobSeq 0 = org-level (jobId '')
    const acts = await ctx.db.query('activity').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const actKeys = new Set();
    for (const a of acts) actKeys.add(`${a.jobId === '' ? 0 : jobSeqById.get(a.jobId)}:${a.seq}`);
    for (const a of payload.activity) {
      if (actKeys.has(`${a.jobSeq}:${a.seq}`)) { rowsSkipped += 1; continue; }
      const jobId = a.jobSeq === 0 ? '' : `${jobIdBySeq.get(a.jobSeq)}`;
      await ctx.db.insert('activity', {
        orgId: args.orgId, jobId, seq: a.seq, actorName: a.actorName,
        kind: a.kind, detail: a.detail, at: a.at,
      });
      rowsInserted += 1;
    }
    // attempts by (jobSeq, seq)
    const attempts = await ctx.db.query('jobAttempts').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const attemptKeys = new Set();
    for (const r of attempts) attemptKeys.add(`${jobSeqById.get(r.jobId)}:${r.seq}`);
    for (const r of payload.attempts) {
      if (attemptKeys.has(`${r.jobSeq}:${r.seq}`)) { rowsSkipped += 1; continue; }
      const jobId = jobIdBySeq.get(r.jobSeq);
      if (!jobId) throw new Error(`restore: job seq ${r.jobSeq} missing for attempt`);
      await ctx.db.insert('jobAttempts', {
        jobId, orgId: args.orgId, seq: r.seq, attemptSeq: r.attemptSeq,
        event: r.event, actorName: r.actorName, outcome: r.outcome, detail: r.detail, at: r.at,
      });
      rowsInserted += 1;
    }
    // dispatches by dedupeKey
    const dispatches = await ctx.db.query('dispatches').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const dispatchKeys = new Set();
    for (const d of dispatches) dispatchKeys.add(d.dedupeKey);
    for (const d of payload.dispatches) {
      if (dispatchKeys.has(d.dedupeKey)) { rowsSkipped += 1; continue; }
      const jobId = jobIdBySeq.get(d.jobSeq);
      if (!jobId) throw new Error(`restore: job seq ${d.jobSeq} missing for dispatch`);
      await ctx.db.insert('dispatches', {
        orgId: args.orgId, jobId, jobSeqNum: d.jobSeq, dedupeKey: d.dedupeKey,
        outcome: d.outcome, providerStatus: d.providerStatus, bytes: d.bytes,
        detail: d.detail, at: d.at,
      });
      rowsInserted += 1;
    }
    // maintenance runs by dedupeKey
    const maint = await ctx.db.query('maintenanceRuns').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const maintKeys = new Set();
    for (const m of maint) maintKeys.add(m.dedupeKey);
    for (const m of payload.maintenanceRuns) {
      if (maintKeys.has(m.dedupeKey)) { rowsSkipped += 1; continue; }
      await ctx.db.insert('maintenanceRuns', {
        orgId: args.orgId, dedupeKey: m.dedupeKey, nominalMs: m.nominalMs,
        timedOutCount: m.timedOutCount, outcome: m.outcome, detail: m.detail, at: m.at,
      });
      rowsInserted += 1;
    }
    // follow-up runs by dedupeKey
    const followUps = await ctx.db.query('followUpRuns').withIndex('by_org').eq('orgId', args.orgId).take(500).collect();
    const followKeys = new Set();
    for (const f of followUps) followKeys.add(f.dedupeKey);
    for (const f of payload.followUpRuns) {
      if (followKeys.has(f.dedupeKey)) { rowsSkipped += 1; continue; }
      const jobId = jobIdBySeq.get(f.jobSeq);
      await ctx.db.insert('followUpRuns', {
        orgId: args.orgId, jobId: jobId ? `${jobId}` : '', jobSeqNum: f.jobSeq,
        dedupeKey: f.dedupeKey, detail: f.detail, at: f.at,
      });
      rowsInserted += 1;
    }
    // restore is itself auditable
    const orgActs = await ctx.db.query('activity').withIndex('by_job_seq').eq('jobId', '').take(300).collect();
    await ctx.db.insert('activity', {
      orgId: args.orgId, jobId: '', seq: orgActs.length + 1, actorName: 'restore',
      kind: 'restored', detail: `ledger restored from export (${rowsInserted} rows inserted, ${jobsPatched} jobs patched)`, at: now,
    });
    return { jobsInserted, jobsPatched, rowsInserted, rowsSkipped };
  },
});
