#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { aggregateChoreography } from '../../../benchmarks/tools/social-messenger/choreography/choreography.mjs';
import {
  createGroup,
  createPost,
  editProfile,
  listChats,
  listFeed,
  listMessages,
  listProfiles,
  listProviderClaims,
  listSession,
  login,
  logout,
  markReceipt,
  observeTyping,
  openDm,
  removeMember,
  sendMessage,
  setFollow,
  setLike,
  setTyping,
} from '../src/data/generated/coterie.bindings.ts';
import { bootCoterieProvider } from '../src/data/provider-factory.ts';
import {
  createCoterieSnapbackProvider,
  resolveCoterieSnapbackUrl,
} from '../src/data/snapback-provider.ts';
import { installM3Fixtures } from '../snapback/seed-m3.mjs';

const CONTRACT_PATH = new URL(
  '../../../benchmarks/tools/social-messenger/CONTRACT.md',
  import.meta.url,
);
const PERSONAS_PATH = new URL(
  '../../../benchmarks/fixtures/social-messenger/personas.json',
  import.meta.url,
);

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function redactedErrorText(error, sensitiveValues) {
  let text = errorText(error);
  for (const value of sensitiveValues) {
    text = text.replaceAll(value, '[REDACTED_SESSION_TOKEN]');
  }
  return text;
}

// @ref LLP 0197#the-standard — acceptance evidence redacts credentials while
// preserving stable boolean receipts for the behavior under test.
function serializeRedactedArtifact(artifact, sensitiveValues) {
  return JSON.stringify(
    artifact,
    (_key, value) => {
      if (typeof value !== 'string') return value;
      let redacted = value;
      for (const sensitiveValue of sensitiveValues) {
        redacted = redacted.replaceAll(sensitiveValue, '[REDACTED_SESSION_TOKEN]');
      }
      return redacted;
    },
    2,
  );
}

function rememberSensitiveValue(sensitiveValues, value) {
  if (typeof value === 'string' && value.length > 0) sensitiveValues.add(value);
}

function safeProviderName(value) {
  const normalized = String(value).toLocaleLowerCase('en-US').replaceAll(/[^a-z0-9_-]+/gu, '-');
  return normalized || 'unknown';
}

const STEP_REQUIRED_CLAIMS = Object.freeze({
  'signed-out-precondition': ['listSession', 'logout'],
  login: ['listSession', 'login'],
  'profile-edit': ['editProfile'],
  'profile-edit-observable': ['listProfiles', 'editProfile'],
  'm2-boot-global-following-split': ['listFeed'],
  'm2-create-text-global': ['listFeed', 'createPost'],
  'm2-follow-following-projection': ['listFeed', 'setFollow'],
  'm2-like-toggle-observable': ['listFeed', 'setLike'],
  'm3-open-dm-deduplicated': ['listChats', 'openDm'],
  'm3-send-text': ['listChats', 'openDm', 'listMessages', 'sendMessage'],
  'm3-quoted-reply-preserves-source': [
    'listChats',
    'openDm',
    'listMessages',
    'login',
    'sendMessage',
  ],
  'm3-receipts-monotonic': [
    'listChats',
    'openDm',
    'listMessages',
    'login',
    'markReceipt',
  ],
  'm3-typing-lease-expires': [
    'listChats',
    'openDm',
    'observeTyping',
    'login',
    'setTyping',
  ],
  'm3-group-create-and-admin-remove': ['listChats', 'login', 'createGroup', 'removeMember'],
  logout: ['listSession', 'logout'],
});

async function loadAuthorities() {
  const [contractSource, personasSource] = await Promise.all([
    readFile(CONTRACT_PATH, 'utf8'),
    readFile(PERSONAS_PATH, 'utf8'),
  ]);
  const contractIds = new Set(
    [...contractSource.matchAll(/`(sm-[a-z0-9-]+)`/gu)].map((match) => match[1]),
  );
  const personas = JSON.parse(personasSource);
  const starterById = new Map(personas.starter.map((persona) => [persona.id, persona]));
  const alice = starterById.get('alice');
  const bob = starterById.get('bob');
  const carol = starterById.get('carol');
  if (!alice || !bob || !carol) {
    throw new Error('Alice, Bob, or Carol is missing from the shared social-messenger personas');
  }
  return { contractIds, alice, bob, carol };
}

