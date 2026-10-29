// EDIT this one business scenario; host.mjs and acceptance.mjs own lifecycle.
// Wire: npm pkg set 'scripts.acceptance=node scripts/proof-draft/acceptance.mjs'
import assert from 'node:assert/strict';
export const accountPlan = ACCOUNT_PLAN;
// ctx: {host, sessions[role][index], rows, client(account), call(op,account,args),
// upload(account,'image'|'file',mime?,bytes?) => {id}, assertApproval, stop}.
export async function setup(ctx) { /* Optional business rows through ctx.call. */ }
// Add your own refusal/privacy/deadline/approval cases. This draft imposes no
// operation×role matrix. Query expected: {complete:true}; write: {state:'sent'};
// action: {state:'done'}; refusal: {code:'EXACT_CODE'}. Success needs a real assertion.
export const cases = [{op: OP_NAME, role: null, args: null, expected: null, assert: null}];
// args: async (ctx,account)=>({...}); assert: async (result,ctx,account,args)=>{...}.
// Full required matrix is optional: check --proof-scaffold.
