#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { aggregateChoreography } from '../../../benchmarks/tools/social-messenger/choreography/choreography.mjs';
import {
  editProfile,
  listProfiles,
  listSession,
  login,
  logout,
} from '../src/data/generated/coterie.bindings.ts';
import { bootCoterieProvider } from '../src/data/provider-factory.ts';
import { resolveCoterieSnapbackUrl } from '../src/data/snapback-provider.ts';
import { installM1Fixtures } from '../snapback/seed-m1.mjs';

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

async function loadAuthorities() {
  const [contractSource, personasSource] = await Promise.all([
    readFile(CONTRACT_PATH, 'utf8'),
    readFile(PERSONAS_PATH, 'utf8'),
  ]);
  const contractIds = new Set(
    [...contractSource.matchAll(/`(sm-[a-z0-9-]+)`/gu)].map((match) => match[1]),
  );
  const personas = JSON.parse(personasSource);
  const alice = personas.starter.find((persona) => persona.id === 'alice');
  if (!alice) throw new Error('Alice is missing from the shared social-messenger personas');
  return { contractIds, alice };
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
  artifact,
  assertionReceipts,
  sensitiveValues,
}) {
  let boot = null;
  let loginStarted = false;
  let loginSessionToken = '';
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
    if (injectSignedOut) {
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
      `.data/acceptance/coterie-m1-${safeProviderName(requestedProvider)}.json`,
  );
  const artifact = {
    schemaVersion: 'coterie.acceptance.v1',
    milestone: 'm1',
    provider: requestedProvider,
    mechanism: 'headless-generated-bindings',
    socketRequired: requestedProvider === 'snapback',
    authorities: {
      testIds: 'benchmarks/tools/social-messenger/CONTRACT.md',
      personas: 'benchmarks/fixtures/social-messenger/personas.json',
      aggregation: 'benchmarks/tools/social-messenger/choreography/choreography.mjs',
    },
    scenarios: [],
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
      await installM1Fixtures({
        baseUrl: resolveCoterieSnapbackUrl(),
        runId: `accept-${Date.now()}`,
      });
    }
    const { contractIds, alice } = await loadAuthorities();
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
        artifact,
        assertionReceipts,
        sensitiveValues,
      });
    }

    artifact.pass = true;
  } catch (error) {
    artifact.error = redactedErrorText(error, sensitiveValues);
  } finally {
    const sharedAggregation = aggregateChoreography(assertionReceipts);
    artifact.sharedAggregation = {
      counts: sharedAggregation.counts,
      assertionPass: sharedAggregation.browserPass,
      reason: sharedAggregation.reason,
    };
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      `${serializeRedactedArtifact(artifact, sensitiveValues)}\n`,
      'utf8',
    );
    process.stdout.write(
      `${artifact.pass ? 'PASS' : 'FAIL'} Coterie M1 acceptance (${requestedProvider})\n` +
        `scenarios: ${artifact.scenarios.join(', ')}\n` +
        `steps: ${artifact.steps.filter((step) => step.status === 'passed').length}/${artifact.steps.length}\n` +
        `artifact: ${artifactPath}\n`,
    );
    if (!artifact.pass) {
      process.stderr.write(`${artifact.error}\n`);
      process.exitCode = 1;
    }
  }
}

await main();
