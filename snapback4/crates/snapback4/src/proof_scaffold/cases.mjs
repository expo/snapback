// EDIT THIS FILE. check regenerates only files whose content hash still matches.
// Run: node scripts/proof-scaffold/acceptance.mjs. No guide/API lookups needed.
import assert from 'node:assert/strict';
export const accountPlan = ACCOUNT_PLAN;

// ctx = { host, sessions, rows, call(op, account, args), upload(account, kind, type), assertApproval }.
// sessions[role][0] = { kind:'user', role, email, password, principal, token, expiresAt }.
// Two accounts per role plus roleless users catch own/other-row holes. Never use a persona.
// args(account) above merges over {principal,role}; customize extra provisioning arguments.
export async function setup(ctx) {
  // TODO: create business rows through ctx.call; save IDs in ctx.rows, e.g.:
  // const r = await ctx.call('open', ctx.sessions.member[0], {title:'Proof'});
  // assert.equal(r.state, 'sent'); ctx.rows.request = r.result.id;
}
// Every operation/role and every declared guard has a required case. No observed result
// is used to choose the expected outcome. null means missing proof, never a passing test.
export async function approvalRow(ctx, account, args, result, attribution) {
  // TODO: reread the actual updated row via an authorized ctx.call(query, account, args).
  throw Error(`E_PROOF_SCENARIO: approval reread for ${attribution.table}`);
}
export const cases = [
OPERATION_CASES];

// Required for stored expiry/opening declarations in schema.json. Fresh setup per case
// is recommended; advance never freezes live time. Use margin across a deadline.
// { table:'requests', field:'dueAt', advance:'31d', assert: async ctx => {...} }
export const timeCases = [
TIME_CASES
];

// For approval mutations, reread through an authorized query and assert BOTH attribution
// and reason, e.g. ctx.assertApproval(row, account, args.reason, {by:'approvedBy',why:'approvalReason'}).
// Keep excluded-role and post-approval-edit controls among cases above.
export const frontend = {
  build: null, directory: 'dist', // auto: package build or build:web; override for a custom toolchain
  // TODO: drive a real UI write per role; use beginForm/formResult and fresh rendered text.
  assert: null, // async (page, ctx, account) => { ... }
};
