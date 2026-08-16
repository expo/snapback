import { expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
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
import { installM1Fixtures } from '../snapback/seed-m1.mjs';
import { coterieSurfaceManifest } from '../src/data/memory-provider.ts';
import { createCoterieSnapbackProvider } from '../src/data/snapback-provider.ts';

const integrationTest = process.env.COTERIE_SNAPBACK_INTEGRATION === '1'
  ? test
  : test.skip;
const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY
    ?? '/Users/ccheever/projects/snapback/target/debug/snapback',
);
const aliceCredentials = {
  email: 'alice@example.com',
  password: 'Alice!Clique2026',
};

type Profile = {
  id: string;
  displayName: string;
  bio: string;
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
  'Snapback adapter passes M1 conformance, fault cuts, and stream recovery',
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
      await installM1Fixtures({ baseUrl: server.baseUrl, runId: 'provider-integration' });

      const clientA = provider();
      const clientB = provider();
      await Promise.all([loginAlice(clientA), loginAlice(clientB)]);
      const clientBProfiles = readyStream<Profile[]>(clientB, 'listProfiles');
      subscriptions.add(clientBProfiles);
      await clientBProfiles.next((rows) => rows.some((row) => row.id === 'alice'));

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
      const conformance = await assertDataProviderConformance(fixture);
      expect(conformance.ok).toBe(true);
      expect(conformance.checks.find((check) => check.id === 'headless-boot')?.status).toBe('pass');
      expect(conformance.checks.find((check) => check.id === 'initial-snapshot')?.status).toBe('pass');
      expect(conformance.checks.find((check) => check.id === 'subscription-update')?.status).toBe('pass');
      expect(conformance.checks.find((check) => check.id === 'subscription-disposal')?.status).toBe('pass');
      process.stdout.write(
        `COTERIE_SNAPBACK_CONFORMANCE_SCOPE M1 listProfiles@2 + editProfile@1; `
          + `${conformance.checks.filter((check) => check.status === 'pass').length} pass, `
          + `${conformance.checks.filter((check) => check.status === 'skip').length} honest skip\n`,
      );

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
        'listFeed',
        { mode: 'global' },
        (cell) => { refusedQuery = cell; },
      );
      refusedSubscription.dispose();
      expect(refusedQuery).toMatchObject({
        status: 'error',
        error: {
          name: 'SnapbackMilestoneUnsupportedError',
          message: 'snapback provider claims M1 plus provider discovery only; listFeed arrives with M2/M3/M4/M5 — LLP 0266 D7 (M2)',
        },
      });
      expect(await authClient.mutate('createPost', { body: 'not yet' })).toMatchObject({
        ok: false,
        error: {
          name: 'SnapbackMilestoneUnsupportedError',
          message: 'snapback provider claims M1 plus provider discovery only; createPost arrives with M2/M3/M4/M5 — LLP 0266 D7 (M2)',
        },
      });
    } finally {
      for (const subscription of subscriptions) subscription.dispose();
      await Promise.allSettled([...providers].map((value) => value.close()));
      await server?.stop();
      rmSync(scratch, { recursive: true, force: true });
    }
  },
  300_000,
);
