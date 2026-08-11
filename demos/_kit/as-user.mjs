import assert from 'node:assert/strict';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../packages/snapback-contract/index.mjs';
import { SnapbackClient } from './client.mjs';

// @ref LLP 0231#d5--project-it-and-test-it-by-identity — asUser without bespoke token plumbing
export async function asUser(server, appId, email, {
  clientStoreId = `as-user:${email}`,
  custodyState = { custody: {} },
  clientOptions = {},
  fetchImpl = globalThis.fetch,
  register = null,
} = {}) {
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: custodyState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(server.baseUrl, {
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    // Multi-user acceptance scenarios intentionally hold several clients for
    // one origin at once. Persistence is not part of this identity helper's
    // contract; callers proving retained/outbox behavior inject their own
    // isolated store through clientOptions.
    rqsStore: null,
    ...clientOptions,
    authCoordinator: coordinator,
    clientStoreId,
  });

  let disposePromise = null;
  const dispose = () => {
    disposePromise ??= (async () => {
      const failures = [];
      try { await client.closeAuth(); } catch (error) { failures.push(error); }
      try { await coordinator.close(); } catch (error) { failures.push(error); }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, `asUser cleanup failed for ${email}`);
      }
    })();
    return disposePromise;
  };

  const identity = {
    client,
    coordinator,
    custodyState,
    clientStoreId,
    dispose,
  };
  let registered = false;

  try {
    if (register !== null) {
      await register(identity);
      registered = true;
    }
    const requested = await client.authRequestCode(email);
    const mailboxResponse = await fetchImpl(
      `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
      {
        headers: {
          'x-snapback-admin-token': server.adminToken,
          'x-snapback-impersonation-capability': server.impersonationCapability,
        },
      },
    );
    const mailbox = await mailboxResponse.json();
    assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
    const credential = await client.authExchange({
      challengeId: requested.challengeId,
      code: mailbox.code,
    });
    return Object.assign(identity, {
      credential,
      session: credential.session,
      userId: credential.session.userId,
    });
  } catch (error) {
    if (registered) throw error;
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `asUser setup and cleanup failed for ${email}`,
      );
    }
    throw error;
  }
}
