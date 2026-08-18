// Hosted mirror of crates/snapback/tests/action_denial_witness_v0.rs (0137 a4-f5,
// issues/20260801-hosted-action-denial-witness-parity.md): a nested
// mutation's trusted SNAPBACK_AUTH_PERMISSION_DENIED must survive the action
// boundary on the workerd/DO coordinator exactly as on the local runtime —
// recorded at the host-op dispatch (HostContext.handle, the JS
// dispatch_host_call), folded by the LLP 0053 envelope decoder, and restored
// only under the claim-match rule (restoreDenialWitness, the JS
// restore_denial_witness).
//
// The hosted proof apps carry no permissions.requireRole host op yet, so the
// trusted denial cannot be produced end-to-end through Miniflare; this suite
// drives the REAL seam chain instead — the checked-in ctx-bootstrap settle
// wrapper in a VM, wired over the workerd transport shape to a real
// action-mode HostContext whose runMutation hook returns the trusted denial
// bytes (exactly what runMutationForAction returns once a hosted producer
// exists). PASSTHROUGH_CODES stays unchanged: the fold in cases 2 and 3 is
// asserted, not bypassed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { HostContext } from '../src/host-ops.js';
import {
  parseHandlerEnvelope,
  restoreDenialWitness,
} from '../../packages/snapback-harness/envelope.mjs';

const bootstrap = await readFile(
  new URL('../../packages/snapback-harness/ctx-bootstrap.js', import.meta.url),
  'utf8',
);

// The uniform trusted denial a hosted requireRole/RLS producer surfaces
// through runMutationForAction — byte-identical to role_denial()
// (crates/snapback/src/membership_rules.rs): code, message, details.
const TRUSTED_DENIAL = Object.freeze({
  ok: false,
  code: 'SNAPBACK_AUTH_PERMISSION_DENIED',
  message: 'role requirement not satisfied',
  details: Object.freeze({ kind: 'role' }),
});

const EPOCH = 'witness-epoch';

const HANDLERS = `
globalThis.__snapbackHandlers = {
  async gatedAction(ctx) {
    return await ctx.runMutation('gatedMutation', {});
  },
  async forgedDenialAction(ctx) {
    var error = new Error('forged denial that no host op produced');
    error.__snapbackCode = 'SNAPBACK_AUTH_PERMISSION_DENIED';
    throw error;
  },
  async caughtDenialOtherFailureAction(ctx) {
    try { await ctx.runMutation('gatedMutation', {}); } catch (_ignored) {}
    throw new Error('unrelated failure after catching the denial');
  },
  async caughtDenialRecoveryAction(ctx) {
    try { await ctx.runMutation('gatedMutation', {}); } catch (_ignored) {}
    return { recovered: true };
  }
};
`;

