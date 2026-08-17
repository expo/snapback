import { expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  assertDataProviderConformance,
  type DataProviderConformanceFixture,
} from '@exact/contract/conformance';
import type {
  ContractDataProvider,
  DataCellV2,
  DataSubscription,
} from '@exact/contract/runtime';

import { startServer } from '../../_kit/server-process.mjs';
import { loadGeneratedJson } from '../snapback/generated-artifacts.mjs';
import { installM3Fixtures } from '../snapback/seed-m3.mjs';
import { coterieSurfaceManifest } from '../src/data/memory-provider.ts';
import { createCoterieSnapbackProvider } from '../src/data/snapback-provider.ts';

const integrationTest = process.env.COTERIE_SNAPBACK_INTEGRATION === '1'
  ? test
  : test.skip;
const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY
    ?? join(repoRoot, 'target', 'debug', 'snapback'),
);
const aliceCredentials = {
  email: 'alice@example.com',
  password: 'Alice!Clique2026',
};
const bobCredentials = {
  email: 'bob@example.com',
  password: 'Bob!Clique2026',
};
const erinCredentials = {
  email: 'erin@example.com',
  password: 'Erin!Clique2026',
};

type Profile = {
  id: string;
  displayName: string;
  bio: string;
  avatarRef: string | null;
  followers: number;
  following: number;
  followedByMe: boolean;
};

type FeedItem = {
  id: string;
  postId: string;
  authorId: string;
  avatarUrl: string | null;
  body: string;
  likeCount: number;
  likedByMe: boolean;
  replyCount: number;
  repostedById: string | null;
  nextCursor: string | null;
  mediaKind: string | null;
  mediaUrls: string[];
};

type Chat = {
  id: string;
  memberIds: string[];
  currentUserIsMember: boolean;
  unreadCount: number;
};

type Message = {
  id: string;
  body: string;
  mine: boolean;
  status: string;
  recipientCount: number;
  deliveredCount: number;
  readCount: number;
};

function mutationValue<T>(
  result: Awaited<ReturnType<ContractDataProvider['mutate']>>,
  operation: string,
): T {
  if (!result.ok) {
    throw new Error(`${operation} failed: ${result.error.name}: ${result.error.message}`);
  }
  return result.value as T;
}

