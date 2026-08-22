import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  defineStarterAcceptance,
  runStarterAcceptanceIfMain,
} from '@expo/snapback-acceptance';
import { createSnapbackAppClient } from '@expo/snapback-client';
import { IDBFactory } from 'fake-indexeddb';
import { runExpoDev } from '@expo/snapback-cli/expo-dev';
import {
  createSnapbackExpoBoot,
  createSupervisedExpoEnvironment,
} from '@expo/snapback-expo';
import {
  createSnapbackReactProvider,
  observeSnapbackSurface,
  skip,
} from '@expo/snapback-react';
import api, { app } from './snapback/generated/api.mjs';
import artifacts from './snapback/generated/artifacts.json' with { type: 'json' };

const CONVERSATION_ID = 'conversation_engine_room';
const root = import.meta.dirname;

const snapshotEnvFiles = (directory) => {
  const files = {};
  const visit = (current, prefix = '') => {
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const path = join(current, entry.name);
      const relativePath = join(prefix, entry.name);
      if (entry.isDirectory()) visit(path, relativePath);
      else if (/^\.env/u.test(entry.name)) files[relativePath] = readFileSync(path).toString('base64');
    }
  };
  visit(directory);
  return files;
};

// @ref LLP 0223#design-detail — the Expo starter keeps the zero-config
// assertion and app-level round trip visible as product evidence. The shared
// runner supplies its bound step and cleanup envelope, not the product claim.
async function runZeroConfigSupervisedConnect({ stateRoot, signal }) {
  const supervisedReadyFile = join(stateRoot, 'supervised.ready.json');
  const supervisedDatabase = join(stateRoot, 'supervised.sqlite3');
  const supervisorDescriptor = join(stateRoot, 'expo-supervisor.json');
  const metroScript = join(stateRoot, 'headless-metro.mjs');
  const environmentBefore = snapshotEnvFiles(root);
  const events = [];
  writeFileSync(metroScript, `
import { createServer } from 'node:http';

const port = Number(process.env.SNAPBACK_EXPO_METRO_PORT);
const supervisorOrigin = process.env.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN;
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ ok: true, supervisorOrigin }));
});
server.listen(port, '127.0.0.1');
const stop = () => server.close(() => process.exit(0));
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
`);

  let supervisor = null;
  let roundTripBoot = null;
  let details = null;
  try {
    supervisor = await runExpoDev({
      backendDirectory: join(root, 'snapback'),
      projectRoot: root,
      expoDirectory: root,
      readyFile: supervisedReadyFile,
      database: supervisedDatabase,
      platform: 'ios',
      email: 'zero-config@expo-chat.test',
      metroCommand: { command: process.execPath, args: [metroScript] },
      serverStdio: ['ignore', 'ignore', 'ignore'],
      signal,
      onEvent(event) { events.push(event); },
    });
    assert.equal(supervisor.state, 'ready');
    assert.equal(supervisor.connectCarrier, 'supervisor-rendezvous');
    const readiness = events.find((event) => event.state === 'ready');
    assert(readiness, 'supervised acceptance must observe the final readiness event');
    assert.equal(readiness.connectCarrier, 'supervisor-rendezvous');
    assert.equal(readiness.authority.status, 'ready');
    assert.equal(readiness.authority.authMode, 'sessions');
    assert.deepEqual(snapshotEnvFiles(root), environmentBefore);
    assert.equal(existsSync(supervisorDescriptor), true);
    assert.equal(statSync(supervisorDescriptor).mode & 0o777, 0o600);

    const metroResponse = await fetch(supervisor.metroOrigin, { signal });
    assert.equal(metroResponse.ok, true);
    const metroFacts = await metroResponse.json();
    assert.equal(metroFacts.supervisorOrigin, readiness.bootstrap.origin);

    const environment = createSupervisedExpoEnvironment({
      exchangeOrigin: readiness.bootstrap.origin,
      bindingCache: null,
      appState: {
        currentState: 'active',
        addEventListener() { return { remove() {} }; },
      },
    });
    roundTripBoot = createSnapbackExpoBoot({ app, environment });
    const bootState = await roundTripBoot.start();
    assert.equal(bootState.status, 'ready');
    assert.equal(bootState.binding.source, 'supervised-dev');
    assert.equal(bootState.binding.target.origin, readiness.binding.target.origin);
    const roundTripClient = roundTripBoot.appClient().client;
    const before = (await roundTripClient.query(api.messagesForConversation, {
      args: { conversationId: CONVERSATION_ID },
    })).rows;
    const body = `Zero-config supervised acceptance ${process.pid}`;
    const mutation = await roundTripClient.mutate(api.sendMessage, {
      args: {
        conversationId: CONVERSATION_ID,
        senderId: 'user_ada',
        body,
      },
      clientMutationId: `zero-config-supervised-${process.pid}`,
    });
    assert.equal(typeof mutation.result, 'string');
    const after = (await roundTripClient.query(api.messagesForConversation, {
      args: { conversationId: CONVERSATION_ID },
    })).rows;
    assert.equal(before.some((row) => row.text === body), false);
    assert(after.some((row) => row._id === mutation.result && row.text === body));
    details = {
      connectCarrier: readiness.connectCarrier,
      authMode: readiness.authority.authMode,
      queryFunctionId: api.messagesForConversation.id,
      mutationFunctionId: api.sendMessage.id,
      descriptorMode: '0600',
    };
  } finally {
    await roundTripBoot?.dispose();
    await supervisor?.close();
  }
  assert.deepEqual(snapshotEnvFiles(root), environmentBefore);
  assert.equal(existsSync(supervisorDescriptor), false);
  return details;
}

