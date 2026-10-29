// KEEP runner and cleanup. EDIT cases.mjs; npm run verify runs your wired scripts.
import assert from 'node:assert/strict';
import {runProofSuite} from 'snapback4/proof-runner';
import {cases} from './cases.mjs';
import {schema,startProof} from './host.mjs';
await runProofSuite(async()=>{
  assert.ok(cases.length && cases.some(c=>c.expected && !c.expected.code),'E_PROOF_SCENARIO: add a successful business case');
  for(const c of cases) {
    const op=schema.operations.find(p=>p.name===c.op);
    assert.ok(op && schema.roles.includes(c.role) && typeof c.args==='function' && c.expected &&
      (typeof c.expected.code==='string' || (op.kind==='query'?c.expected.complete===true:c.expected.state===(op.kind==='action'?'done':'sent'))) &&
      (c.expected.code || typeof c.assert==='function'),'E_PROOF_SCENARIO: fill op/role/args/expected/assert in cases.mjs');
  }
  const ctx=await startProof();
  try {
    for(const c of cases) {
      const account=ctx.sessions[c.role]?.[c.account??0];assert.ok(account,'missing real account');
      if(c.before) await c.before(ctx,account);
      const args=await c.args(ctx,account);
      if(c.advance) await ctx.host.advance(c.advance);
      const result=await ctx.call(c.op,account,args);
      if(c.expected.code) assert.equal((result.why??result.denied)?.code,c.expected.code,c.op);
      else {assert.equal(result.why??result.denied,undefined,c.op);for(const[k,v]of Object.entries(c.expected))assert.deepEqual(result[k],v,c.op);}
      if(c.assert) await c.assert(result,ctx,account,args);
    }
    console.log(`acceptance: ${cases.length} authored business cases passed; coverage: application-owned`);
  } finally {await ctx.stop();}
});