function readyStream<T>(
  provider: ContractDataProvider,
  queryName: string,
  args: Record<string, unknown> = {},
) {
  const rows: T[] = [];
  const cells: DataCellV2<T>[] = [];
  const waiters = new Set<{
    predicate(value: T): boolean;
    resolve(value: T): void;
    reject(error: Error): void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  const cellWaiters = new Set<{
    predicate(cell: DataCellV2<T>): boolean;
    resolve(cell: DataCellV2<T>): void;
    reject(error: Error): void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  const subscription = provider.subscribe<T>(queryName, args, (cell: DataCellV2<T>) => {
    cells.push(cell);
    for (const waiter of [...cellWaiters]) {
      if (!waiter.predicate(cell)) continue;
      clearTimeout(waiter.timeout);
      cellWaiters.delete(waiter);
      waiter.resolve(cell);
    }
    if (cell.status === 'error') {
      const error = new Error(cell.error.message);
      error.name = cell.error.name;
      for (const waiter of [...waiters]) {
        clearTimeout(waiter.timeout);
        waiters.delete(waiter);
        waiter.reject(error);
      }
      for (const waiter of [...cellWaiters]) {
        clearTimeout(waiter.timeout);
        cellWaiters.delete(waiter);
        waiter.reject(error);
      }
      return;
    }
    if (cell.status !== 'ready') return;
    rows.push(cell.value);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(cell.value)) continue;
      clearTimeout(waiter.timeout);
      waiters.delete(waiter);
      waiter.resolve(cell.value);
    }
  });

  return {
    rows,
    cells,
    next(predicate: (value: T) => boolean, timeoutMs = 20_000): Promise<T> {
      const existing = rows.findLast(predicate);
      if (existing !== undefined) return Promise.resolve(existing);
      return this.nextFuture(predicate, timeoutMs);
    },
    nextFuture(predicate: (value: T) => boolean, timeoutMs = 20_000): Promise<T> {
      return new Promise<T>((resolveNext, rejectNext) => {
        const waiter = {
          predicate,
          resolve: resolveNext,
          reject: rejectNext,
          timeout: setTimeout(() => {
            waiters.delete(waiter);
            rejectNext(new Error(`timed out waiting for ${queryName} live delivery`));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    nextCell(
      predicate: (cell: DataCellV2<T>) => boolean,
      timeoutMs = 30_000,
    ): Promise<DataCellV2<T>> {
      const existing = cells.findLast(predicate);
      if (existing !== undefined) return Promise.resolve(existing);
      return this.nextFutureCell(predicate, timeoutMs);
    },
    nextFutureCell(
      predicate: (cell: DataCellV2<T>) => boolean,
      timeoutMs = 30_000,
    ): Promise<DataCellV2<T>> {
      return new Promise<DataCellV2<T>>((resolveNext, rejectNext) => {
        const waiter = {
          predicate,
          resolve: resolveNext,
          reject: rejectNext,
          timeout: setTimeout(() => {
            cellWaiters.delete(waiter);
            rejectNext(new Error(`timed out waiting for ${queryName} connection delivery`));
          }, timeoutMs),
        };
        cellWaiters.add(waiter);
      });
    },
    dispose(): void {
      subscription.dispose();
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error(`${queryName} stream disposed`));
      }
      waiters.clear();
      for (const waiter of cellWaiters) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error(`${queryName} stream disposed`));
      }
      cellWaiters.clear();
    },
  };
}

async function loginAlice(provider: ContractDataProvider): Promise<void> {
  mutationValue(
    await provider.mutate('login', aliceCredentials),
    'login',
  );
}

integrationTest(
  'Snapback adapter passes M1+M2+M3-minus-typing conformance, live proofs, fault cuts, and recovery',
  { timeout: 900_000 },
  async () => {
    expect(existsSync(runtimeBinary)).toBe(true);
    const scratch = mkdtempSync(join(tmpdir(), 'coterie-provider-'));
    const providers = new Set<ReturnType<typeof createCoterieSnapbackProvider>>();
    const subscriptions = new Set<{ dispose(): void }>();
    let server: Awaited<ReturnType<typeof startServer>> | null = null;

    const provider = (
      options: Parameters<typeof createCoterieSnapbackProvider>[0] = {},
    ) => {
      if (!server) throw new Error('Snapback server is not running');
      const value = createCoterieSnapbackProvider({
        baseUrl: server.baseUrl,
        custody: 'memory',
        ...options,
      });
      providers.add(value);
      return value;
    };

    try {
      const stagedRuntime = join(scratch, 'snapback-runtime');
      symlinkSync(runtimeBinary, stagedRuntime);
      const carrier = join(scratch, 'startup-artifacts.json');
      const database = join(scratch, 'provider.sqlite3');
      writeFileSync(
        carrier,
        `${JSON.stringify({
          formatVersion: 1,
          schema: loadGeneratedJson('schema.manifest.json'),
          functions: loadGeneratedJson('functions.manifest.json'),
        })}\n`,
        { mode: 0o600 },
      );
      server = await startServer({
        port: 0,
        db: database,
        cwd: repoRoot,
        startupArtifacts: carrier,
        serverBinary: stagedRuntime,
      });
      await installM3Fixtures({ baseUrl: server.baseUrl, runId: 'provider-integration' });

      const clientA = provider();
      const clientB = provider();
      await Promise.all([loginAlice(clientA), loginAlice(clientB)]);
      const clientBProfiles = readyStream<Profile[]>(clientB, 'listProfiles');
      subscriptions.add(clientBProfiles);
      const initialProfiles = await clientBProfiles.next((rows) => (
        rows.some((row) => row.id === 'alice')
      ));
      expect(initialProfiles.find((row) => row.id === 'alice')?.avatarRef)
        .toBe('media/avatar-alice.png');
      expect(initialProfiles.find((row) => row.id === 'carol')?.avatarRef)
        .toBe('media/avatar-alice.png');

      const clientBFeed = readyStream<FeedItem[]>(
        clientB,
        'listFeed',
        { mode: 'global', cursor: null },
      );
      subscriptions.add(clientBFeed);
      await clientBFeed.next(() => true);

      const dm = mutationValue<{ chatId: string; reused: boolean }>(
        await clientA.mutate('openDm', { userId: 'bob' }),
        'client A openDm',
      );
      expect(dm.reused).toBe(true);
      const clientErin = provider();
      mutationValue(await clientErin.mutate('login', erinCredentials), 'client Erin login');
      const racedDm = await Promise.all([
        clientA.mutate('openDm', { userId: 'erin' }),
        clientErin.mutate('openDm', { userId: 'alice' }),
      ]);
      const racedDmValues = racedDm.map((result, index) => mutationValue<{
        chatId: string;
        reused: boolean;
      }>(result, `concurrent openDm ${index + 1}`));
      expect(new Set(racedDmValues.map(({ chatId }) => chatId)).size).toBe(1);
      expect(racedDmValues.map(({ reused }) => reused).sort()).toEqual([false, true]);
      const clientM3B = provider();
      mutationValue(await clientM3B.mutate('login', bobCredentials), 'client M3 B login');
      const clientBM3Messages = readyStream<Message[]>(
        clientM3B,
        'listMessages',
        { chatId: dm.chatId },
      );
      subscriptions.add(clientBM3Messages);
      await clientBM3Messages.next(() => true);

      // LLP 0034 D5 + LLP 0266 D4: recipient B arms one stream and performs
      // no query/refetch/poll. A's send and B's receipt mutation both arrive
      // through the same listMessages stream.
      const m3Body = `M3 two-client live ${Date.now()}`;
      const sentMessageDelivery = clientBM3Messages.nextFuture((rows) => (
        rows.some((row) => row.body === m3Body && row.status === 'sent')
      ));
      const sentMessage = mutationValue<{ id: string }>(
        await clientA.mutate('sendMessage', {
          chatId: dm.chatId,
          body: m3Body,
          quotedMessageId: null,
        }),
        'client A sendMessage',
      );
      expect((await sentMessageDelivery).find((row) => row.id === sentMessage.id))
        .toMatchObject({ mine: false, status: 'sent', recipientCount: 1 });
      const readMessageDelivery = clientBM3Messages.nextFuture((rows) => (
        rows.some((row) => row.id === sentMessage.id && row.status === 'read')
      ));
      mutationValue(
        await clientM3B.mutate('markReceipt', { chatId: dm.chatId, state: 'read' }),
        'client B markReceipt',
      );
      expect((await readMessageDelivery).find((row) => row.id === sentMessage.id))
        .toMatchObject({ status: 'read', deliveredCount: 1, readCount: 1 });
      process.stdout.write(
        'COTERIE_SNAPBACK_M3_TWO_CLIENT_MESSAGE clientB listMessages observed clientA send + receipt transition; polling=disabled\n',
      );

      clientBM3Messages.dispose();
      subscriptions.delete(clientBM3Messages);
      const pagedMessageIds: string[] = [];
      for (let index = 0; index < 55; index += 1) {
        pagedMessageIds.push(mutationValue<{ id: string }>(
          await clientA.mutate('sendMessage', {
            chatId: dm.chatId,
            body: `Full-history page probe ${index + 1}`,
            quotedMessageId: null,
          }),
          `full-history message ${index + 1}`,
        ).id);
      }
      const fullHistoryMessages = readyStream<Message[]>(
        clientM3B,
        'listMessages',
        { chatId: dm.chatId },
      );
      subscriptions.add(fullHistoryMessages);
      const materializedMessages = await fullHistoryMessages.next((rows) => (
        pagedMessageIds.every((id) => rows.some((row) => row.id === id))
      ), 60_000);
      expect(materializedMessages.length).toBeGreaterThan(50);
      fullHistoryMessages.dispose();
      subscriptions.delete(fullHistoryMessages);

      const liveTailMessageIds = [...pagedMessageIds];
      for (let index = pagedMessageIds.length; index < 905; index += 1) {
        liveTailMessageIds.push(mutationValue<{ id: string }>(
          await clientA.mutate('sendMessage', {
            chatId: dm.chatId,
            body: `Full-live-window tail probe ${index + 1}`,
            quotedMessageId: null,
          }),
          `full-live-window message ${index + 1}`,
        ).id);
      }
      const fullLiveMessageWindow = readyStream<Message[]>(
        clientA,
        'listMessages',
        { chatId: dm.chatId },
      );
      subscriptions.add(fullLiveMessageWindow);
      const liveMessageRows = await fullLiveMessageWindow.next((rows) => (
        liveTailMessageIds.every((id) => rows.some((row) => row.id === id))
      ), 120_000);
      expect(liveMessageRows.length).toBeGreaterThan(900);
      expect(liveMessageRows.find((row) => row.id === liveTailMessageIds[0])?.status).toBe('sent');
      const unreadBeforeBulkRead = readyStream<Chat[]>(clientM3B, 'listChats');
      subscriptions.add(unreadBeforeBulkRead);
      expect(
        (await unreadBeforeBulkRead.next((rows) => (
          (rows.find((chat) => chat.id === dm.chatId)?.unreadCount ?? 0) >= 905
        ), 120_000)).find((chat) => chat.id === dm.chatId)?.unreadCount,
      ).toBeGreaterThanOrEqual(905);
      const oldTailReceiptDelivery = fullLiveMessageWindow.nextFuture((rows) => (
        rows.some((row) => row.id === liveTailMessageIds[0] && row.status === 'read')
      ), 120_000);
      const unreadClearedDelivery = unreadBeforeBulkRead.nextFuture((rows) => (
        rows.find((chat) => chat.id === dm.chatId)?.unreadCount === 0
      ), 120_000);
      mutationValue(
        await clientM3B.mutate('markReceipt', { chatId: dm.chatId, state: 'read' }),
        'atomic full-history markReceipt',
      );
      expect((await oldTailReceiptDelivery).find((row) => (
        row.id === liveTailMessageIds[0]
      ))?.status).toBe('read');
      expect((await unreadClearedDelivery).find((chat) => chat.id === dm.chatId)?.unreadCount)
        .toBe(0);
      process.stdout.write(
        'COTERIE_SNAPBACK_M3_LIVE_MESSAGE_TAIL alice observed bob receipt change on a 900+-message old row; alice_action_after_waiter=none polling=disabled\n',
      );
      fullLiveMessageWindow.dispose();
      subscriptions.delete(fullLiveMessageWindow);
      unreadBeforeBulkRead.dispose();
      subscriptions.delete(unreadBeforeBulkRead);

      const pagedChatIds: string[] = [];
      for (let index = 0; index < 201; index += 1) {
        pagedChatIds.push(mutationValue<{ chatId: string }>(
          await clientA.mutate('createGroup', {
            name: `Full-history group ${index + 1}`,
            description: null,
            memberIds: ['alice', 'bob'],
          }),
          `full-history group ${index + 1}`,
        ).chatId);
      }

      const clientAM3Chats = readyStream<Chat[]>(clientA, 'listChats');
      subscriptions.add(clientAM3Chats);
      const materializedChats = await clientAM3Chats.next((rows) => (
        pagedChatIds.every((id) => rows.some((chat) => chat.id === id))
      ), 60_000);
      expect(materializedChats.length).toBeGreaterThan(200);
      const clientBM3Chats = readyStream<Chat[]>(clientM3B, 'listChats');
      subscriptions.add(clientBM3Chats);
      await clientBM3Chats.next((rows) => rows.some((chat) => (
        chat.id === pagedChatIds[0] && chat.currentUserIsMember
      )), 120_000);
      const oldTailMembershipDelivery = clientBM3Chats.nextFuture((rows) => rows.some((chat) => (
        chat.id === pagedChatIds[0] && !chat.currentUserIsMember
      )), 120_000);
      mutationValue(
        await clientA.mutate('removeMember', {
          chatId: pagedChatIds[0],
          userId: 'bob',
        }),
        'live old-chat-tail removeMember',
      );
      expect((await oldTailMembershipDelivery).find((chat) => (
        chat.id === pagedChatIds[0]
      ))?.currentUserIsMember).toBe(false);
      process.stdout.write(
        'COTERIE_SNAPBACK_M3_LIVE_CHAT_TAIL bob observed alice membership change on the oldest of 201 new chats; bob_action_after_waiter=none polling=disabled\n',
      );
      clientBM3Chats.dispose();
      subscriptions.delete(clientBM3Chats);
      const mappedGroup = mutationValue<{ chatId: string }>(
        await clientA.mutate('createGroup', {
          name: 'Adapter operation matrix',
          description: 'Exercises add, promote, remove, and leave mappings.',
          memberIds: ['alice', 'bob'],
        }),
        'createGroup operation matrix',
      );
      expect(await clientA.mutate('createGroup', {
        name: 'Duplicate members are invalid',
        description: null,
        memberIds: ['alice', 'bob', 'bob'],
      })).toMatchObject({
        ok: false,
        error: { name: 'GroupMembersInvalidError' },
      });
      expect(await clientA.mutate('createGroup', {
        name: 'Creator is required',
        description: null,
        memberIds: ['bob', 'carol'],
      })).toMatchObject({
        ok: false,
        error: { name: 'GroupMembersInvalidError' },
      });
      await clientAM3Chats.next((rows) => rows.some((chat) => (
        chat.id === mappedGroup.chatId && chat.memberIds.includes('bob')
      )));
      mutationValue(
        await clientA.mutate('addMember', { chatId: mappedGroup.chatId, userId: 'carol' }),
        'addMember operation matrix',
      );
      expect(await clientA.mutate('addMember', {
        chatId: mappedGroup.chatId,
        userId: 'carol',
      })).toMatchObject({
        ok: false,
        error: { name: 'ChatMemberAlreadyExistsError' },
      });
      await clientAM3Chats.next((rows) => rows.some((chat) => (
        chat.id === mappedGroup.chatId && chat.memberIds.includes('carol')
      )));
      mutationValue(
        await clientA.mutate('promoteAdmin', { chatId: mappedGroup.chatId, userId: 'bob' }),
        'promoteAdmin operation matrix',
      );
      mutationValue(
        await clientM3B.mutate('removeMember', {
          chatId: mappedGroup.chatId,
          userId: 'carol',
        }),
        'removeMember operation matrix',
      );
      await clientAM3Chats.next((rows) => rows.some((chat) => (
        chat.id === mappedGroup.chatId && !chat.memberIds.includes('carol')
      )));
      mutationValue(
        await clientM3B.mutate('leaveChat', { chatId: mappedGroup.chatId }),
        'leaveChat operation matrix',
      );
      await clientAM3Chats.next((rows) => rows.some((chat) => (
        chat.id === mappedGroup.chatId && !chat.memberIds.includes('bob')
      )));

      for (const operation of ['removeMember', 'promoteAdmin'] as const) {
        expect(await clientA.mutate(operation, {
          chatId: mappedGroup.chatId,
          userId: 'profile-that-does-not-exist',
        })).toMatchObject({
          ok: false,
          error: { name: 'ChatMemberNotFoundError' },
        });
      }

      const adminlessGroup = mutationValue<{ chatId: string }>(
        await clientA.mutate('createGroup', {
          name: 'Admin-less adapter parity',
          description: null,
          memberIds: ['alice', 'bob'],
        }),
        'create admin-less parity group',
      );
      mutationValue(
        await clientA.mutate('leaveChat', { chatId: adminlessGroup.chatId }),
        'sole admin leave',
      );
      await clientAM3Chats.next((rows) => (
        rows.find((chat) => chat.id === adminlessGroup.chatId)?.currentUserIsMember === false
      ));

      const missingChatId = '00000000-0000-7000-8000-000000000000';
      const missingChatMutations = [
        ['addMember', { chatId: missingChatId, userId: 'bob' }],
        ['removeMember', { chatId: missingChatId, userId: 'bob' }],
        ['promoteAdmin', { chatId: missingChatId, userId: 'bob' }],
        ['leaveChat', { chatId: missingChatId }],
        ['sendMessage', { chatId: missingChatId, body: 'Missing chat.', quotedMessageId: null }],
        ['markReceipt', { chatId: missingChatId, state: 'read' }],
      ] as const;
      for (const [operation, args] of missingChatMutations) {
        expect(await clientA.mutate(operation, args)).toMatchObject({
          ok: false,
          error: { name: 'ChatNotFoundError' },
        });
      }
      const missingChatMessages = readyStream<Message[]>(
        clientA,
        'listMessages',
        { chatId: missingChatId },
      );
      subscriptions.add(missingChatMessages);
      expect(await missingChatMessages.nextCell((cell) => cell.status === 'error')).toMatchObject({
        status: 'error',
        error: { name: 'ChatNotFoundError' },
      });

      const switchingClient = provider();
      const switchingSession = readyStream<Array<{ userId: string }>>(
        switchingClient,
        'listSession',
      );
      subscriptions.add(switchingSession);
      await switchingSession.next((rows) => rows.length === 0);
      mutationValue(await switchingClient.mutate('login', aliceCredentials), 'switch login Alice');
      await switchingSession.next((rows) => rows[0]?.userId === 'alice');
      mutationValue(await switchingClient.mutate('login', bobCredentials), 'switch login Bob');
      await switchingSession.next((rows) => rows[0]?.userId === 'bob');

      // This feed subscription deliberately has no accompanying listProfiles
      // subscription. Its identity index is therefore the pre-signup snapshot.
      const identityOnlyClient = provider();
      await loginAlice(identityOnlyClient);
      const identityOnlyFeed = readyStream<FeedItem[]>(
        identityOnlyClient,
        'listFeed',
        { mode: 'global', cursor: null },
      );
      subscriptions.add(identityOnlyFeed);
      await identityOnlyFeed.next(() => true);

      // LLP 0034 D5 + LLP 0266 D4: after B's stream and waiters are armed,
      // B performs no polling, refetch, mutation, or other action. A creates
      // a post and then likes it; both committed states arrive by server push.
      const liveBody = `M2 two-client live ${Date.now()}`;
      const createdDelivery = clientBFeed.nextFuture((rows) => (
        rows.some((row) => row.body === liveBody)
      ));
      const livePost = mutationValue<{ id: string }>(
        await clientA.mutate('createPost', {
          body: liveBody,
          imageRefs: [],
          videoRefs: [],
          parentId: null,
        }),
        'client A createPost',
      );
      expect((await createdDelivery).find((row) => row.postId === livePost.id)?.body).toBe(liveBody);
      const likedDelivery = clientBFeed.nextFuture((rows) => (
        rows.some((row) => row.postId === livePost.id && row.likeCount === 1)
      ));
      mutationValue(
        await clientA.mutate('setLike', {
          postId: livePost.id,
          liked: true,
          mutationId: `m2-live-like-${Date.now()}`,
        }),
        'client A setLike',
      );
      const likedRows = await likedDelivery;
      expect(likedRows.find((row) => row.postId === livePost.id)).toMatchObject({
        likeCount: 1,
        likedByMe: true,
      });
      process.stdout.write(
        'COTERIE_SNAPBACK_M2_TWO_CLIENT_LIVE clientB observed clientA createPost + likeCount push; polling=disabled\n',
      );

      // LLP 0266 D4: B observes a server push caused by A. B performs no
      // mutation, refresh, refetch, timer poll, or other action after this
      // waiter is armed.
      const twoClientName = `Alice Two Client ${Date.now()}`;
      const observedByB = clientBProfiles.next((rows) => (
        rows.some((row) => row.id === 'alice' && row.displayName === twoClientName)
      ));
      mutationValue(
        await clientA.mutate('editProfile', {
          displayName: twoClientName,
          bio: 'Written by adapter A and pushed to independent adapter B.',
          handle: null,
          location: null,
          link: null,
        }),
        'client A editProfile',
      );
      const twoClientRows = await observedByB;
      expect(twoClientRows.find((row) => row.id === 'alice')?.displayName).toBe(twoClientName);

      const beforeDave = clientBProfiles.rows.at(-1)?.find((row) => row.id === 'dave');
      if (!beforeDave) throw new Error('M2 fixture profile dave is missing');
      const clearedDelivery = beforeDave.followedByMe
        ? clientBProfiles.nextFuture((rows) => (
            rows.some((row) => row.id === 'dave' && !row.followedByMe)
          ))
        : null;
      mutationValue(
        await clientA.mutate('setFollow', {
          userId: 'dave',
          following: false,
          mutationId: 'integration-follow-clear',
        }),
        'setFollow clear precondition',
      );
      const clearedRows = clearedDelivery
        ? await clearedDelivery
        : clientBProfiles.rows.at(-1)!;
      const clearedDave = clearedRows.find((row) => row.id === 'dave');
      const clearedAlice = clearedRows.find((row) => row.id === 'alice');
      if (!clearedDave || !clearedAlice) throw new Error('cleared follow projection is incomplete');
      const followDelivery = clientBProfiles.nextFuture((rows) => (
        rows.some((row) => (
          row.id === 'dave'
          && row.followedByMe
          && row.followers === clearedDave.followers + 1
        ))
        && rows.some((row) => (
          row.id === 'alice'
          && row.following === clearedAlice.following + 1
        ))
      ));
      mutationValue(
        await clientA.mutate('setFollow', {
          userId: 'dave',
          following: true,
          mutationId: 'integration-follow-set',
        }),
        'setFollow set',
      );
      const followedRows = await followDelivery;
      const followedDave = followedRows.find((row) => row.id === 'dave');
      expect(followedDave?.followers).toBe(clearedDave.followers + 1);
      expect(followedRows.find((row) => row.id === 'alice')?.following)
        .toBe(clearedAlice.following + 1);

      let updateSequence = 0;
      const fixture: DataProviderConformanceFixture = {
        name: 'coterie-snapback-m1',
        capabilities: coterieSurfaceManifest.capabilities,
        createProvider: () => clientB,
        primaryQuery: {
          name: 'listProfiles',
          initial: { status: 'ready', empty: false },
          async applySubscriptionUpdate() {
            updateSequence += 1;
            const displayName = `Alice Conformance ${updateSequence}`;
            const delivery = clientBProfiles.next((rows) => (
              rows.some((row) => row.id === 'alice' && row.displayName === displayName)
            ));
            mutationValue(
              await clientA.mutate('editProfile', {
                displayName,
                bio: `Conformance live update ${updateSequence}`,
                handle: null,
                location: null,
                link: null,
              }),
              'conformance subscription update',
            );
            await delivery;
          },
          afterSubscriptionUpdate: { status: 'ready', empty: false },
        },
        mutation: {
          name: 'editProfile',
          args: {
            displayName: 'Alice Conformance Mutation',
            bio: 'Mutation-driven invalidation through the Snapback adapter.',
            handle: null,
            location: null,
            link: null,
          },
          expectedResult: { ok: true },
          afterMutation: { status: 'ready', empty: false },
        },
      };
      const m1Conformance = await assertDataProviderConformance(fixture);
      expect(m1Conformance.ok).toBe(true);
      expect(m1Conformance.checks.find((check) => check.id === 'headless-boot')?.status).toBe('pass');
      expect(m1Conformance.checks.find((check) => check.id === 'initial-snapshot')?.status).toBe('pass');
      expect(m1Conformance.checks.find((check) => check.id === 'subscription-update')?.status).toBe('pass');
      expect(m1Conformance.checks.find((check) => check.id === 'subscription-disposal')?.status).toBe('pass');

      let m2ConformanceSequence = 0;
      const m2Fixture: DataProviderConformanceFixture = {
        name: 'coterie-snapback-m2',
        capabilities: coterieSurfaceManifest.capabilities,
        createProvider: () => clientB,
        primaryQuery: {
          name: 'listFeed',
          args: { mode: 'global', cursor: null },
          initial: { status: 'ready', empty: false },
          async applySubscriptionUpdate() {
            const body = `M2 conformance push ${++m2ConformanceSequence}`;
            const delivery = clientBFeed.nextFuture((rows) => (
              rows.some((row) => row.body === body)
            ));
            mutationValue(
              await clientA.mutate('createPost', {
                body,
                imageRefs: [],
                videoRefs: [],
                parentId: null,
              }),
              'M2 conformance subscription update',
            );
            await delivery;
          },
          afterSubscriptionUpdate: { status: 'ready', empty: false },
        },
        mutation: {
          name: 'createPost',
          args: {
            body: 'M2 conformance mutation',
            imageRefs: [],
            videoRefs: [],
            parentId: null,
          },
          expectedResult: { ok: true },
          afterMutation: { status: 'ready', empty: false },
        },
        failedMutation: {
          name: 'createPost',
          args: { body: '', imageRefs: [], videoRefs: [], parentId: null },
          errorMessageIncludes: 'text-only posts cannot be empty',
        },
      };
      const m2Conformance = await assertDataProviderConformance(m2Fixture);
      expect(m2Conformance.ok).toBe(true);

      const clientAM3Messages = readyStream<Message[]>(
        clientB,
        'listMessages',
        { chatId: dm.chatId },
      );
      subscriptions.add(clientAM3Messages);
      await clientAM3Messages.next(() => true);
      let m3ConformanceSequence = 0;
      const m3Fixture: DataProviderConformanceFixture = {
        name: 'coterie-snapback-m3-minus-typing',
        capabilities: coterieSurfaceManifest.capabilities,
        createProvider: () => clientB,
        primaryQuery: {
          name: 'listMessages',
          args: { chatId: dm.chatId },
          initial: { status: 'ready', empty: false },
          async applySubscriptionUpdate() {
            const body = `M3 conformance push ${++m3ConformanceSequence}`;
            const delivery = clientAM3Messages.nextFuture((rows) => (
              rows.some((row) => row.body === body)
            ));
            mutationValue(
              await clientA.mutate('sendMessage', {
                chatId: dm.chatId,
                body,
                quotedMessageId: null,
              }),
              'M3 conformance subscription update',
            );
            await delivery;
          },
          afterSubscriptionUpdate: { status: 'ready', empty: false },
        },
        mutation: {
          name: 'sendMessage',
          args: {
            chatId: dm.chatId,
            body: 'M3 conformance mutation',
            quotedMessageId: null,
          },
          expectedResult: { ok: true },
          afterMutation: { status: 'ready', empty: false },
        },
        failedMutation: {
          name: 'sendMessage',
          args: { chatId: dm.chatId, body: '', quotedMessageId: null },
          errorMessageIncludes: '1-2000 characters',
        },
      };
      const m3Conformance = await assertDataProviderConformance(m3Fixture);
      expect(m3Conformance.ok).toBe(true);
      process.stdout.write(
        'COTERIE_SNAPBACK_CONFORMANCE_SCOPE claimed allow-list=M1+M2+M3-minus-typing; '
          + 'formal probes=M1 listProfiles@3+editProfile@1, M2 listFeed@3+createPost@1, '
          + 'M3 listMessages@4+sendMessage@4; '
          + `M1 ${m1Conformance.checks.filter((check) => check.status === 'pass').length} pass/`
          + `${m1Conformance.checks.filter((check) => check.status === 'skip').length} skip; `
          + `M2 ${m2Conformance.checks.filter((check) => check.status === 'pass').length} pass/`
          + `${m2Conformance.checks.filter((check) => check.status === 'skip').length} skip; `
          + `M3 ${m3Conformance.checks.filter((check) => check.status === 'pass').length} pass/`
          + `${m3Conformance.checks.filter((check) => check.status === 'skip').length} skip; `
          + 'suite has no milestone selector\n',
      );

      const alicePosts = readyStream<Array<{ postId: string; authorId: string }>>(
        clientB,
        'listProfilePosts',
        { userId: 'alice' },
      );
      subscriptions.add(alicePosts);
      expect(await alicePosts.next((rows) => rows.some((row) => row.postId === livePost.id)))
        .toContainEqual(expect.objectContaining({ postId: livePost.id, authorId: 'alice' }));

      const thread = readyStream<Array<{
        postId: string;
        parentId: string | null;
        threadRole: string;
      }>>(clientB, 'listThread', { parentId: livePost.id });
      subscriptions.add(thread);
      await thread.next((rows) => rows[0]?.postId === livePost.id);
      const reply = mutationValue<{ id: string }>(
        await clientA.mutate('createPost', {
          body: 'M2 integration direct reply',
          imageRefs: [],
          videoRefs: [],
          parentId: livePost.id,
        }),
        'createPost reply',
      );
      expect(await thread.next((rows) => rows.some((row) => row.postId === reply.id)))
        .toContainEqual(expect.objectContaining({
          postId: reply.id,
          parentId: livePost.id,
          threadRole: 'direct-reply',
        }));
      expect(await clientA.mutate('setRepost', {
        postId: reply.id,
        reposted: true,
        mutationId: 'integration-reply-repost',
      })).toMatchObject({
        ok: false,
        error: { name: 'ReplyRepostForbiddenError' },
      });

      const repostDelivery = clientBFeed.nextFuture((rows) => rows.some((row) => (
        row.postId === livePost.id && row.repostedById === 'alice'
      )));
      mutationValue(
        await clientA.mutate('setRepost', {
          postId: livePost.id,
          reposted: true,
          mutationId: 'integration-repost-set',
        }),
        'setRepost set',
      );
      expect(await repostDelivery).toContainEqual(expect.objectContaining({
        postId: livePost.id,
        repostedById: 'alice',
      }));
      mutationValue(
        await clientA.mutate('setRepost', {
          postId: livePost.id,
          reposted: false,
          mutationId: 'integration-repost-clear',
        }),
        'setRepost clear',
      );

      const imageBytes = await (await fetch(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      )).arrayBuffer();
      const videoBytes = readFileSync(join(
        repoRoot,
        'benchmarks',
        'fixtures',
        'social-messenger',
        'media',
        'vid-01.mp4',
      ));
      const fetchBeforePostMedia = globalThis.fetch;
      try {
        globalThis.fetch = (async (input, init) => {
          const url = new URL(
            typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
          );
          if (url.pathname === '/assets/fixtures/img-01.png') {
            return new Response(imageBytes, {
              status: 200,
              headers: { 'content-type': 'image/png' },
            });
          }
          if (url.pathname === '/assets/fixtures/vid-01.mp4') {
            return new Response(new Uint8Array(videoBytes), {
              status: 200,
              headers: { 'content-type': 'video/mp4' },
            });
          }
          return fetchBeforePostMedia(input, init);
        }) as typeof fetch;
        const imagePost = mutationValue<{ id: string }>(
          await clientA.mutate('createPost', {
            body: 'M2 image upload through postImageUpload',
            imageRefs: ['media/img-01.png'],
            videoRefs: [],
            parentId: null,
          }),
          'createPost image',
        );
        const videoPost = mutationValue<{ id: string }>(
          await clientA.mutate('createPost', {
            body: 'M2 video upload through postVideoUpload',
            imageRefs: [],
            videoRefs: ['media/vid-01.mp4'],
            parentId: null,
          }),
          'createPost video',
        );
        const mediaRows = await clientBFeed.next((rows) => (
          rows.some((row) => (
            row.postId === imagePost.id && row.mediaKind === 'images' && row.mediaUrls.length === 1
          ))
          && rows.some((row) => (
            row.postId === videoPost.id && row.mediaKind === 'video' && row.mediaUrls.length === 1
          ))
        ));
        const imageRow = mediaRows.find((row) => row.postId === imagePost.id)!;
        const videoRow = mediaRows.find((row) => row.postId === videoPost.id)!;
        expect(imageRow.mediaUrls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/assets\/public\/[^/]+\/feed$/u);
        expect(videoRow.mediaUrls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/assets\/public\/[^/]+\/primary$/u);
        expect(imageRow.avatarUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/assets\/public\/[^/]+\/thumb$/u);
        for (const url of [imageRow.mediaUrls[0], videoRow.mediaUrls[0], imageRow.avatarUrl]) {
          const response = await fetch(url!);
          expect(response.ok).toBe(true);
        }
      } finally {
        globalThis.fetch = fetchBeforePostMedia;
      }

      const authClient = provider();
      const sessions = readyStream<Array<{ userId: string; token: string }>>(
        authClient,
        'listSession',
      );
      subscriptions.add(sessions);
      expect(await sessions.next((rows) => rows.length === 0)).toEqual([]);

      const wrongPassword = await authClient.mutate('login', {
        email: aliceCredentials.email,
        password: 'DefinitelyWrong!2026',
      });
      expect(wrongPassword).toMatchObject({
        ok: false,
        error: { name: 'InvalidCredentialsError' },
      });
      const malformedLogin = await authClient.mutate('login', {
        email: 'malformed-email',
        password: 'DoesNotMatter!2026',
      });
      expect(malformedLogin).toMatchObject({
        ok: false,
        error: { name: 'InvalidCredentialsError' },
      });
      const duplicateEmail = await authClient.mutate('signup', {
        email: aliceCredentials.email,
        password: 'UniquePassword!2026',
        handle: 'unique_adapter',
        displayName: 'Unique Adapter',
      });
      expect(duplicateEmail).toMatchObject({
        ok: false,
        error: { name: 'DuplicateEmailError' },
      });

      const duplicateHandleClient = provider();
      const duplicateHandle = await duplicateHandleClient.mutate('signup', {
        email: `duplicate-handle-${Date.now()}@example.test`,
        password: 'UniquePassword!2026',
        handle: 'alice',
        displayName: 'Duplicate Handle',
      });
      expect(duplicateHandle).toMatchObject({
        ok: false,
        error: { name: 'DuplicateHandleError' },
      });

      const failedLoginProjection = provider({
        __testHooks: {
          beforeAuthResult(operation) {
            if (operation === 'login') throw new Error('forced login projection failure');
          },
        },
      });
      const failedLoginSessions = readyStream<Array<{ userId: string }>>(
        failedLoginProjection,
        'listSession',
      );
      subscriptions.add(failedLoginSessions);
      expect(await failedLoginSessions.next((rows) => rows.length === 0)).toEqual([]);
      const failedLoginCleared = failedLoginSessions.nextFuture((rows) => rows.length === 0);
      expect(await failedLoginProjection.mutate('login', aliceCredentials)).toMatchObject({
        ok: false,
        error: {
          name: 'SnapbackProviderError',
          message: expect.stringContaining('forced login projection failure'),
        },
      });
      expect(await failedLoginCleared).toEqual([]);

      const uniqueSuffix = String(Date.now()).slice(-8);
      const spacedPassword = '  AdapterPassword!2026  ';
      const signupEmail = `adapter-${uniqueSuffix}@example.test`;
      const signup = mutationValue<{ userId: string; sessionToken: string }>(
        await authClient.mutate('signup', {
          email: signupEmail,
          password: spacedPassword,
          handle: `adapter${uniqueSuffix}`.slice(0, 20),
          displayName: 'Adapter Signup',
        }),
        'signup',
      );
      expect(signup.userId.length).toBeGreaterThan(0);
      expect((await sessions.next((rows) => rows[0]?.token === signup.sessionToken))[0]?.userId)
        .toBe(signup.userId);
      const authProfiles = readyStream<Profile[]>(authClient, 'listProfiles');
      subscriptions.add(authProfiles);
      const signedUpProfile = await authProfiles.next((rows) => (
        rows.some((row) => row.id === signup.userId)
      ));
      expect(signedUpProfile.find((row) => row.id === signup.userId)?.id).toBe(signup.userId);
      const signedUpSession = await sessions.next((rows) => rows[0]?.token === signup.sessionToken);
      expect(new Set([
        signup.userId,
        signedUpSession[0]?.userId,
        signedUpProfile.find((row) => row.id === signup.userId)?.id,
      ])).toEqual(new Set([signup.userId]));

      const identityBody = `M2 post-signup identity ${uniqueSuffix}`;
      const identityPostDelivery = identityOnlyFeed.nextFuture((rows) => (
        rows.some((row) => row.body === identityBody && row.authorId === signup.userId)
      ));
      const identityPost = mutationValue<{ id: string }>(
        await authClient.mutate('createPost', {
          body: identityBody,
          imageRefs: [],
          videoRefs: [],
          parentId: null,
        }),
        'post-signup createPost identity projection',
      );
      expect(await identityPostDelivery).toContainEqual(expect.objectContaining({
        postId: identityPost.id,
        authorId: signup.userId,
      }));
      const identityRepostDelivery = identityOnlyFeed.nextFuture((rows) => (
        rows.some((row) => row.postId === livePost.id && row.repostedById === signup.userId)
      ));
      mutationValue(
        await authClient.mutate('setRepost', {
          postId: livePost.id,
          reposted: true,
          mutationId: `post-signup-repost-${uniqueSuffix}`,
        }),
        'post-signup setRepost identity projection',
      );
      expect(await identityRepostDelivery).toContainEqual(expect.objectContaining({
        postId: livePost.id,
        repostedById: signup.userId,
      }));
      mutationValue(
        await authClient.mutate('setRepost', {
          postId: livePost.id,
          reposted: false,
          mutationId: `post-signup-unrepost-${uniqueSuffix}`,
        }),
        'post-signup setRepost cleanup',
      );

      const failedSignupEmail = `failed-signup-${uniqueSuffix}@example.test`;
      const failedSignupProjection = provider({
        __testHooks: {
          beforeAuthResult(operation) {
            if (operation === 'signup') throw new Error('forced signup projection failure');
          },
        },
      });
      const failedSignupSessions = readyStream<Array<{ userId: string }>>(
        failedSignupProjection,
        'listSession',
      );
      subscriptions.add(failedSignupSessions);
      expect(await failedSignupSessions.next((rows) => rows.length === 0)).toEqual([]);
      const failedSignupCleared = failedSignupSessions.nextFuture((rows) => rows.length === 0);
      expect(await failedSignupProjection.mutate('signup', {
        email: failedSignupEmail,
        password: 'FailedSignupPassword!2026',
        handle: `failed${uniqueSuffix}`.slice(0, 20),
        displayName: 'Failed Signup Projection',
      })).toMatchObject({
        ok: false,
        error: {
          name: 'SnapbackProviderError',
          message: expect.stringContaining('forced signup projection failure'),
        },
      });
      expect(await failedSignupCleared).toEqual([]);
      const failedSignupLogin = provider();
      mutationValue(
        await failedSignupLogin.mutate('login', {
          email: failedSignupEmail,
          password: 'FailedSignupPassword!2026',
        }),
        'login after failed signup projection',
      );

      let raceArrivals = 0;
      let releaseRace!: () => void;
      const raceGate = new Promise<void>((resolveRace) => { releaseRace = resolveRace; });
      const raceHook = async (operation: 'signup' | 'signup-recovery') => {
        if (operation !== 'signup') return;
        raceArrivals += 1;
        if (raceArrivals === 2) releaseRace();
        await raceGate;
      };
      const raceClientA = provider({ __testHooks: { beforeEnsureProfile: raceHook } });
      const raceClientB = provider({ __testHooks: { beforeEnsureProfile: raceHook } });
      const raceHandle = `race${uniqueSuffix}`.slice(0, 20);
      const raceAccounts = [
        {
          provider: raceClientA,
          email: `race-a-${uniqueSuffix}@example.test`,
          password: 'RacePasswordA!2026',
        },
        {
          provider: raceClientB,
          email: `race-b-${uniqueSuffix}@example.test`,
          password: 'RacePasswordB!2026',
        },
      ];
      const raceResults = await Promise.all(raceAccounts.map((account, index) => (
        account.provider.mutate('signup', {
          email: account.email,
          password: account.password,
          handle: raceHandle,
          displayName: `Race Account ${index}`,
        })
      )));
      expect(raceArrivals).toBe(2);
      expect(raceResults.filter((result) => result.ok)).toHaveLength(1);
      const partialIndex = raceResults.findIndex((result) => !result.ok);
      expect(partialIndex).toBeGreaterThanOrEqual(0);
      expect(raceResults[partialIndex]).toMatchObject({
        ok: false,
        error: {
          name: 'PartialRegistrationError',
          message: expect.stringContaining('email'),
        },
      });
      const partialAccount = raceAccounts[partialIndex]!;
      const recoveredLogin = mutationValue<{ userId: string; sessionToken: string }>(
        await partialAccount.provider.mutate('login', {
          email: partialAccount.email,
          password: partialAccount.password,
        }),
        'partial registration login',
      );
      const recoveredSignup = mutationValue<{ userId: string; sessionToken: string }>(
        await partialAccount.provider.mutate('signup', {
          email: partialAccount.email,
          password: partialAccount.password,
          handle: `recovered${uniqueSuffix}`.slice(0, 20),
          displayName: 'Recovered Registration',
        }),
        'partial registration profile completion',
      );
      expect(recoveredSignup.userId).toBe(recoveredLogin.userId);

      const onePixelPng =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      const avatarRef = 'media/avatar-alice.png';
      const avatarBytes = await (await fetch(onePixelPng)).arrayBuffer();
      const fetchBeforeAvatarFixtures = globalThis.fetch;
      globalThis.fetch = (async (input, init) => {
        const url = new URL(
          typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
        );
        if (url.pathname === '/assets/fixtures/avatar-alice.png') {
          return new Response(avatarBytes, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          });
        }
        return fetchBeforeAvatarFixtures(input, init);
      }) as typeof fetch;
      const avatarSelections: Array<{
        assetId: string;
        reused: boolean;
        sourceDigest: string;
      }> = [];
      let refuseFirstAvatarAttach = true;
      const avatarClient = provider({
        __testHooks: {
          beforeAvatarAttach() {
            if (!refuseFirstAvatarAttach) return;
            refuseFirstAvatarAttach = false;
            const error = new Error('forced attach storage refusal') as Error & {
              code: string;
              diagnostic: { code: string };
            };
            error.code = 'SNAPBACK_ASSET_STORE_UNAVAILABLE';
            error.diagnostic = { code: error.code };
            throw error;
          },
          onAvatarAssetSelected(facts) {
            avatarSelections.push(facts);
          },
        },
      });
      await loginAlice(avatarClient);
      expect(await avatarClient.mutate('setAvatar', { avatarRef })).toMatchObject({
        ok: false,
        error: {
          name: 'SnapbackProviderError',
          message: expect.stringContaining('retained its digest mapping for retry'),
        },
      });
      mutationValue(
        await avatarClient.mutate('setAvatar', { avatarRef }),
        'setAvatar digest retry',
      );
      expect(avatarSelections).toHaveLength(2);
      expect(avatarSelections[0]).toMatchObject({ reused: false });
      expect(avatarSelections[1]).toMatchObject({
        assetId: avatarSelections[0]?.assetId,
        sourceDigest: avatarSelections[0]?.sourceDigest,
        reused: true,
      });
      expect(await avatarClient.mutate('setAvatar', {
        avatarRef: 'data:text/plain;base64,bm90IGFuIGltYWdl',
      })).toMatchObject({
        ok: false,
        error: { name: 'AvatarReferenceInvalidError' },
      });

      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async (input, init) => {
          const url = new URL(
            typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
          );
          if (url.href === 'https://avatar.test/truncated') {
            return {
              ok: true,
              status: 200,
              blob: async () => ({
                arrayBuffer: async () => { throw new Error('truncated response body'); },
              }),
            } as unknown as Response;
          }
          return originalFetch(input, init);
        }) as typeof fetch;
        expect(await avatarClient.mutate('setAvatar', {
          avatarRef: 'https://avatar.test/truncated',
        })).toMatchObject({
          ok: false,
          error: { name: 'AvatarReferenceInvalidError' },
        });
      } finally {
        globalThis.fetch = originalFetch;
      }

      const avatar = mutationValue<{ avatarUrl: string }>(
        await authClient.mutate('setAvatar', { avatarRef }),
        'setAvatar',
      );
      expect(avatar.avatarUrl.startsWith(`${server.baseUrl}/assets/public/`)).toBe(true);
      globalThis.fetch = fetchBeforeAvatarFixtures;

      const slowStreamClient = provider({
        __testHooks: {
          profileDeliveryTimeoutMs: 50,
          suppressProfileUpdate: () => true,
        },
      });
      await loginAlice(slowStreamClient);
      const slowProfiles = readyStream<Profile[]>(slowStreamClient, 'listProfiles');
      subscriptions.add(slowProfiles);
      await slowProfiles.next((rows) => rows.some((row) => row.id === 'alice'));
      expect(await slowStreamClient.mutate('editProfile', {
        displayName: `Suppressed Stream ${uniqueSuffix}`,
        bio: 'The write commits, but the adapter must not claim local stream delivery.',
        handle: null,
        location: null,
        link: null,
      })).toMatchObject({
        ok: false,
        error: {
          name: 'SnapbackProviderError',
          message: expect.stringContaining('did not deliver the committed mutation'),
        },
      });

      const successfulLogoutCleared = sessions.nextFuture((rows) => rows.length === 0);
      const logout = mutationValue<{ revokedToken: string | null }>(
        await authClient.mutate('logout', {}),
        'logout',
      );
      expect(logout.revokedToken).toBe(signup.sessionToken);
      expect(await successfulLogoutCleared).toEqual([]);

      const spacedLogin = mutationValue<{ userId: string; sessionToken: string }>(
        await authClient.mutate('login', { email: signupEmail, password: spacedPassword }),
        'login preserving leading and trailing password spaces',
      );
      expect(spacedLogin.userId).toBe(signup.userId);

      const fetchBeforeLogoutCuts = globalThis.fetch;
      try {
        globalThis.fetch = (async (input, init) => {
          const url = new URL(
            typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
          );
          if (url.pathname === '/auth/logout') {
            throw new Error('forced logout transport failure before request');
          }
          return fetchBeforeLogoutCuts(input, init);
        }) as typeof fetch;
        const transportFailureCleared = sessions.nextFuture((rows) => rows.length === 0);
        const transportFailure = await authClient.mutate('logout', {});
        expect(transportFailure).toMatchObject({
          ok: false,
          error: {
            name: 'SnapbackProviderError',
            message: expect.stringContaining('forced logout transport failure'),
          },
        });
        expect('value' in transportFailure).toBe(false);
        expect(await transportFailureCleared).toEqual([]);
      } finally {
        globalThis.fetch = fetchBeforeLogoutCuts;
      }

      const reloginAfterTransportFailure = mutationValue<{
        userId: string;
        sessionToken: string;
      }>(
        await authClient.mutate('login', { email: signupEmail, password: spacedPassword }),
        'login after locally terminal logout transport failure',
      );
      expect(reloginAfterTransportFailure.userId).toBe(signup.userId);

      let revokedResponseStatus: number | null = null;
      try {
        globalThis.fetch = (async (input, init) => {
          const url = new URL(
            typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
          );
          const response = await fetchBeforeLogoutCuts(input, init);
          if (url.pathname === '/auth/logout') {
            revokedResponseStatus = response.status;
            throw new Error('forced logout response loss after server revocation');
          }
          return response;
        }) as typeof fetch;
        const responseLossCleared = sessions.nextFuture((rows) => rows.length === 0);
        const responseLoss = await authClient.mutate('logout', {});
        expect(responseLoss).toMatchObject({
          ok: false,
          error: {
            name: 'SnapbackProviderError',
            message: expect.stringContaining('forced logout response loss'),
          },
        });
        expect('value' in responseLoss).toBe(false);
        expect(await responseLossCleared).toEqual([]);
      } finally {
        globalThis.fetch = fetchBeforeLogoutCuts;
      }
      expect(revokedResponseStatus).toBe(204);

      const connectionLost = clientBProfiles.nextFutureCell((cell) => (
        cell.status === 'ready'
        && (cell.connection === 'stale' || cell.connection === 'disconnected')
      ));
      const restartPort = Number(new URL(server.baseUrl).port);
      await server.stop();
      const lostCell = await connectionLost;
      expect(lostCell).toMatchObject({
        status: 'ready',
        connection: expect.stringMatching(/^(stale|disconnected)$/u),
      });
      const connectionRecovered = clientBProfiles.nextFutureCell((cell) => (
        cell.status === 'ready' && cell.connection === 'live'
      ));
      server = await startServer({
        port: restartPort,
        bindPortExactly: true,
        db: database,
        cwd: repoRoot,
        startupArtifacts: carrier,
        serverBinary: stagedRuntime,
      });
      const recoveredCell = await connectionRecovered;
      expect(recoveredCell).toMatchObject({
        status: 'ready',
        connection: 'live',
      });

      let refusedQuery: DataCellV2<unknown> | null = null;
      const refusedSubscription: DataSubscription = authClient.subscribe(
        'observeTyping',
        { chatId: dm.chatId },
        (cell) => { refusedQuery = cell; },
      );
      refusedSubscription.dispose();
      expect(refusedQuery).toMatchObject({
        status: 'error',
        error: {
          name: 'SnapbackTypingPermissionBackingUnavailableError',
          message: 'snapback provider deliberately does not claim observeTyping; membership-backed ephemeral permission lowering is required — issues/20260817-ephemeral-membership-permission-backing.md',
        },
      });
      expect(await authClient.mutate('setTyping', { chatId: dm.chatId, active: true }))
        .toMatchObject({
        ok: false,
        error: {
          name: 'SnapbackTypingPermissionBackingUnavailableError',
          message: 'snapback provider deliberately does not claim setTyping; membership-backed ephemeral permission lowering is required — issues/20260817-ephemeral-membership-permission-backing.md',
        },
        });
      expect(await authClient.mutate('setMessageReaction', {
        chatId: dm.chatId,
        messageId: sentMessage.id,
        emoji: '👍',
        reacted: true,
        mutationId: 'unavailable-backend-reaction',
      })).toMatchObject({
        ok: false,
        error: {
          name: 'SnapbackMilestoneUnsupportedError',
          message: 'snapback provider claims M1+M2+M3-minus-typing plus provider discovery only; setMessageReaction is outside that claim — LLP 0266 D7 (M4)',
        },
        });
    } finally {
      for (const subscription of subscriptions) subscription.dispose();
      await Promise.allSettled([...providers].map((value) => value.close()));
      await server?.stop();
      rmSync(scratch, { recursive: true, force: true });
    }
  },
  900_000,
);
