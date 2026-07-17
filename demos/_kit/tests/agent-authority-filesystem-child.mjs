// Child-process fixture for the Node filesystem AgentAuthorityFence adapter.

import { setTimeout as delay } from 'node:timers/promises';

import { AgentAuthorityFence } from '../agent-authority.mjs';
import { createFilesystemAgentAuthorityCustodyStorage } from '../agent-authority-filesystem.mjs';
import { deriveServiceAuthorityInstanceId } from '../../../packages/snapback-contract/auth-coordinator.mjs';

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
const storage = createFilesystemAgentAuthorityCustodyStorage({ directory, lockTimeoutMs });

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

const emit = (value) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

try {
  if (action === 'init-a') {
    const fence = new AgentAuthorityFence(credential(), { storage, custodyId });
    const capture = await fence.synchronize();
    emit({ ok: true, capture, record: await storage.snapshot(custodyId) });
  } else if (action === 'replace-b') {
    const fence = new AgentAuthorityFence(credential(), { storage, custodyId });
    await fence.synchronize();
    const capture = await fence.replaceCredential(credential({ grantId: GRANT_B, tokenId: TOKEN_B }));
    emit({ ok: true, capture, record: await storage.snapshot(custodyId) });
  } else if (action === 'adopt-b') {
    const next = credential({ grantId: GRANT_B, tokenId: TOKEN_B });
    const fence = new AgentAuthorityFence(next, { storage, custodyId });
    const capture = await fence.synchronize();
    emit({ ok: true, capture, record: await storage.snapshot(custodyId) });
  } else if (action === 'wedge-b') {
    const fence = new AgentAuthorityFence(credential(), { storage, custodyId });
    await fence.synchronize();
    fence.registerParticipant({
      quiesce() {},
      blank() {},
      clearMemory() {},
      async commitDurable() { throw new Error('injected child participant failure'); },
      async resume() {},
    });
    let failure = null;
    try {
      await fence.replaceCredential(credential({ grantId: GRANT_B, tokenId: TOKEN_B }));
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
    const fence = new AgentAuthorityFence(credential(), { storage, custodyId });
    await fence.synchronize();
    const termination = fence.terminate(
      fence.capture(),
      { authorityDisposition: 'durableDelete' },
    );
    await termination.settlement;
    emit({ ok: true, record: await storage.snapshot(custodyId) });
  } else if (action === 'reject-a') {
    const fence = new AgentAuthorityFence(credential({ tokenId: TOKEN_B }), { storage, custodyId });
    let failure = null;
    try {
      await fence.synchronize();
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
  });
}
