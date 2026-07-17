// Child-process fixture for the Node filesystem AgentAuthorityFence adapter.

import { setTimeout as delay } from 'node:timers/promises';

import { AgentAuthorityFence } from '../agent-authority.mjs';
import { createFilesystemAgentAuthorityCustodyStorage } from '../agent-authority-filesystem.mjs';
import {
  canonicalAgentAuthorityKey,
  deriveServiceAuthorityInstanceId,
} from '../../../packages/snapback-contract/auth-coordinator.mjs';

const ACTOR = '018f0d90-7b26-7a22-8c33-445566778899';
const CREDENTIAL = '018f0d90-7b27-7a22-8c33-445566778899';
const GRANT_A = '018f0d90-7b28-7a22-8c33-445566778899';
const GRANT_B = '018f0d90-7b2b-7a22-8c33-445566778899';
const TOKEN_A = '018f0d90-7b29-7a22-8c33-445566778899';
const TOKEN_B = '018f0d90-7b2a-7a22-8c33-445566778899';
const BEARER_SENTINEL = 'sbagt_filesystem_bearer_must_never_persist';

const [action, directory, custodyId, timeoutText = '5000', holdText = '60000'] = process.argv.slice(2);
const lockTimeoutMs = Number(timeoutText);
const holdMs = Number(holdText);
const emit = (value) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};
const emitAndFlush = (value) => new Promise((resolve, reject) => {
  process.stdout.write(`${JSON.stringify(value)}\n`, (error) => (
    error ? reject(error) : resolve()
  ));
});
const crashCheckpoint = action.startsWith('crash-') && action.endsWith('-a')
  && !action.startsWith('crash-retire-')
  ? action.slice('crash-'.length, -'-a'.length)
  : null;
const retireHelperCrashHook = action.startsWith('crash-retire-helper-') && action.endsWith('-a')
  ? action.slice('crash-retire-helper-'.length, -'-a'.length)
  : null;
const retireCrashHook = action.startsWith('crash-retire-')
  && !action.startsWith('crash-retire-helper-')
  && action.endsWith('-a')
  ? action.slice('crash-retire-'.length, -'-a'.length)
  : null;
const retireCrashHooks = retireCrashHook === null && retireHelperCrashHook === null
  ? null
  : {
      [retireCrashHook ?? retireHelperCrashHook]: async (context) => {
        const name = retireCrashHook ?? retireHelperCrashHook;
        await emitAndFlush({ event: 'witness-retire-checkpoint', name, context });
        process.kill(
          retireHelperCrashHook === null ? process.pid : context.helperPid,
          'SIGKILL',
        );
      },
    };
const storage = createFilesystemAgentAuthorityCustodyStorage({
  directory,
  lockTimeoutMs,
  testHooks: action === 'crash-helper-after-temp-b'
    ? {
        async afterTemporaryCreate(context) {
          emit({ event: 'crashing-helper-after-temp', context });
          process.kill(context.helperPid, 'SIGKILL');
        },
      }
    : action === 'pause-after-temp-b'
    ? {
        async afterTemporaryCreate(context) {
          emit({ event: 'after-temp', context });
          await delay(holdMs);
        },
      }
    : action === 'pause-before-rename-b'
    ? {
        async beforeRecordRename(context) {
          emit({ event: 'before-rename', context });
          await delay(holdMs);
        },
      }
    : action === 'pause-after-rename-b'
      ? {
          async afterRecordRename(context) {
            emit({ event: 'after-rename', context });
            await delay(holdMs);
          },
        }
      : retireCrashHooks,
  terminalLedgerCheckpoint: crashCheckpoint === null
    ? null
    : async (name, context) => {
        if (name !== crashCheckpoint) return;
        await emitAndFlush({ event: 'terminal-ledger-checkpoint', name, context });
        process.kill(process.pid, 'SIGKILL');
      },
});