export const acceptance = defineStarterAcceptance({
  acceptanceFile: import.meta.url,
  appRoot: import.meta.dirname,
  artifacts,
  stepTimeoutMs: 60_000,
  paths: {
    zeroConfig: {
      id: 'zero-config-supervised-connect',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: null,
      timeoutMs: 120_000,
    },
    webAnonymousReady: {
      id: 'web-anonymous-ready',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: null,
    },
    passwordSignupRecovery: {
      id: 'password-signup-recovery',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: null,
    },
    reloadClearsVolatilePrincipal: {
      id: 'reload-clears-volatile-principal',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: null,
    },
    authenticatedEntryRefusal: {
      id: 'authenticated-entry-refusal',
      kind: 'failure',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: null,
    },
    signOut: {
      id: 'sign-out',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: null,
    },
    nativeRefusal: {
      id: 'native-refusal',
      kind: 'failure',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: null,
    },
    conversationShape: {
      id: 'membership-dm-group-shape',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.conversations,
    },
    personaMemberships: {
      id: 'test-persona-membership-switch',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.membershipsForUser,
    },
    conversationSurface: {
      id: 'conversation-surface-read',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.messagesForConversation,
      provenance: 'baseline',
    },
    sendMessage: {
      id: 'send-message',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.sendMessage,
      provenance: 'baseline',
    },
    reply: {
      id: 'reply',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.sendReply,
    },
    reaction: {
      id: 'reaction',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.addReaction,
    },
  },
  async preflight(context) {
    await context.step(
      context.paths.zeroConfig,
      (signal) => runZeroConfigSupervisedConnect({ ...context, signal }),
      { timeoutMs: 120_000 },
    );
  },
  async journey({ bindingFor, createSessionClient, defer, paths, step, until }) {
    let surface = null;
    let provider = null;
    let appClient = null;
    defer(async () => {
      await surface?.dispose();
      surface = null;
      await provider?.dispose();
      if (provider) {
        assert.deepEqual(
          {
            stores: provider.inspection().stores,
            consumers: provider.inspection().consumers,
            subscriptions: provider.inspection().serverSubscriptions,
            leases: provider.inspection().leases,
            timers: provider.inspection().timers,
            listeners: provider.inspection().listeners,
          },
          { stores: 0, consumers: 0, subscriptions: 0, leases: 0, timers: 0, listeners: 0 },
        );
      }
      await appClient?.dispose();
      appClient = null;
    });

    const binding = bindingFor(app, {
      offeredCapabilities: ['auth.passwords'],
      supervisorGeneration: `expo-chat-acceptance-${app.identity.descriptor}`,
    });
    const platform = Object.freeze({
      kind: 'expo-web',
      indexedDB: new IDBFactory(),
      cryptoObject: webcrypto,
      databaseName: `snapback-expo-chat-acceptance-${process.pid}`,
    });
    appClient = await createSnapbackAppClient({ app, binding, platform });

    await step(paths.webAnonymousReady, async () => {
      assert.equal(appClient.bootstrapState().status, 'ready');
      assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
      return { platform: 'expo-web', principal: 'anonymous' };
    });

    const identity = `expo-chat-${process.pid}@example.com`;
    const password = 'expo-chat-password';
    let signedUpUserId;
    await step(paths.passwordSignupRecovery, async () => {
      const signup = await appClient.auth.signUpWithPassword({ email: identity, password });
      assert.equal(signup.recoveryCodes.length, 8);
      assert.equal(Object.hasOwn(signup, 'token'), false);
      assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
      signedUpUserId = appClient.auth.currentPrincipal().userId;
      return { recoveryCodeCount: signup.recoveryCodes.length, bearerProjected: false };
    });

    await step(paths.reloadClearsVolatilePrincipal, async () => {
      await appClient.dispose();
      appClient = await createSnapbackAppClient({ app, binding, platform });
      // @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback
      // — this starter explicitly chooses volatile custody.
      assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
      return { custody: app.authBootstrap.custody, principal: 'anonymous' };
    });

    await step(paths.authenticatedEntryRefusal, async () => {
      const signin = await appClient.auth.signInWithPassword({ email: identity, password });
      assert.equal(signin.session.userId, signedUpUserId);
      assert.equal(appClient.auth.currentPrincipal().userId, signedUpUserId);
      await assert.rejects(
        appClient.auth.signUpWithPassword({ email: `second-${identity}`, password }),
        (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_AUTHENTICATED',
      );
      return { code: 'SNAPBACK_AUTH_ENTRY_AUTHENTICATED' };
    });

    await step(paths.signOut, async () => {
      await appClient.auth.signOut();
      assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
      return { principal: 'anonymous' };
    });

    await step(paths.nativeRefusal, async () => {
      await assert.rejects(
        createSnapbackAppClient({
          app,
          binding,
          platform: 'expo-native-phase-2-evidence-required',
        }),
        (error) => error?.code === 'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED'
          && error?.bootstrapState?.status === 'unsupported',
      );
      return {
        code: 'SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED',
        platform: 'expo-native-phase-2-evidence-required',
      };
    });

    const client = await createSessionClient({ email: 'acceptance@expo-chat.test' });
    let conversationRows;
    await step(paths.conversationShape, async () => {
      conversationRows = (await client.query(api.conversations, { args: {} })).rows;
      const adaMemberships = (await client.query(api.membershipsForUser, {
        args: { userId: 'user_ada' },
      })).rows;
      assert.deepEqual(new Set(conversationRows.map((row) => row.kind)), new Set(['dm', 'group']));
      assert.deepEqual(
        new Set(adaMemberships.map((row) => row.conversationId)),
        new Set(['conversation_ada_grace', 'conversation_ada_alan', CONVERSATION_ID]),
      );
      return {
        conversationKinds: [...new Set(conversationRows.map((row) => row.kind))].sort(),
        adaConversationCount: adaMemberships.length,
      };
    });

    await step(paths.personaMemberships, async () => {
      const graceMemberships = (await client.query(api.membershipsForUser, {
        args: { userId: 'user_grace' },
      })).rows;
      const katherineMemberships = (await client.query(api.membershipsForUser, {
        args: { userId: 'user_katherine' },
      })).rows;
      assert.notDeepEqual(
        graceMemberships.map((row) => row.conversationId).sort(),
        katherineMemberships.map((row) => row.conversationId).sort(),
      );
      assert.deepEqual(katherineMemberships.map((row) => row.conversationId), [CONVERSATION_ID]);
      return {
        graceConversationCount: graceMemberships.length,
        katherineConversationCount: katherineMemberships.length,
      };
    });

    let latest = null;
    await step(paths.conversationSurface, async () => {
      const preparedBinding = await client.prepareReactBinding({ generatedManifest: app });
      provider = createSnapbackReactProvider(preparedBinding, {
        connectionId: 'expo_chat_acceptance',
      });
      surface = observeSnapbackSurface(
        provider,
        app.surfaces.conversation,
        { conversationId: CONVERSATION_ID },
        { presence: { typing: skip } },
        (snapshot) => { latest = snapshot; },
      );
      await until(
        () => latest?.state.messages.status === 'ready'
          && latest?.state.memberships.status === 'ready'
          && latest?.state.reactions.status === 'ready'
          && (latest.data.messages?.length ?? 0) >= 3
          && latest.data.details?.[0]?.title === 'Engine Room',
        'initial conversation surface reads',
      );
      return {
        surface: 'conversation',
        messageRows: latest.data.messages.length,
        membershipRows: latest.data.memberships?.length ?? 0,
        reactionRows: latest.data.reactions?.length ?? 0,
        userRows: latest.data.users?.length ?? 0,
      };
    });

    let mutation;
    await step(paths.sendMessage, async () => {
      const text = `Generated acceptance ${process.pid}`;
      mutation = await client.mutate(api.sendMessage, {
        args: { conversationId: CONVERSATION_ID, senderId: 'user_ada', body: text },
        clientMutationId: `generated-acceptance-${process.pid}`,
      });
      assert.equal(typeof mutation.result, 'string');
      await until(
        () => latest?.state.messages.status === 'ready'
          && latest.data.messages.some((row) => row.text === text),
        'conversation surface mutation observation',
      );
      return { observedBy: api.messagesForConversation.id };
    });

    let reply;
    await step(paths.reply, async () => {
      const replyText = `Reply acceptance ${process.pid}`;
      reply = await client.mutate(api.sendReply, {
        args: {
          conversationId: CONVERSATION_ID,
          senderId: 'user_grace',
          text: replyText,
          replyToId: mutation.result,
        },
        clientMutationId: `generated-reply-acceptance-${process.pid}`,
      });
      assert.equal(typeof reply.result?.messageId, 'string');
      await until(
        () => latest?.data.messages?.some(
          (row) => row._id === reply.result.messageId
            && row.replyToId === mutation.result
            && row.text === replyText,
        ),
        'reply pointer surface observation',
      );
      return { observedBy: api.messagesForConversation.id };
    });

    await step(paths.reaction, async () => {
      const reaction = await client.mutate(api.addReaction, {
        args: {
          conversationId: CONVERSATION_ID,
          messageId: reply.result.messageId,
          userId: 'user_ada',
          emoji: '✅',
        },
        clientMutationId: `generated-reaction-acceptance-${process.pid}`,
      });
      assert.equal(typeof reaction.result?.reactionId, 'string');
      await until(
        () => latest?.data.reactions?.some(
          (row) => row._id === reaction.result.reactionId
            && row.messageId === reply.result.messageId
            && row.emoji === '✅',
        ),
        'reaction surface observation',
      );
      return { observedBy: api.reactionsForConversation.id };
    });
  },
});

await runStarterAcceptanceIfMain(import.meta, acceptance);
