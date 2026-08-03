// Deterministic seed fixture generator for the A6 operations ledger.
// Regenerate with: node snapback/gen-seed.mjs  (writes snapback/seed.json)
import { writeFileSync } from 'node:fs';

const ORG = 'org_meridian';
const BASE = 1783100000000; // fixed fixture epoch (all seeded rows are static)

const customers = [
  { _id: 'cust_meridian_foods', name: 'Meridian Foods', region: 'East Bay' },
  { _id: 'cust_delta_freight', name: 'Delta Freight', region: 'Port' },
  { _id: 'cust_north_yard', name: 'North Yard', region: 'North' },
  { _id: 'cust_harborlight', name: 'Harborlight Clinic', region: 'Waterfront' },
];

// Three baseline jobs: one settled, two open. The acceptance setup records
// their three historical allocation events through sequence_allocation_v1.
const jobs = [
  {
    _id: 'job_survey_north', seq: 1, title: 'Survey: North Yard', customerId: 'cust_north_yard',
    status: 'done', ownerId: '', ownerName: '', fence: 1, attemptCount: 1, leaseUntil: 0,
    scheduledFor: BASE - 7 * 86400000, dedupeKey: 'seed-job-1', followUpPlatformJobId: '',
    createdAt: BASE - 8 * 86400000, updatedAt: BASE - 7 * 86400000,
    settledAt: BASE - 7 * 86400000, terminalDetail: 'seeded baseline: survey completed',
  },
  {
    _id: 'job_repair_delta', seq: 2, title: 'Repair: Delta Freight', customerId: 'cust_delta_freight',
    status: 'open', ownerId: '', ownerName: '', fence: 0, attemptCount: 0, leaseUntil: 0,
    scheduledFor: BASE - 2 * 86400000, dedupeKey: 'seed-job-2', followUpPlatformJobId: '',
    createdAt: BASE - 3 * 86400000, updatedAt: BASE - 3 * 86400000,
    settledAt: 0, terminalDetail: '',
  },
  {
    _id: 'job_install_meridian', seq: 3, title: 'Install: Meridian Foods', customerId: 'cust_meridian_foods',
    status: 'open', ownerId: '', ownerName: '', fence: 0, attemptCount: 0, leaseUntil: 0,
    scheduledFor: BASE - 86400000, dedupeKey: 'seed-job-3', followUpPlatformJobId: '',
    createdAt: BASE - 2 * 86400000, updatedAt: BASE - 2 * 86400000,
    settledAt: 0, terminalDetail: '',
  },
];

const jobSteps = [
  { _id: 'step_1_1', jobId: 'job_survey_north', seq: 1, title: 'Walk the perimeter', state: 'done', doneByName: 'Seed crew', at: BASE - 7 * 86400000 },
  { _id: 'step_1_2', jobId: 'job_survey_north', seq: 2, title: 'File measurements', state: 'done', doneByName: 'Seed crew', at: BASE - 7 * 86400000 },
  { _id: 'step_2_1', jobId: 'job_repair_delta', seq: 1, title: 'Diagnose conveyor fault', state: 'pending', doneByName: '', at: 0 },
  { _id: 'step_2_2', jobId: 'job_repair_delta', seq: 2, title: 'Replace drive belt', state: 'pending', doneByName: '', at: 0 },
  { _id: 'step_2_3', jobId: 'job_repair_delta', seq: 3, title: 'Load test', state: 'pending', doneByName: '', at: 0 },
  { _id: 'step_3_1', jobId: 'job_install_meridian', seq: 1, title: 'Stage refrigeration units', state: 'pending', doneByName: '', at: 0 },
  { _id: 'step_3_2', jobId: 'job_install_meridian', seq: 2, title: 'Commission and sign off', state: 'pending', doneByName: '', at: 0 },
].map((s) => ({ ...s, orgId: ORG }));

const activity = [
  { _id: 'act_seed_1', jobId: 'job_survey_north', seq: 1, actorName: 'Seed', kind: 'created', detail: 'JOB-1 created (seed baseline)', at: BASE - 8 * 86400000 },
  { _id: 'act_seed_2', jobId: 'job_survey_north', seq: 2, actorName: 'Seed', kind: 'status', detail: 'JOB-1 settled done (seed baseline)', at: BASE - 7 * 86400000 },
  { _id: 'act_seed_3', jobId: 'job_repair_delta', seq: 1, actorName: 'Seed', kind: 'created', detail: 'JOB-2 created (seed baseline)', at: BASE - 3 * 86400000 },
  { _id: 'act_seed_4', jobId: 'job_install_meridian', seq: 1, actorName: 'Seed', kind: 'created', detail: 'JOB-3 created (seed baseline)', at: BASE - 2 * 86400000 },
].map((a) => ({ ...a, orgId: ORG }));

const seed = {
  seedVersion: 'a6-ops.2026-08-01.1',
  tables: {
    orgs: [{ _id: ORG, name: 'Meridian Operations' }],
    invites: [
      { _id: 'inv_dispatch', orgId: ORG, code: 'INV-DISPATCH-5501', role: 'dispatcher', consumed: false, createdAt: BASE },
      { _id: 'inv_op_1', orgId: ORG, code: 'INV-OP-6601', role: 'operator', consumed: false, createdAt: BASE + 1000 },
      { _id: 'inv_op_2', orgId: ORG, code: 'INV-OP-6602', role: 'operator', consumed: false, createdAt: BASE + 2000 },
      { _id: 'inv_op_spare', orgId: ORG, code: 'INV-OP-9909', role: 'operator', consumed: false, createdAt: BASE + 3000 },
    ],
    customers: customers.map((c, i) => ({ ...c, orgId: ORG, createdAt: BASE + i * 1000 })),
    jobs: jobs.map((j) => ({ ...j, orgId: ORG })),
    jobSteps,
    activity,
    dispatchSettings: [{ _id: 'dispatch_cfg', orgId: ORG, url: '', updatedAt: 0 }],
    jobAttempts: [],
    dispatches: [],
    maintenanceRuns: [],
    followUpRuns: [],
  },
};

writeFileSync(new URL('./seed.json', import.meta.url), `${JSON.stringify(seed, null, 2)}\n`);
console.log(`seed.json written: ${seed.seedVersion}`);