const credential = ({ grantId = GRANT_A, tokenId = TOKEN_A } = {}) => ({
  actorUserId: ACTOR,
  credentialId: CREDENTIAL,
  credentialGeneration: 3,
  grantId,
  tokenId,
  bearerToken: `${BEARER_SENTINEL}:${grantId}:${tokenId}`,
});

const descriptorFor = (value) => ({
  descriptorVersion: 1,
  authorityInstanceId: deriveServiceAuthorityInstanceId(value),
  sessionGeneration: 0,
});

const durableAuthority = (value) => ({
  kind: 'servicePrincipal',
  authMode: 'sessions',
  actorUserId: value.actorUserId,
  credentialId: value.credentialId,
  credentialGeneration: value.credentialGeneration,
  grantId: value.grantId,
});

const transitionId = (value) => `agent-transition-v1:${JSON.stringify({
  custodyId: value.custodyId,
  expectedRevision: value.expectedRevision,
  expectedEpoch: value.expectedEpoch,
  expectedAuthorityKey: value.expectedAuthorityKey,
  previousStatus: value.previousStatus,
  nextEpoch: value.nextEpoch,
  nextAuthorityKey: value.nextAuthorityKey,
  nextStatus: value.nextStatus,
  reason: value.reason,
  disposition: value.disposition,
})}`;

const seedLegacyCustody = async ({ withWitness = true } = {}) => {
  const value = credential();
  const authority = durableAuthority(value);
  const authorityKey = canonicalAgentAuthorityKey(authority);
  const primary = {
    formatVersion: 1,
    custodyId,
    authorityEpoch: 0,
    revision: 1,
    phase: 'settled',
    status: 'active',
    authorityKey,
    authority,
    transition: null,
  };
  await storage.withOwnership(custodyId, (owner) => owner.replace(null, primary));
  const witnessId = `snapback.agent-terminal-witness.v1:${authorityKey}:${custodyId}`;
  const delayedAuthority = durableAuthority(credential({ grantId: GRANT_B, tokenId: TOKEN_B }));
  const delayedWitnessId = `snapback.agent-terminal-witness.v1:${canonicalAgentAuthorityKey(delayedAuthority)}:${custodyId}`;
  if (!withWitness) return { primary, witnessId, delayedWitnessId };
  const transition = {
    formatVersion: 1,
    transitionId: null,
    expectedRevision: null,
    expectedEpoch: null,
    expectedAuthorityKey: null,
    previousStatus: null,
    previousAuthority: null,
    nextEpoch: 0,
    nextAuthorityKey: authorityKey,
    nextStatus: 'deleted',
    nextAuthority: authority,
    reason: 'filesystem_legacy_migration_fixture',
    disposition: 'delete',
  };
  transition.transitionId = transitionId({ custodyId: witnessId, ...transition });
  const clearing = {
    formatVersion: 1,
    custodyId: witnessId,
    authorityEpoch: 0,
    revision: 1,
    phase: 'clearing',
    status: 'deleted',
    authorityKey,
    authority,
    transition,
  };
  await storage.withOwnership(witnessId, (owner) => owner.replace(null, clearing));
  await storage.withOwnership(witnessId, (owner) => owner.replace(1, {
    ...clearing,
    revision: 2,
    phase: 'settled',
    transition: null,
  }));
  return { primary, witnessId, delayedWitnessId };
};