// One action invocation over the real seams: a fresh action-mode HostContext
// (runMutation hook = the trusted denial, as runMutationForAction returns it),
// the checked-in settle wrapper, and the workerd transport's coded-throw
// shape (handler-server.mjs hostCall).
async function invokeAction(name) {
  const host = new HostContext({
    sql: null,
    mode: 'action',
    nowMs: Date.now(),
    epoch: EPOCH,
    newId: () => 'id_witness',
    tables: new Set(),
    runMutation: (mutationName, _args) => {
      assert.equal(mutationName, 'gatedMutation');
      return { ...TRUSTED_DENIAL, details: { ...TRUSTED_DENIAL.details } };
    },
  });
  const hostCall = async (rawOp, argsJson) => {
    const sep = rawOp.indexOf('|');
    assert.equal(rawOp.slice(0, sep), EPOCH, 'host call must carry the invocation epoch');
    const result = await host.handle(rawOp.slice(sep + 1), JSON.parse(argsJson));
    if (!result.ok) {
      // The workerd transport's error shape (handler-server.mjs): the coded
      // message plus __snapbackCode; details never cross into the isolate.
      const error = new Error(`${result.code}: ${result.message}`);
      Object.defineProperty(error, '__snapbackCode', { value: result.code });
      throw error;
    }
    return result.value === undefined ? null : result.value;
  };
  const context = vm.createContext({});
  vm.runInContext('globalThis.__hostCall = function() { return "null"; };', context);
  vm.runInContext(bootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(HANDLERS, context, { filename: 'app.js' });
  const envelope = await context.__snapbackSettle(
    name,
    '{}',
    '{}',
    'action',
    JSON.stringify({ runId: 'run_witness', trigger: 'manual', jobName: null }),
    null,
    EPOCH,
    hostCall,
  );
  const decoded = parseHandlerEnvelope(envelope);
  // The coordinator's exact seam order (invokeHandler): decode, then restore
  // from the taken witness keyed on the raw claim. (admitDeclaredRefusal is
  // vacuous here — no SNAPBACK_APP_REFUSAL claims in this corpus.)
  const witnessRecorded = host.denialWitness !== null;
  const restored = restoreDenialWitness(host.takeDenialWitness(), decoded.claimedCode ?? null, decoded);
  return { decoded, restored, witnessRecorded, host };
}

// Case 1 (nested_mutation_denial_surfaces_typed_through_the_action_boundary):
// the trusted denial one hop into the action lane keeps the PLATFORM code and
// the host-recorded uniform bytes — while the pre-restore fold proves the
// envelope decoder alone still refuses to type the claim.
{
  const { decoded, restored, witnessRecorded } = await invokeAction('gatedAction');
  assert.equal(witnessRecorded, true, 'the host-op dispatch must record the trusted denial');
  assert.equal(decoded.code, 'SNAPBACK_HANDLER_FAILED', 'the envelope fold itself must stay untyped');
  assert.equal(decoded.claimedCode, 'SNAPBACK_AUTH_PERMISSION_DENIED');
  assert.equal(restored.ok, false);
  assert.equal(
    restored.code,
    'SNAPBACK_AUTH_PERMISSION_DENIED',
    `the platform auth code must survive the action boundary, got ${JSON.stringify(restored)}`,
  );
  assert.equal(restored.message, TRUSTED_DENIAL.message, 'denial message must be byte-uniform with the host-recorded denial');
  assert.deepEqual(restored.details, TRUSTED_DENIAL.details, 'denial details must be byte-uniform with the host-recorded denial');
  assert.ok(restored.failureCarrier, 'the private failure carrier survives the restoration');
}

// Case 2 (forged_denial_code_without_a_witness_stays_untyped): a
// handler-forged denial code with no host-produced witness folds to
// SNAPBACK_HANDLER_FAILED (LLP 0053) and is NOT restored.
{
  const { restored, witnessRecorded } = await invokeAction('forgedDenialAction');
  assert.equal(witnessRecorded, false, 'no host op produced a denial');
  assert.equal(
    restored.code,
    'SNAPBACK_HANDLER_FAILED',
    `a handler-forged denial code must stay untyped (LLP 0053), got ${JSON.stringify(restored)}`,
  );
}

// Case 3 (caught_denial_with_unrelated_failure_is_not_restored): the handler
// caught the denial and failed on its own terms — the witness exists but the
// claim differs, so the handler's own failure surfaces.
{
  const { restored, witnessRecorded } = await invokeAction('caughtDenialOtherFailureAction');
  assert.equal(witnessRecorded, true, 'the caught denial was still host-recorded');
  assert.equal(
    restored.code,
    'SNAPBACK_HANDLER_FAILED',
    `a caught denial followed by an unrelated failure keeps the handler's own failure, got ${JSON.stringify(restored)}`,
  );
  assert.equal(restored.failureCarrier.message, 'unrelated failure after catching the denial');
}

// Case 4 (caught_denial_with_recovery_still_succeeds): the seam is
// non-terminalizing — an action may catch a nested denial and take an
// alternative path (the denied mutation committed nothing).
{
  const { restored, witnessRecorded } = await invokeAction('caughtDenialRecoveryAction');
  assert.equal(witnessRecorded, true, 'the caught denial was still host-recorded');
  assert.equal(restored.ok, true, `recovery after a caught denial must succeed: ${JSON.stringify(restored)}`);
  assert.deepEqual(restored.value, { recovered: true });
}

console.log('cloudflare action-denial-witness tests: typed surface-through, forged stays untyped, caught-then-fail keeps own failure, caught-then-recover succeeds');
