// KEEP coverage, status/refusal assertions and cleanup. EDIT cases.mjs.
import assert from 'node:assert/strict';
import { cases, timeCases } from './cases.mjs';
import { schema, startProof } from './host.mjs';
export function validate() {
  const missing = [];
  if(!cases.length) missing.push('no operation business cases');
  for (const op of schema.operations) {
    for (const role of schema.roles) if (!cases.some(c => c.op === op.name && c.role === role && !c.guard)) missing.push(`${op.name}/${role}`);
    for (const g of op.guards) if (!cases.some(c => c.op === op.name && c.guard === g.id && c.expected?.code === g.code)) missing.push(`${op.name}/${g.id}:${g.code}`);
  }
  for (const c of cases) {
    const op = schema.operations.find(p => p.name === c.op);
    if (!op || !schema.roles.includes(c.role) || typeof c.args !== 'function' || !c.expected ||
      !(typeof c.expected.code === 'string' || (op.signal ? c.expected.ok === true : op.kind === 'query' ? c.expected.complete === true : c.expected.state === (op.kind === 'action' ? 'done' : 'sent'))) ||
      (!c.expected.code && typeof c.assert !== 'function') || (c.guard && op.guards.find(g => g.id === c.guard)?.clock && typeof c.advance !== 'string')) missing.push(`${c.op}/${c.guard ?? c.role}: args/expected/assert/clock`);
  }
  for (const t of schema.lifetimes) for (const field of [t.expire,t.notBefore].filter(Boolean)) {
    if (!timeCases.some(c => c.table === t.table && c.field === field && typeof c.advance === 'string' && typeof c.assert === 'function')) missing.push(`${t.table}.${field}: clock case`);
  }
  for(const s of schema.schedules) if(!timeCases.some(c=>c.schedule===s.name && typeof c.advance==='string' && typeof c.assert==='function')) missing.push(`${s.name}: schedule clock case`);
  assert.equal(missing.length, 0, `E_PROOF_SCENARIO: fill/tighten cases.mjs (${missing.length} missing): ${missing.slice(0,12).join(', ')}`);
}
validate(); // Refuse incomplete proofs before creating users or deploying anything.
const ctx = await startProof();
try {
  for (const c of cases) {
    const account = ctx.sessions[c.role]?.[c.account ?? 0];
    assert.ok(account, `missing real account ${c.role}`);
    if(c.before) await c.before(ctx, account);
    const args = await c.args(ctx, account);
    if(c.advance) { const before=await ctx.host.now(); const after=await ctx.host.advance(c.advance); assert.ok(after.now>before); }
    const result = await ctx.call(c.op, account, args);
    const label = `${c.op}/${c.role}/${c.guard ?? 'role'}`;
    if(c.expected.code) assert.equal((result.why ?? result.denied)?.code, c.expected.code, label);
    else {
      assert.equal(result.why ?? result.denied, undefined, label);
      for (const [key,value] of Object.entries(c.expected)) assert.deepEqual(result[key],value,label);
    }
    if(c.assert) await c.assert(result, ctx, account, args);
  }
  for(const c of timeCases) { if(c.before) await c.before(ctx); const report=await ctx.host.advance(c.advance); await c.assert(ctx, report); }
  console.log(`acceptance: ${cases.length} operation/role/guard cases and ${timeCases.length} clock cases passed`);
} finally { await ctx.stop(); }
