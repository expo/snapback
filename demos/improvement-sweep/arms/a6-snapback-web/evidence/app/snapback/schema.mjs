import {
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';

// LLP 0137 A6 operations and workflow ledger (contract
// a6-operations-ledger.v1). Sessions mode. The org, customers, and three
// baseline jobs are seeded literally (versioned seed); dispatcher/operator
// seats are claimed through seeded invite rows via the documented
// app-data-invitation self-insert pattern. Membership rows cannot be seeded
// and are not reset targets (known: finding 0137-a3-f1) — cleanup retires
// seats by self-removal.
export const orgMembers = defineTable({
  orgId: v.id('orgs'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'orgMembers',
  principal: 'userId',
  resource: 'orgId',
  role: 'role',
  roles: ['dispatcher', 'operator'],
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['none'], target: 'self', to: ['dispatcher', 'operator'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['dispatcher', 'operator'] },
  ],
}).visibility({
  kind: 'membership', declaration: 'orgMembers', resourceField: 'orgId',
  roles: ['dispatcher', 'operator'],
});

const schema = defineSchema({
  orgs: defineTable({
    name: v.string(),
  })
    .visibility({
      kind: 'membership', declaration: 'orgMembers', resourceField: '_id',
      roles: ['dispatcher', 'operator'],
    })
    .sync(),

  invites: defineTable({
    orgId: v.id('orgs'),
    code: v.string(),
    role: v.string(), // 'dispatcher' | 'operator'
    consumed: v.boolean(),
    createdAt: v.integer(),
  })
    .index('by_code', ['code'], { unique: true })
    .index('by_org', ['orgId'])
    .visibility({
      kind: 'membership', declaration: 'orgMembers', resourceField: 'orgId',
      roles: ['dispatcher', 'operator'],
    })
    .sync(),

  customers: defineTable({
    orgId: v.id('orgs'),
    name: v.string(),
    region: v.string(),
    createdAt: v.integer(),
  })
    .index('by_org', ['orgId'])
    .index('by_org_name', ['orgId', 'name'], { unique: true })
    .visibility({
      kind: 'membership', declaration: 'orgMembers', resourceField: 'orgId',
      roles: ['dispatcher', 'operator'],
    })
    .sync(),

  // Job state machine:
  // 'open' -> 'claimed' -> 'done'          (completeJob, terminal)
  // 'claimed' -> 'open'                    (releaseJob / lease timeout)
  // 'open'|'claimed' -> 'cancelled'        (dispatcher, terminal)
  // Terminal states are hard: late claims/patches leave only receipts.
  jobs: defineTable({
    orgId: v.id('orgs'),
    seq: v.integer(), // human-visible: rendered as JOB-<seq>
    title: v.string(),
    customerId: v.id('customers'),
    status: v.string(),
    ownerId: v.string(), // claiming operator principal; '' when unclaimed
    ownerName: v.string(),
    // Ownership fence: incremented on every successful claim. Work
    // mutations must present the fence they were issued; a stale fence
    // (prior owner) writes only a fenced receipt.
    fence: v.integer(),
    attemptCount: v.integer(),
    leaseUntil: v.integer(), // 0 when unclaimed
    scheduledFor: v.integer(), // dashboard range-filter dimension
    dedupeKey: v.string(),
    followUpPlatformJobId: v.string(), // one-off jobs_one_off_v1 id; '' = none
    createdAt: v.integer(),
    updatedAt: v.integer(),
    settledAt: v.integer(), // 0 until terminal
    terminalDetail: v.string(),
  })
    .index('by_org', ['orgId'])
    .index('by_org_seq', ['orgId', 'seq'], { unique: true })
    .index('by_org_dedupe', ['orgId', 'dedupeKey'], { unique: true })
    .visibility({
      kind: 'membership', declaration: 'orgMembers', resourceField: 'orgId',
      roles: ['dispatcher', 'operator'],
    })
    .sync(),

  jobSteps: defineTable({
    jobId: v.id('jobs'),
    orgId: v.id('orgs'),
    seq: v.integer(),
    title: v.string(),
    state: v.string(), // 'pending' | 'done'
    doneByName: v.string(),
    at: v.integer(),
  })
    .index('by_job', ['jobId'])
    .index('by_job_seq', ['jobId', 'seq'], { unique: true })
    .index('by_org', ['orgId'])
    .visibility({
      kind: 'membership', declaration: 'orgMembers', resourceField: 'orgId',
      roles: ['dispatcher', 'operator'],
    })
    .sync(),

  // Workflow audit trail: append-only activity rows for every transition.
  activity: defineTable({
    orgId: v.id('orgs'),
    jobId: v.string(), // '' for org-level entries (maintenance, restore)
    seq: v.integer(), // per-jobId sequence
    actorName: v.string(),
    kind: v.string(),
    detail: v.string(),
    at: v.integer(),
  })
    .index('by_job_seq', ['jobId', 'seq'], { unique: true })
    .index('by_org', ['orgId'])
    .visibility({
      kind: 'membership', declaration: 'orgMembers', resourceField: 'orgId',
      roles: ['dispatcher', 'operator'],
    })
    .sync(),

  // Append-only attempt receipts: claim, release, retry-claim, timeout,
  // cancellation, completion, rejected claims, and fenced late writes.
  jobAttempts: defineTable({
    jobId: v.id('jobs'),
    orgId: v.id('orgs'),
    seq: v.integer(),
    attemptSeq: v.integer(),
    event: v.string(),
    actorName: v.string(),
    outcome: v.string(),
    detail: v.string(),
    at: v.integer(),
  })
    .index('by_job_seq', ['jobId', 'seq'], { unique: true })
    .index('by_org', ['orgId'])
    .visibility({
      kind: 'membership', declaration: 'orgMembers', resourceField: 'orgId',
      roles: ['dispatcher', 'operator'],
    })
    .sync(),

  // External dispatch settlement ledger (idempotent by dedupeKey).
  dispatches: defineTable({
    orgId: v.id('orgs'),
    jobId: v.id('jobs'),
    jobSeqNum: v.integer(),
    dedupeKey: v.string(),
    outcome: v.string(), // 'sent' | 'failed'
    providerStatus: v.integer(),
    bytes: v.integer(),
    detail: v.string(), // value-free diagnostic summary; never secret bytes
    at: v.integer(),
  })
    .index('by_dedupe', ['dedupeKey'], { unique: true })
    .index('by_org', ['orgId'])
    .visibility({
      kind: 'membership', declaration: 'orgMembers', resourceField: 'orgId',
      roles: ['dispatcher', 'operator'],
    })
    .sync(),

  dispatchSettings: defineTable({
    orgId: v.id('orgs'),
    url: v.string(), // suite-owned local provider endpoint; '' = disabled
    updatedAt: v.integer(),
  })
    .index('by_org', ['orgId'], { unique: true })
    .visibility({
      kind: 'membership', declaration: 'orgMembers', resourceField: 'orgId',
      roles: ['dispatcher'],
    })
    .sync(),

  // Recurring maintenance receipts (cron everyMs; deterministic ticks in
  // the acceptance rig).
  maintenanceRuns: defineTable({
    orgId: v.id('orgs'),
    dedupeKey: v.string(),
    nominalMs: v.integer(),
    timedOutCount: v.integer(),
    outcome: v.string(),
    detail: v.string(),
    at: v.integer(),
  })
    .index('by_dedupe', ['dedupeKey'], { unique: true })
    .index('by_org', ['orgId'])
    .visibility({
      kind: 'membership', declaration: 'orgMembers', resourceField: 'orgId',
      roles: ['dispatcher', 'operator'],
    })
    .sync(),

  // One-off scheduled follow-up run receipts (jobs_one_off_v1 drain lands
  // here through the followUpSweep action).
  followUpRuns: defineTable({
    orgId: v.id('orgs'),
    jobId: v.string(),
    jobSeqNum: v.integer(),
    dedupeKey: v.string(),
    detail: v.string(),
    at: v.integer(),
  })
    .index('by_dedupe', ['dedupeKey'], { unique: true })
    .index('by_org', ['orgId'])
    .visibility({
      kind: 'membership', declaration: 'orgMembers', resourceField: 'orgId',
      roles: ['dispatcher', 'operator'],
    })
    .sync(),

  orgMembers,
}, {
  auth: { mode: 'sessions' },
  // jobs_one_off_v1 is experimental; codegen emits the capability
  // acknowledgment itself when job surfaces are declared (define.mjs:
  // "codegen emits the acknowledgment because LLP 0070 is Draft") —
  // naming it in requiredCapabilities is refused as unknown.
});

export default schema;