try {
  if (action === 'seed-legacy-a') {
    const seeded = await seedLegacyCustody();
    emit({ ok: true, seeded });
  } else if (action === 'seed-legacy-primary-a') {
    const seeded = await seedLegacyCustody({ withWitness: false });
    emit({ ok: true, seeded });
  } else if (
    action === 'init-a'
    || crashCheckpoint !== null
    || retireCrashHook !== null
    || retireHelperCrashHook !== null
  ) {
    const value = credential();
    const fence = new AgentAuthorityFence(value, { storage, custodyId });
    const capture = await fence.synchronizeValidated(descriptorFor(value));
    emit({ ok: true, capture, record: await storage.snapshot(custodyId) });
  } else if (
    action === 'replace-b'
    || action === 'crash-helper-after-temp-b'
    || action === 'pause-after-temp-b'
    || action === 'pause-before-rename-b'
    || action === 'pause-after-rename-b'
  ) {
    const value = credential();
    const fence = new AgentAuthorityFence(value, { storage, custodyId });
    await fence.synchronizeValidated(descriptorFor(value));
    const next = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
    const capture = await fence.replaceCredentialValidated(
      fence.capture(),
      next,
      descriptorFor(next),
    );
    emit({ ok: true, capture, record: await storage.snapshot(custodyId) });
  } else if (action === 'adopt-b') {
    const next = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
    const fence = new AgentAuthorityFence(next, { storage, custodyId });
    const capture = await fence.synchronizeValidated(descriptorFor(next));
    emit({ ok: true, capture, record: await storage.snapshot(custodyId) });
  } else if (action === 'wedge-b') {
    const value = credential();
    const fence = new AgentAuthorityFence(value, { storage, custodyId });
    await fence.synchronizeValidated(descriptorFor(value));
    fence.registerParticipant({
      quiesce() {},
      blank() {},
      clearMemory() {},
      async commitDurable() { throw new Error('injected child participant failure'); },
      async resume() {},
    });
    let failure = null;
    try {
      const next = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
      await fence.replaceCredentialValidated(fence.capture(), next, descriptorFor(next));
    } catch (error) {
      failure = { code: error?.code ?? null, message: error?.message ?? String(error) };
    }
    emit({ ok: true, failure, record: await storage.snapshot(custodyId) });
  } else if (action === 'recover-b') {
    const next = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
    const fence = new AgentAuthorityFence(next, { storage, custodyId });
    let durableCommits = 0;
    fence.registerParticipant({
      quiesce() {},
      blank() {},
      clearMemory() {},
      async commitDurable() { durableCommits += 1; },
      async resume() {},
    });
    const capture = await fence.synchronizeValidated(descriptorFor(next));
    emit({
      ok: true,
      capture,
      durableCommits,
      record: await storage.snapshot(custodyId),
    });
  } else if (action === 'delete-a') {
    const value = credential();
    const fence = new AgentAuthorityFence(value, { storage, custodyId });
    await fence.synchronizeValidated(descriptorFor(value));
    const termination = fence.terminate(
      fence.capture(),
      { authorityDisposition: 'durableDelete' },
    );
    await termination.settlement;
    emit({ ok: true, record: await storage.snapshot(custodyId) });
  } else if (action === 'reject-a') {
    const value = credential({ tokenId: TOKEN_B });
    const fence = new AgentAuthorityFence(value, { storage, custodyId });
    let failure = null;
    try {
      await fence.synchronizeValidated(descriptorFor(value));
    } catch (error) {
      failure = { code: error?.code ?? null, message: error?.message ?? String(error) };
    }
    emit({ ok: true, failure, record: await storage.snapshot(custodyId) });
  } else if (action === 'hold') {
    await storage.withOwnership(custodyId, async () => {
      emit({ event: 'acquired' });
      await delay(holdMs);
    });
    emit({ ok: true });
  } else if (action === 'hold-universal-gate') {
    await storage.withOwnership(`snapback.agent-custody-gate.v1:${custodyId}`, async () => {
      emit({ event: 'universal-gate-acquired' });
      await delay(holdMs);
    });
    emit({ ok: true });
  } else if (action === 'probe') {
    const record = await storage.withOwnership(custodyId, (owner) => owner.read());
    emit({ ok: true, record });
  } else {
    throw new Error(`unknown child action ${action}`);
  }
} catch (error) {
  emit({
    ok: false,
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    details: error?.diagnostic?.details ?? null,
  });
}