function requireQueryHandle(value, name) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.read !== 'function' ||
    typeof value.subscribe !== 'function'
  ) {
    throw new Error(`${name} did not return an Exact headless query handle`);
  }
  return value;
}

function requireMutationSuccess(result, name) {
  if (!result || result.ok !== true) {
    const reason = result?.error?.message ?? 'unknown provider rejection';
    throw new Error(`${name} failed: ${reason}`);
  }
  return result.value;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object') {
    throw new Error(`${name} did not return an object result`);
  }
  return value;
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} did not return a non-empty string`);
  }
  return value;
}

function requireLatestRows(deliveries, name) {
  const rows = deliveries.at(-1);
  if (!Array.isArray(rows)) {
    throw new Error(`${name} has no observable delivery`);
  }
  return rows;
}

function createDeliveryLog(name) {
  const deliveries = [];
  const waiters = new Set();
  return {
    deliveries,
    push(rows) {
      deliveries.push(rows);
      for (const waiter of [...waiters]) {
        if (!waiter.predicate(rows)) continue;
        clearTimeout(waiter.timeout);
        waiters.delete(waiter);
        waiter.resolve(rows);
      }
    },
    waitFor(predicate = () => true, timeoutMs = 20_000) {
      const existing = deliveries.findLast(predicate);
      if (existing !== undefined) return Promise.resolve(existing);
      return this.waitForFuture(predicate, timeoutMs);
    },
    waitForFuture(predicate = () => true, timeoutMs = 20_000) {
      return new Promise((resolveDelivery, rejectDelivery) => {
        const waiter = {
          predicate,
          resolve: resolveDelivery,
          timeout: setTimeout(() => {
            waiters.delete(waiter);
            rejectDelivery(new Error(`timed out waiting for ${name} delivery`));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}

async function runAcceptanceScenario({
  requestedProvider,
  scenario,
  injectSignedOut,
  contractIds,
  alice,
  bob,
  carol,
  artifact,
  assertionReceipts,
  sensitiveValues,
}) {
  let boot = null;
  let loginStarted = false;
  let loginSessionToken = '';
  let claimedOperations = new Set();
  const disposals = [];
  const cleanup = {
    scenario,
    attempted: false,
    completed: null,
    revokedMatchesMinted: null,
  };
  artifact.cleanup.push(cleanup);

  const runStep = async (name, targetIds, execute) => {
    for (const targetId of targetIds) {
      if (!contractIds.has(targetId)) {
        throw new Error(`${targetId} is not present in the frozen social-messenger CONTRACT.md`);
      }
    }
    const step = { scenario, name, targetIds, status: 'running', details: null };
    artifact.steps.push(step);
    const missingClaims = (STEP_REQUIRED_CLAIMS[name] ?? []).filter(
      (operation) => !claimedOperations.has(operation),
    );
    if (missingClaims.length > 0) {
      step.status = 'skipped-by-claim';
      step.details = { missingClaims };
      assertionReceipts.push({ implemented: false, required: false, status: 'skipped' });
      artifact.assertions.push({
        scenario,
        name,
        pass: null,
        skippedByClaim: true,
        missingClaims,
      });
      return;
    }
    try {
      step.details = (await execute()) ?? null;
      step.status = 'passed';
      assertionReceipts.push({ implemented: true, required: true, status: 'passed' });
      artifact.assertions.push({ scenario, name, pass: true });
    } catch (error) {
      const redactedError = redactedErrorText(error, sensitiveValues);
      step.status = 'failed';
      step.details = { error: redactedError };
      assertionReceipts.push({ implemented: true, required: true, status: 'failed' });
      artifact.assertions.push({ scenario, name, pass: false, error: redactedError });
      throw error;
    }
  };

  try {
    boot = bootCoterieProvider(requestedProvider);
    const providerClaimsHandle = requireQueryHandle(
      listProviderClaims({}),
      'listProviderClaims',
    );
    const providerClaimsLog = createDeliveryLog('listProviderClaims');
    disposals.push(providerClaimsHandle.subscribe((rows) => providerClaimsLog.push(rows)));
    const providerClaimRows = await providerClaimsLog.waitFor();
    claimedOperations = new Set(providerClaimRows.map((claim) => claim.name));
    artifact.providerClaims[scenario] = providerClaimRows;
    if (injectSignedOut) {
      if (!claimedOperations.has('logout')) {
        throw new Error('injected-signed-out scenario requires a claimed logout operation');
      }
      const value = requireObject(
        requireMutationSuccess(await logout({}), 'signed-out state injection'),
        'signed-out state injection',
      );
      rememberSensitiveValue(sensitiveValues, value.revokedToken);
    }

    const sessionHandle = requireQueryHandle(listSession({}), 'listSession');
    const profileHandle = requireQueryHandle(listProfiles({}), 'listProfiles');
    const sessionLog = createDeliveryLog('listSession');
    const profileLog = createDeliveryLog('listProfiles');
    disposals.push(
      sessionHandle.subscribe((rows) => sessionLog.push(rows)),
      profileHandle.subscribe((rows) => profileLog.push(rows)),
    );

    let initialSessionToken = '';
    await runStep('signed-out-precondition', ['sm-settings-logout'], async () => {
      await sessionLog.waitFor();
      const initialSessions = requireLatestRows(sessionLog.deliveries, 'initial listSession');
      if (initialSessions.length > 1) {
        throw new Error('listSession returned more than one active session at boot');
      }
      if (initialSessions.length === 1) {
        if (!initialSessions[0].signedIn) {
          throw new Error('listSession returned a boot session that was not signed in');
        }
        initialSessionToken = requireNonEmptyString(
          initialSessions[0].token,
          'initial listSession token',
        );
        rememberSensitiveValue(sensitiveValues, initialSessionToken);
        const value = requireObject(
          requireMutationSuccess(await logout({}), 'precondition logout'),
          'precondition logout',
        );
        rememberSensitiveValue(sensitiveValues, value.revokedToken);
        if (value.revokedToken !== initialSessionToken) {
          throw new Error('precondition logout did not revoke the boot session token');
        }
      }
      const active = requireLatestRows(sessionLog.deliveries, 'post-precondition listSession');
      if (active.length !== 0) {
        throw new Error('signed-out precondition did not establish an empty session projection');
      }
      return {
        initialSessionPresent: initialSessions.length === 1,
        initialTokenPresent: initialSessionToken.length > 0,
        revokedInitialSession: initialSessionToken.length > 0,
        revokedMatchesInitial: initialSessionToken.length > 0 ? true : null,
        activeSessionCount: active.length,
      };
    });

    await runStep(
      'login',
      ['sm-auth-email', 'sm-auth-password', 'sm-auth-submit'],
      async () => {
        loginStarted = true;
        const value = requireObject(
          requireMutationSuccess(
            await login({ email: alice.email, password: alice.password }),
            'login',
          ),
          'login',
        );
        const userId = requireNonEmptyString(value.userId, 'login userId');
        const sessionToken = requireNonEmptyString(value.sessionToken, 'login sessionToken');
        rememberSensitiveValue(sensitiveValues, sessionToken);
        loginSessionToken = sessionToken;
        const active = requireLatestRows(sessionLog.deliveries, 'post-login listSession');
        if (
          userId !== alice.id ||
          active.length !== 1 ||
          active[0].userId !== userId ||
          active[0].token !== sessionToken ||
          !active[0].signedIn
        ) {
          throw new Error('login was not observable through listSession');
        }
        if (initialSessionToken && sessionToken === initialSessionToken) {
          throw new Error('login reused the revoked boot session instead of minting a new one');
        }
        return {
          userId,
          tokenPresent: true,
          tokenMatchesProjection: true,
          tokenRotated: initialSessionToken ? sessionToken !== initialSessionToken : null,
          activeSessionCount: active.length,
        };
      },
    );
    requireNonEmptyString(loginSessionToken, 'recorded login sessionToken');

    const loginAs = async (persona) => {
      const value = requireObject(
        requireMutationSuccess(
          await login({ email: persona.email, password: persona.password }),
          `login(${persona.id})`,
        ),
        `login(${persona.id})`,
      );
      loginSessionToken = requireNonEmptyString(value.sessionToken, `login(${persona.id}) token`);
      rememberSensitiveValue(sensitiveValues, loginSessionToken);
      await sessionLog.waitFor(
        (rows) => rows.length === 1
          && rows[0].userId === persona.id
          && rows[0].token === loginSessionToken,
      );
      return value;
    };

    const editedDisplayName = `Alice Acceptance Edit ${scenario}`;
    const editedBio = 'Edited by the Coterie M1 acceptance flow.';
    const deliveriesBeforeEdit = profileLog.deliveries.length;
    await runStep(
      'profile-edit',
      [
        'sm-profile-edit',
        'sm-profile-field-displayname',
        'sm-profile-field-bio',
        'sm-profile-save',
      ],
      async () => {
        requireMutationSuccess(
          await editProfile({
            displayName: editedDisplayName,
            bio: editedBio,
            handle: null,
            location: null,
            link: null,
          }),
          'editProfile',
        );
        return { displayName: editedDisplayName, bio: editedBio };
      },
    );

    await runStep('profile-edit-observable', ['sm-profile'], async () => {
      const aliceProfile = requireLatestRows(
        profileLog.deliveries,
        'post-edit listProfiles',
      ).find(
        (profile) => profile.id === alice.id,
      );
      if (profileLog.deliveries.length <= deliveriesBeforeEdit) {
        throw new Error('listProfiles emitted no post-edit invalidation delivery');
      }
      if (
        aliceProfile?.displayName !== editedDisplayName ||
        aliceProfile?.bio !== editedBio
      ) {
        throw new Error('edited display name and bio were not observable through listProfiles');
      }
      return {
        deliveryCount: profileLog.deliveries.length,
        displayName: aliceProfile.displayName,
        bio: aliceProfile.bio,
      };
    });

    const globalFeedHandle = requireQueryHandle(
      listFeed({ mode: 'global', cursor: null }),
      'listFeed(global)',
    );
    const followingFeedHandle = requireQueryHandle(
      listFeed({ mode: 'following', cursor: null }),
      'listFeed(following)',
    );
    const globalFeedLog = createDeliveryLog('listFeed(global)');
    const followingFeedLog = createDeliveryLog('listFeed(following)');
    disposals.push(
      globalFeedHandle.subscribe((rows) => globalFeedLog.push(rows)),
      followingFeedHandle.subscribe((rows) => followingFeedLog.push(rows)),
    );
    await Promise.all([
      globalFeedLog.waitFor((rows) => rows.length > 0),
      followingFeedLog.waitFor((rows) => rows.length > 0),
    ]);

    await runStep(
      'm2-boot-global-following-split',
      ['sm-feed-tab-global', 'sm-feed-tab-following', 'sm-feed-item'],
      async () => {
        const globalRows = requireLatestRows(globalFeedLog.deliveries, 'boot Global feed');
        const followingRows = requireLatestRows(
          followingFeedLog.deliveries,
          'boot Following feed',
        );
        const globalHasDave = globalRows.some(
          (post) => post.authorId === 'dave' && post.repostedById === null,
        );
        const followingHasDave = followingRows.some(
          (post) => post.authorId === 'dave' && post.repostedById === null,
        );
        if (!globalHasDave || followingHasDave) {
          throw new Error(
            'boot feed split did not keep an unfollowed author in Global and out of Following '
              + `(globalHasDave=${globalHasDave}, followingHasDave=${followingHasDave}, `
              + `globalRows=${globalRows.length}, followingRows=${followingRows.length})`,
          );
        }
        return {
          unfollowedUserId: 'dave',
          observedInGlobal: globalHasDave,
          absentFromFollowing: !followingHasDave,
        };
      },
    );

    let acceptancePostId = '';
    await runStep(
      'm2-create-text-global',
      ['sm-compose-input', 'sm-compose-submit', 'sm-feed-tab-global', 'sm-feed-item'],
      async () => {
        const deliveriesBeforeCreate = globalFeedLog.deliveries.length;
        const value = requireObject(
          requireMutationSuccess(
            await createPost({
              body: `Coterie M2 acceptance post ${scenario}`,
              imageRefs: [],
              videoRefs: [],
              parentId: null,
            }),
            'createPost',
          ),
          'createPost',
        );
        acceptancePostId = requireNonEmptyString(value.id, 'createPost id');
        const rows = await globalFeedLog.waitFor((delivery) =>
          delivery.some((post) => post.postId === acceptancePostId),
        );
        if (globalFeedLog.deliveries.length <= deliveriesBeforeCreate) {
          throw new Error('Global feed emitted no post-create invalidation delivery');
        }
        const post = rows.find((candidate) => candidate.postId === acceptancePostId);
        if (post?.body !== `Coterie M2 acceptance post ${scenario}`) {
          throw new Error('created text post was not observable in Global feed');
        }
        return {
          postIdPresent: true,
          observedInGlobal: true,
          deliveryCount: globalFeedLog.deliveries.length,
        };
      },
    );

    await runStep(
      'm2-follow-following-projection',
      ['sm-profile-follow', 'sm-feed-tab-following', 'sm-feed-item'],
      async () => {
        requireMutationSuccess(
          await setFollow({
            userId: 'dave',
            following: false,
            mutationId: `accept-follow-clear-dave-${scenario}`,
          }),
          'setFollow(clear precondition)',
        );
        await followingFeedLog.waitFor(
          (rows) => !rows.some((post) => post.authorId === 'dave' && post.repostedById === null),
        );
        const deliveriesBeforeFollow = followingFeedLog.deliveries.length;
        requireMutationSuccess(
          await setFollow({
            userId: 'dave',
            following: true,
            mutationId: `accept-follow-set-dave-${scenario}`,
          }),
          'setFollow(set)',
        );
        const rows = await followingFeedLog.waitFor((delivery) =>
          delivery.some((post) => post.authorId === 'dave' && post.repostedById === null),
        );
        if (followingFeedLog.deliveries.length <= deliveriesBeforeFollow) {
          throw new Error('Following feed emitted no follow invalidation delivery');
        }
        requireMutationSuccess(
          await setFollow({
            userId: 'dave',
            following: false,
            mutationId: `accept-follow-restore-dave-${scenario}`,
          }),
          'setFollow(restore precondition)',
        );
        await followingFeedLog.waitFor(
          (delivery) => !delivery.some(
            (post) => post.authorId === 'dave' && post.repostedById === null,
          ),
        );
        return {
          followedUserId: 'dave',
          directPostCount: rows.filter(
            (post) => post.authorId === 'dave' && post.repostedById === null,
          ).length,
          observedInFollowing: true,
        };
      },
    );

    await runStep('m2-like-toggle-observable', ['sm-post-like', 'sm-feed-item'], async () => {
      requireNonEmptyString(acceptancePostId, 'recorded acceptance post id');
      requireMutationSuccess(
        await setLike({
          postId: acceptancePostId,
          liked: true,
          mutationId: `accept-like-set-${scenario}`,
        }),
        'setLike(set)',
      );
      const likedRows = await globalFeedLog.waitFor((rows) =>
        rows.some(
          (post) =>
            post.postId === acceptancePostId && post.likedByMe === true && post.likeCount === 1,
        ),
      );
      requireMutationSuccess(
        await setLike({
          postId: acceptancePostId,
          liked: false,
          mutationId: `accept-like-clear-${scenario}`,
        }),
        'setLike(clear)',
      );
      const unlikedRows = await globalFeedLog.waitFor((rows) =>
        rows.some(
          (post) =>
            post.postId === acceptancePostId && post.likedByMe === false && post.likeCount === 0,
        ),
      );
      return {
        likedObserved: likedRows.some((post) => post.postId === acceptancePostId),
        unlikedObserved: unlikedRows.some((post) => post.postId === acceptancePostId),
      };
    });

    const chatLog = createDeliveryLog('listChats');
    if (claimedOperations.has('listChats')) {
      const chatHandle = requireQueryHandle(listChats({}), 'listChats');
      disposals.push(chatHandle.subscribe((rows) => chatLog.push(rows)));
      await chatLog.waitFor();
    }

    let directChatId = '';
    await runStep('m3-open-dm-deduplicated', ['sm-chats-item'], async () => {
      const first = requireObject(
        requireMutationSuccess(await openDm({ userId: bob.id }), 'openDm(first)'),
        'openDm(first)',
      );
      const second = requireObject(
        requireMutationSuccess(await openDm({ userId: bob.id }), 'openDm(second)'),
        'openDm(second)',
      );
      directChatId = requireNonEmptyString(first.chatId, 'openDm chatId');
      if (second.chatId !== directChatId || second.reused !== true) {
        throw new Error('openDm did not return the canonical Alice/Bob conversation');
      }
      const rows = await chatLog.waitFor((delivery) =>
        delivery.some((chat) => chat.id === directChatId),
      );
      if (rows.filter((chat) => chat.id === directChatId).length !== 1) {
        throw new Error('deduplicated direct conversation was not unique in listChats');
      }
      return { chatIdPresent: true, reused: second.reused, uniqueProjection: true };
    });

    const messageLog = createDeliveryLog('listMessages(dm)');
    const typingLog = createDeliveryLog('observeTyping(dm)');
    if (directChatId && claimedOperations.has('listMessages')) {
      const messageHandle = requireQueryHandle(
        listMessages({ chatId: directChatId }),
        'listMessages(dm)',
      );
      disposals.push(messageHandle.subscribe((rows) => messageLog.push(rows)));
      await messageLog.waitFor();
    }
    if (directChatId && claimedOperations.has('observeTyping')) {
      const typingHandle = requireQueryHandle(
        observeTyping({ chatId: directChatId }),
        'observeTyping(dm)',
      );
      disposals.push(typingHandle.subscribe((rows) => typingLog.push(rows)));
      await typingLog.waitFor();
    }

    const acceptanceMessageBody = `Coterie M3 direct message ${scenario}`;
    let acceptanceMessageId = '';
    await runStep(
      'm3-send-text',
      ['sm-convo-input', 'sm-convo-send', 'sm-convo-bubble', 'sm-convo-receipt'],
      async () => {
        requireMutationSuccess(
          await sendMessage({
            chatId: directChatId,
            body: acceptanceMessageBody,
            quotedMessageId: null,
          }),
          'sendMessage(text)',
        );
        const rows = await messageLog.waitFor((delivery) =>
          delivery.some((message) => message.body === acceptanceMessageBody),
        );
        const message = rows.find((candidate) => candidate.body === acceptanceMessageBody);
        acceptanceMessageId = requireNonEmptyString(message?.id, 'sent message id');
        if (!message?.mine || message.status !== 'sent') {
          throw new Error('new direct message did not project as the sender\'s sent message');
        }
        return { messageIdPresent: true, bodyLength: [...acceptanceMessageBody].length };
      },
    );

    const quoteBody = `Quoted reply ${scenario}`;
    await runStep(
      'm3-quoted-reply-preserves-source',
      ['sm-convo-quote', 'sm-convo-quote-preview', 'sm-convo-bubble'],
      async () => {
        await loginAs(bob);
        requireMutationSuccess(
          await sendMessage({
            chatId: directChatId,
            body: quoteBody,
            quotedMessageId: acceptanceMessageId,
          }),
          'sendMessage(quote)',
        );
        await loginAs(alice);
        const rows = await messageLog.waitFor((delivery) => delivery.some(
          (message) => message.body === quoteBody
            && message.quotedMessageId === acceptanceMessageId,
        ));
        const reply = rows.find((message) => message.body === quoteBody);
        if (
          reply?.quotedMessageId !== acceptanceMessageId
          || reply.quotedBodySnippet !== acceptanceMessageBody
        ) {
          throw new Error('quoted reply did not preserve its v7 source projection');
        }
        return { quotedMessageIdPreserved: true, quotedBodyPreserved: true };
      },
    );

    await runStep('m3-receipts-monotonic', ['sm-convo-receipt'], async () => {
      await loginAs(bob);
      requireMutationSuccess(
        await markReceipt({ chatId: directChatId, state: 'delivered' }),
        'markReceipt(delivered)',
      );
      await loginAs(alice);
      await messageLog.waitFor((delivery) => delivery.some(
        (message) => message.id === acceptanceMessageId && message.status === 'delivered',
      ));

      await loginAs(bob);
      requireMutationSuccess(
        await markReceipt({ chatId: directChatId, state: 'read' }),
        'markReceipt(read)',
      );
      requireMutationSuccess(
        await markReceipt({ chatId: directChatId, state: 'delivered' }),
        'markReceipt(non-regression)',
      );
      await loginAs(alice);
      const rows = await messageLog.waitFor((delivery) => delivery.some(
        (message) => message.id === acceptanceMessageId && message.status === 'read',
      ));
      const message = rows.find((candidate) => candidate.id === acceptanceMessageId);
      if (message?.readCount !== 1 || message.deliveredCount !== 1) {
        throw new Error('read receipt aggregate did not retain delivered/read counts');
      }
      return { statesObserved: ['sent', 'delivered', 'read'], regressionRefused: true };
    });

    await runStep('m3-typing-lease-expires', ['sm-convo-typing'], async () => {
      let typingActor = null;
      let typingActorAuthenticated = false;
      try {
        if (requestedProvider === 'snapback') {
          // A Snapback typing entry is connection-owned. Keep Alice's
          // observer authenticated while a second adapter connection owns
          // Bob's five-second publisher lease.
          typingActor = createCoterieSnapbackProvider({
            baseUrl: resolveCoterieSnapbackUrl(),
            custody: 'memory',
            storagePartition: `coterie-typing-${scenario}-${Date.now()}`,
          });
          const loginValue = requireObject(
            requireMutationSuccess(
              await typingActor.mutate('login', {
                email: bob.email,
                password: bob.password,
              }),
              'typing actor login(bob)',
            ),
            'typing actor login(bob)',
          );
          rememberSensitiveValue(sensitiveValues, loginValue.sessionToken);
          typingActorAuthenticated = true;
          requireMutationSuccess(
            await typingActor.mutate('setTyping', { chatId: directChatId, active: true }),
            'typing actor setTyping(active)',
          );
        } else {
          await loginAs(bob);
          requireMutationSuccess(
            await setTyping({ chatId: directChatId, active: true }),
            'setTyping(active)',
          );
          await loginAs(alice);
        }
        const visible = await typingLog.waitFor(
          (rows) => rows.some((participant) => participant.userId === bob.id),
          2000,
        );
        if (visible.length !== 1) {
          throw new Error('typing observer projected an unexpected participant count');
        }
        const expiryDelivery = typingLog.waitForFuture((rows) => rows.length === 0, 7000);
        let expiryProbe = 'wall-clock';
        if (typeof boot.advanceClock === 'function') {
          expiryProbe = 'provider-clock-capability';
          boot.advanceClock(5000);
        }
        await expiryDelivery;
        return {
          appeared: true,
          visibilityBudgetMs: 2000,
          leaseMs: 5000,
          expiryProbe,
          expired: true,
        };
      } finally {
        if (typingActor) {
          if (typingActorAuthenticated) {
            const logoutResult = await typingActor.mutate('logout', {}).catch(() => null);
            if (logoutResult?.ok) {
              rememberSensitiveValue(sensitiveValues, logoutResult.value?.revokedToken);
            }
          }
          await typingActor.close();
        }
      }
    });

    let groupChatId = '';
    await runStep(
      'm3-group-create-and-admin-remove',
      ['sm-chats-item', 'sm-convo-settings'],
      async () => {
        const created = requireObject(
          requireMutationSuccess(
            await createGroup({
              name: `Acceptance crew ${scenario}`,
              description: 'M3 deterministic group lifecycle.',
              memberIds: [alice.id, bob.id, carol.id],
            }),
            'createGroup',
          ),
          'createGroup',
        );
        groupChatId = requireNonEmptyString(created.chatId, 'createGroup chatId');
        await chatLog.waitFor((rows) => rows.some(
          (chat) => chat.id === groupChatId && chat.memberIds.length === 3,
        ));

        await loginAs(bob);
        const refused = await removeMember({ chatId: groupChatId, userId: carol.id });
        if (refused?.ok !== false || refused.error?.name !== 'ChatAdminRequiredError') {
          throw new Error('non-admin group removal was not refused with ChatAdminRequiredError');
        }

        await loginAs(alice);
        requireMutationSuccess(
          await removeMember({ chatId: groupChatId, userId: carol.id }),
          'removeMember(admin)',
        );
        const rows = await chatLog.waitFor((delivery) => delivery.some(
          (chat) => chat.id === groupChatId
            && !chat.memberIds.includes(carol.id)
            && chat.memberIds.length === 2,
        ));
        const group = rows.find((chat) => chat.id === groupChatId);
        return {
          groupIdPresent: true,
          nonAdminRefused: true,
          remainingMemberIds: group.memberIds,
        };
      },
    );

    await runStep('logout', ['sm-settings-logout'], async () => {
      const value = requireObject(
        requireMutationSuccess(await logout({}), 'logout'),
        'logout',
      );
      rememberSensitiveValue(sensitiveValues, value.revokedToken);
      if (value.revokedToken !== loginSessionToken) {
        throw new Error('logout did not revoke the session minted by login');
      }
      const active = requireLatestRows(sessionLog.deliveries, 'post-logout listSession');
      if (active.length !== 0) {
        throw new Error('logout did not clear the active listSession projection');
      }
      loginStarted = false;
      loginSessionToken = '';
      return {
        activeSessionCount: active.length,
        revokedMatchesMinted: true,
      };
    });
  } finally {
    if (loginStarted) {
      cleanup.attempted = true;
      try {
        const value = requireObject(
          requireMutationSuccess(await logout({}), 'cleanup logout'),
          'cleanup logout',
        );
        rememberSensitiveValue(sensitiveValues, value.revokedToken);
        cleanup.revokedMatchesMinted = loginSessionToken
          ? value.revokedToken === loginSessionToken
          : null;
        cleanup.completed = loginSessionToken ? cleanup.revokedMatchesMinted : true;
      } catch (error) {
        cleanup.completed = false;
        cleanup.error = redactedErrorText(error, sensitiveValues);
      }
    }
    for (const disposable of disposals.reverse()) disposable.dispose();
    boot?.dispose();
  }
}

async function main() {
  const requestedProvider = process.env.COTERIE_PROVIDER ?? 'memory';
  const artifactPath = resolve(
    process.env.COTERIE_ACCEPTANCE_ARTIFACT ??
      `.data/acceptance/coterie-provider-proof-${safeProviderName(requestedProvider)}.json`,
  );
  const artifact = {
    schemaVersion: 'coterie.provider-proof.v1',
    scope: 'provider-claimed-operations-through-m3',
    provider: requestedProvider,
    mechanism: 'headless-generated-binding-provider-proof',
    evidenceClass: 'binding-level-provider-proof',
    mountedContractTree: false,
    browserContextCount: 0,
    socketRequired: requestedProvider === 'snapback',
    authorities: {
      testIds: 'benchmarks/tools/social-messenger/CONTRACT.md',
      personas: 'benchmarks/fixtures/social-messenger/personas.json',
      aggregation: 'benchmarks/tools/social-messenger/choreography/choreography.mjs',
    },
    scenarios: [],
    providerClaims: {},
    steps: [],
    assertions: [],
    cleanup: [],
    pass: false,
    error: null,
  };
  const assertionReceipts = [];
  const sensitiveValues = new Set();

  try {
    if (requestedProvider === 'snapback') {
      await installM3Fixtures({
        baseUrl: resolveCoterieSnapbackUrl(),
        runId: `accept-${Date.now()}`,
        destructiveResetConfirmed: true,
      });
    }
    const { contractIds, alice, bob, carol } = await loadAuthorities();
    // @ref LLP 0266#d10-acceptance-harness-direction-for-oq2 — one
    // parameterized runner owns every provider lane and its boot-state probes.
    const scenarios = [
      { name: 'provider-boot', injectSignedOut: false },
      { name: 'injected-signed-out', injectSignedOut: true },
    ];
    artifact.scenarios = scenarios.map(({ name }) => name);
    for (const scenario of scenarios) {
      await runAcceptanceScenario({
        requestedProvider,
        scenario: scenario.name,
        injectSignedOut: scenario.injectSignedOut,
        contractIds,
        alice,
        bob,
        carol,
        artifact,
        assertionReceipts,
        sensitiveValues,
      });
    }

    artifact.pass = true;
  } catch (error) {
    artifact.error = redactedErrorText(error, sensitiveValues);
  } finally {
    const bindingAggregation = aggregateChoreography(assertionReceipts);
    artifact.bindingAggregation = {
      counts: bindingAggregation.counts,
      bindingPass: bindingAggregation.browserPass,
      reason: bindingAggregation.reason,
    };
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      `${serializeRedactedArtifact(artifact, sensitiveValues)}\n`,
      'utf8',
    );
    process.stdout.write(
      `${artifact.pass ? 'PASS' : 'FAIL'} Coterie headless provider proof (${requestedProvider})\n` +
        `scenarios: ${artifact.scenarios.join(', ')}\n` +
        `steps: ${artifact.steps.filter((step) => step.status === 'passed').length}/${artifact.steps.length}\n` +
        `skipped-by-claim: ${artifact.steps.filter((step) => step.status === 'skipped-by-claim').length}\n` +
        `artifact: ${artifactPath}\n`,
    );
    if (!artifact.pass) {
      process.stderr.write(`${artifact.error}\n`);
      process.exitCode = 1;
    }
  }
}

await main();
