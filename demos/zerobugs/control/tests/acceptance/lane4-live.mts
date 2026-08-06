import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

import {createExternalSessionClient} from '@expo/snapback-client';

import {
  ACTOR_IDS,
  bindActorsAgainstReadyFile,
  emitActorBindingReceipt,
  type ActorId,
} from '../../scripts/bind-actors.mts';
import {loadFixtureAgainstReadyFile, mintDevSession} from '../../scripts/load-fixture.mts';
import {
  applyExpectedMutation,
  canonicalValue,
  loadLane4Oracle,
  normalizedExpectedAudit,
  normalizedObservedAudit,
  readModelRebuildDigest,
  type JsonRow,
  type Lane4IntentExpectation,
  type Lane4Oracle,
} from '../lane4-oracle.mts';

const CONTROL_ROOT = resolve(import.meta.dirname, '../..');
const DEFAULT_READY_FILE = join(CONTROL_ROOT, '.snapback/dev.ready.json');
const EXPECTED_CHECKS = 18;
const CREATED_ISSUE_ID = 'zb_lane4_issue_v1';
const CREATED_COMMENT_ID = 'zb_lane4_comment_v1';
const INTERNAL_ISSUE_ID = 'zbav1_internal_issue';
const INTERNAL_COMMENT_ID = 'zbav1_internal_comment';
const DEFAULT_PROJECT_ID = 'iCNlS2qEpzYWEes1RTf-D';
const MUTATION_NAMES = [
  'issueCreate',
  'issueUpdate',
  'issueDelete',
  'issueAddLabel',
  'issueRemoveLabel',
  'notificationUpdate',
  'emojiAddToIssue',
  'emojiAddToComment',
  'emojiRemove',
  'commentAdd',
  'commentEdit',
  'commentRemove',
  'labelCreate',
  'labelCreateAndAddToIssue',
  'viewStateSet',
  'userPrefSet',
] as const;

type MutationName = (typeof MUTATION_NAMES)[number];
type JsonObject = Record<string, unknown>;
type MutationReceipt = {
  mutator: string;
  outcome: 'applied';
  sourceID: string | null;
  rowID: string | null;
  issueID: string | null;
  intentID: string | null;
  intentKey: string | null;
  authoritativeTime: number | null;
};
type Client = {
  mutate: (
    reference: unknown,
    options: {args: JsonObject; clientMutationId: string; queue: false},
  ) => Promise<{result: unknown}>;
  query: (
    reference: unknown,
    options: {args: JsonObject},
  ) => Promise<{rows: readonly unknown[]}>;
  closeAuth: () => Promise<void>;
};
type CheckReceipt = {
  id: string;
  status: 'pass' | 'fail';
  error?: string;
};
type Scenario = {
  name: MutationName;
  logicalName: string;
  actor: ActorId;
  refusalActor: ActorId | 'unbound';
  args: JsonObject;
  refusalArgs?: JsonObject;
  sourceID: string;
  issueID: string | null;
  rowPrefix: string;
  time: 'server' | 'caller' | 'none';
  callerTime?: number;
  triggersIntent: boolean;
};

function record(value: unknown, label: string): JsonObject {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is an object`);
  return value as JsonObject;
}

function text(value: unknown, label: string): string {
  assert.equal(typeof value, 'string', `${label} is a string`);
  return value;
}

function number(value: unknown, label: string): number {
  assert.equal(typeof value, 'number', `${label} is a number`);
  assert(Number.isFinite(value), `${label} is finite`);
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorText(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.length <= 2_048 ? value : `${value.slice(0, 2_048)}…`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

async function waitForSettledStart(readyFile: string): Promise<{serverUrl: string}> {
  const deadline = Date.now() + 30_000;
  let lastError = 'readiness descriptor has not appeared';
  while (Date.now() < deadline) {
    try {
      const firstText = await readFile(readyFile, 'utf8');
      const ready = record(JSON.parse(firstText), 'readiness descriptor');
      const serverUrl = text(ready.serverUrl, 'ready.serverUrl');
      const advertised = text(
        ready.impersonationCapabilityFile,
        'ready.impersonationCapabilityFile',
      );
      assert.equal(
        advertised,
        `${readyFile}.impersonation`,
        'ready descriptor names its mechanical impersonation sidecar',
      );
      const capability = (await readFile(advertised, 'utf8')).trim();
      assert.match(capability, /^sbic_[A-Za-z0-9_-]+\.[0-9a-f]{8}$/u);
      const secondText = await readFile(readyFile, 'utf8');
      assert.equal(secondText, firstText, 'readiness descriptor remained stable across sidecar read');
      return {serverUrl};
    } catch (error) {
      lastError = errorText(error);
      await delay(50);
    }
  }
  throw new Error(`settled server start timed out: ${lastError}`);
}

function receipt(value: unknown, scenario: Scenario): MutationReceipt {
  const result = record(value, `${scenario.logicalName} result`);
  assert.equal(result.mutator, scenario.logicalName);
  assert.equal(result.outcome, 'applied');
  assert.equal(result.sourceID, scenario.sourceID);
  assert.equal(result.issueID, scenario.issueID);
  assert.equal(typeof result.rowID, 'string', `${scenario.logicalName} returns its physical row id`);
  assert.match(
    text(result.rowID, `${scenario.logicalName}.rowID`),
    new RegExp(`^${scenario.rowPrefix}_`, 'u'),
    `${scenario.logicalName} uses a server-minted prefixed physical id`,
  );
  if (scenario.time === 'server') {
    const authoritative = number(result.authoritativeTime, `${scenario.logicalName}.authoritativeTime`);
    assert.notEqual(authoritative, scenario.callerTime, 'server replaces the caller timestamp');
  } else if (scenario.time === 'caller') {
    assert.equal(result.authoritativeTime, scenario.callerTime, 'server preserves the pinned caller timestamp');
  } else {
    assert.equal(result.authoritativeTime, null);
  }
  if (scenario.triggersIntent) {
    assert.match(text(result.intentID, 'intent id'), /^id_/u);
    assert.match(text(result.intentKey, 'intent key'), /^notification:[A-Za-z]+:/u);
  } else {
    assert.equal(result.intentID, null);
    assert.equal(result.intentKey, null);
  }
  return result as MutationReceipt;
}

function newIntentRows(before: JsonRow, after: JsonRow): JsonRow[] {
  const previous = new Set(
    (before.notificationIntent as JsonRow[]).map(row => text(row.physicalID, 'intent physical id')),
  );
  return (after.notificationIntent as JsonRow[]).filter(row => (
    !previous.has(text(row.physicalID, 'intent physical id'))
  ));
}

function assertIntent(
  actual: JsonRow,
  expected: Lane4IntentExpectation,
  mutationResult: MutationReceipt,
): void {
  assert.equal(actual.physicalID, mutationResult.intentID);
  assert.equal(actual.idempotencyKey, mutationResult.intentKey);
  assert.equal(actual.trigger, expected.trigger);
  assert.equal(actual.kind, expected.kind);
  assert.equal(actual.issueID, expected.issueID);
  assert.equal(actual.actorID, expected.actorID);
  assert.equal(actual.discordEligible, expected.discordEligible);
  assert.equal(actual.state, 'pending');
  assert.equal(typeof actual.created, 'number');
  assert.deepEqual(JSON.parse(text(actual.payloadSnapshot, 'payload snapshot')), expected.payload);
  assert.deepEqual(
    JSON.parse(text(actual.recipientSnapshot, 'recipient snapshot')),
    expected.recipients,
  );
}

function assertParity(oracle: Lane4Oracle, observed: JsonRow, label: string): string {
  const expected = normalizedExpectedAudit(oracle);
  const normalized = normalizedObservedAudit(observed);
  assert.deepEqual(normalized, expected, `${label} authoritative state matches the independent oracle`);
  const expectedDigest = readModelRebuildDigest(expected);
  const observedDigest = readModelRebuildDigest(normalized);
  assert.equal(observedDigest, expectedDigest, `${label} incremental read models match a rebuild`);
  return observedDigest;
}

function selectDeleteCandidate(oracle: Lane4Oracle, refusedActorID: string): JsonRow {
  const candidates = oracle.issues
    .filter(issue => (
      issue.visibility === 'public'
      && issue.creatorID !== refusedActorID
      && oracle.comments.some(comment => comment.issueID === issue.id)
      && oracle.issueLabels.some(edge => edge.issueID === issue.id)
    ))
    .map(issue => ({
      issue,
      dependents:
        oracle.comments.filter(comment => comment.issueID === issue.id).length
        + oracle.issueLabels.filter(edge => edge.issueID === issue.id).length
        + oracle.viewState.filter(view => view.issueID === issue.id).length
        + oracle.issueNotifications.filter(row => row.issueID === issue.id).length,
    }))
    .sort((left, right) => (
      left.dependents - right.dependents
      || compareText(String(left.issue.id), String(right.issue.id))
    ));
  assert(candidates[0], 'fixture has a bounded public issue with comments and labels for cascade proof');
  return candidates[0].issue;
}

function mutationScenarios(oracle: Lane4Oracle, sourceActors: Record<ActorId, string>): Scenario[] {
  const existingLabel = oracle.labels
    .filter(label => label.projectID === DEFAULT_PROJECT_ID)
    .sort((left, right) => compareText(String(left.id), String(right.id)))[0];
  assert(existingLabel, 'fixture has a label in the default project');
  const deleteIssue = selectDeleteCandidate(oracle, sourceActors['ordinary-user']);
  const labelID = text(existingLabel.id, 'existing label id');
  const deleteIssueID = text(deleteIssue.id, 'delete issue id');
  return [
    {
      name: 'issueCreate', logicalName: 'issue.create', actor: 'creator', refusalActor: 'unbound',
      args: {
        id: CREATED_ISSUE_ID,
        title: 'Lane 4 authoritative mutation corpus',
        description: 'A deterministic live mutation witness.',
        created: 101,
        modified: 102,
        projectID: DEFAULT_PROJECT_ID,
      },
      sourceID: CREATED_ISSUE_ID, issueID: CREATED_ISSUE_ID, rowPrefix: 'id',
      time: 'server', callerTime: 101, triggersIntent: true,
    },
    {
      name: 'issueUpdate', logicalName: 'issue.update', actor: 'creator', refusalActor: 'assignee',
      args: {
        id: CREATED_ISSUE_ID,
        title: 'Lane 4 authoritative mutation corpus — updated',
        description: 'The server owns this update time.',
        open: false,
        assigneeID: sourceActors.assignee,
        visibility: 'public',
        modified: 103,
      },
      sourceID: CREATED_ISSUE_ID, issueID: CREATED_ISSUE_ID, rowPrefix: 'id',
      time: 'server', callerTime: 103, triggersIntent: true,
    },
    {
      name: 'issueAddLabel', logicalName: 'issue.addLabel', actor: 'creator', refusalActor: 'assignee',
      args: {issueID: CREATED_ISSUE_ID, labelID, projectID: DEFAULT_PROJECT_ID},
      sourceID: labelID, issueID: CREATED_ISSUE_ID, rowPrefix: 'id',
      time: 'none', triggersIntent: true,
    },
    {
      name: 'issueRemoveLabel', logicalName: 'issue.removeLabel', actor: 'creator', refusalActor: 'assignee',
      args: {issueID: CREATED_ISSUE_ID, labelID},
      sourceID: labelID, issueID: CREATED_ISSUE_ID, rowPrefix: 'id',
      time: 'none', triggersIntent: true,
    },
    {
      name: 'notificationUpdate', logicalName: 'notification.update', actor: 'creator', refusalActor: 'ordinary-user',
      args: {issueID: CREATED_ISSUE_ID, subscribed: 'unsubscribe', created: 104},
      refusalArgs: {issueID: INTERNAL_ISSUE_ID, subscribed: 'subscribe', created: 104},
      sourceID: sourceActors.creator, issueID: CREATED_ISSUE_ID, rowPrefix: 'id',
      time: 'caller', callerTime: 104, triggersIntent: false,
    },
    {
      name: 'emojiAddToIssue', logicalName: 'emoji.addToIssue', actor: 'ordinary-user', refusalActor: 'ordinary-user',
      args: {
        id: 'zb_lane4_issue_emoji_v1', unicode: '👍', annotation: 'thumbs up',
        subjectID: CREATED_ISSUE_ID, created: 105,
      },
      refusalArgs: {
        id: 'zb_lane4_refused_issue_emoji_v1', unicode: '👎', annotation: 'refused',
        subjectID: INTERNAL_ISSUE_ID, created: 105,
      },
      sourceID: 'zb_lane4_issue_emoji_v1', issueID: CREATED_ISSUE_ID, rowPrefix: 'id',
      time: 'server', callerTime: 105, triggersIntent: true,
    },
    {
      name: 'commentAdd', logicalName: 'comment.add', actor: 'creator', refusalActor: 'ordinary-user',
      args: {id: CREATED_COMMENT_ID, issueID: CREATED_ISSUE_ID, body: 'Lane 4 comment body.', created: 106},
      refusalArgs: {
        id: 'zb_lane4_refused_comment_v1', issueID: INTERNAL_ISSUE_ID,
        body: 'This must not be committed.', created: 106,
      },
      sourceID: CREATED_COMMENT_ID, issueID: CREATED_ISSUE_ID, rowPrefix: 'id',
      time: 'server', callerTime: 106, triggersIntent: true,
    },
    {
      name: 'emojiAddToComment', logicalName: 'emoji.addToComment', actor: 'assignee', refusalActor: 'assignee',
      args: {
        id: 'zb_lane4_comment_emoji_v1', unicode: '🚀', annotation: 'rocket',
        subjectID: CREATED_COMMENT_ID, created: 107,
      },
      refusalArgs: {
        id: 'zb_lane4_refused_comment_emoji_v1', unicode: '🛑', annotation: 'refused',
        subjectID: INTERNAL_COMMENT_ID, created: 107,
      },
      sourceID: 'zb_lane4_comment_emoji_v1', issueID: CREATED_ISSUE_ID, rowPrefix: 'id',
      time: 'server', callerTime: 107, triggersIntent: true,
    },
    {
      name: 'emojiRemove', logicalName: 'emoji.remove', actor: 'crew-admin', refusalActor: 'assignee',
      args: {id: 'zbav1_internal_comment_emoji'},
      sourceID: 'zbav1_internal_comment_emoji', issueID: null, rowPrefix: 'id',
      time: 'none', triggersIntent: false,
    },
    {
      name: 'commentEdit', logicalName: 'comment.edit', actor: 'creator', refusalActor: 'assignee',
      args: {id: CREATED_COMMENT_ID, body: 'Lane 4 comment body, edited authoritatively.'},
      refusalArgs: {id: INTERNAL_COMMENT_ID, body: 'This unauthorized edit must not land.'},
      sourceID: CREATED_COMMENT_ID, issueID: CREATED_ISSUE_ID, rowPrefix: 'id',
      time: 'none', triggersIntent: true,
    },
    {
      name: 'commentRemove', logicalName: 'comment.remove', actor: 'creator', refusalActor: 'assignee',
      args: {id: CREATED_COMMENT_ID},
      refusalArgs: {id: INTERNAL_COMMENT_ID},
      sourceID: CREATED_COMMENT_ID, issueID: CREATED_ISSUE_ID, rowPrefix: 'id',
      time: 'none', triggersIntent: false,
    },
    {
      name: 'labelCreate', logicalName: 'label.create', actor: 'crew-admin', refusalActor: 'ordinary-user',
      args: {id: 'zb_lane4_label_v1', name: 'lane-4-label', projectID: DEFAULT_PROJECT_ID},
      sourceID: 'zb_lane4_label_v1', issueID: null, rowPrefix: 'id',
      time: 'none', triggersIntent: false,
    },
    {
      name: 'labelCreateAndAddToIssue', logicalName: 'label.createAndAddToIssue',
      actor: 'crew-admin', refusalActor: 'ordinary-user',
      args: {
        issueID: CREATED_ISSUE_ID, labelID: 'zb_lane4_joined_label_v1',
        labelName: 'lane-4-joined-label', projectID: DEFAULT_PROJECT_ID,
      },
      sourceID: 'zb_lane4_joined_label_v1', issueID: CREATED_ISSUE_ID, rowPrefix: 'id',
      time: 'none', triggersIntent: false,
    },
    {
      name: 'viewStateSet', logicalName: 'viewState.set', actor: 'creator', refusalActor: 'unbound',
      args: {issueID: CREATED_ISSUE_ID, viewed: 108},
      sourceID: sourceActors.creator, issueID: CREATED_ISSUE_ID, rowPrefix: 'id',
      time: 'caller', callerTime: 108, triggersIntent: false,
    },
    {
      name: 'userPrefSet', logicalName: 'userPref.set', actor: 'creator', refusalActor: 'unbound',
      args: {key: 'zerobugs-acceptance.v1', value: '{"lane4":true}'},
      sourceID: sourceActors.creator, issueID: null, rowPrefix: 'id',
      time: 'none', triggersIntent: false,
    },
    {
      name: 'issueDelete', logicalName: 'issue.delete', actor: 'crew-admin', refusalActor: 'ordinary-user',
      args: {id: deleteIssueID},
      sourceID: deleteIssueID, issueID: deleteIssueID, rowPrefix: 'id',
      time: 'none', triggersIntent: false,
    },
  ];
}

async function main(): Promise<void> {
  const readyFile = resolve(process.env.SNAPBACK_READY_FILE ?? DEFAULT_READY_FILE);
  const generatedApiPath = join(CONTROL_ROOT, 'snapback/generated/api.mjs');
  const generatedManifestPath = join(CONTROL_ROOT, 'snapback/generated/functions.manifest.json');
  const {default: api} = await import(pathToFileURL(generatedApiPath).href) as {
    default: Record<string, unknown>;
  };
  const checks: CheckReceipt[] = [];
  let oracle: Lane4Oracle | null = null;
  let bound: Awaited<ReturnType<typeof bindActorsAgainstReadyFile>> | null = null;
  let unbound: Client | null = null;
  let observer: Client | null = null;

  const check = async (id: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
      checks.push({id, status: 'pass'});
    } catch (error) {
      checks.push({id, status: 'fail', error: errorText(error)});
    }
  };

  const audit = async (): Promise<JsonRow> => {
    assert(observer, 'observer client is initialized');
    const response = await observer.query(api.lane4StateAudit, {args: {}});
    assert.equal(response.rows.length, 1, 'lane4 audit returns one state envelope');
    return record(response.rows[0], 'lane4 audit') as JsonRow;
  };

  try {
    const settled = await waitForSettledStart(readyFile);
    const loaded = await loadFixtureAgainstReadyFile(readyFile);
    oracle = await loadLane4Oracle();
    bound = await bindActorsAgainstReadyFile(readyFile);
    await emitActorBindingReceipt(bound.receipt);
    const observerSession = bound.sessions.get('removed-member');
    assert(observerSession, 'removed-member observer session exists');
    observer = observerSession.client as unknown as Client;
    const unboundSession = await mintDevSession(
      readyFile,
      'zerobugs-lane4-unbound@acceptance.invalid',
    );
    unbound = createExternalSessionClient(unboundSession.baseUrl, {
      bearerToken: unboundSession.token,
      clientStoreId: 'zerobugs-lane4-unbound',
      rqsStore: null,
    }) as unknown as Client;

    await check('settled-start-fixture-and-lane2-bindings', async () => {
      assert.equal(settled.serverUrl, unboundSession.baseUrl);
      assert.equal(loaded.counts.issue, oracle?.issues.length);
      assert.equal(loaded.counts.comment, oracle?.comments.length);
      assert.equal(Object.keys(bound?.receipt.actors ?? {}).length, ACTOR_IDS.length);
      assert.equal(bound?.receipt.rebindingRefused, true);
      const initial = await audit();
      assertParity(oracle as Lane4Oracle, initial, 'initial fixture');
    });

    await check('frozen-lowering-inventory-and-current-ir-fallback', async () => {
      const manifest = record(
        JSON.parse(await readFile(generatedManifestPath, 'utf8')),
        'functions manifest',
      );
      assert(Array.isArray(manifest.functions), 'functions manifest has a function list');
      const functions = manifest.functions as JsonRow[];
      for (const name of MUTATION_NAMES) {
        const operation = functions.find(candidate => candidate.name === name);
        assert(operation, `${name} exists in the generated manifest`);
        assert.equal(operation.kind, 'Mutation');
        assert(record(operation.runtime, `${name}.runtime`).IbexModule, `${name} is on the JS/Ibex tier`);
        assert.equal(operation.ir ?? null, null);
        assert.equal(record(operation.resultContract, `${name}.resultContract`).kind, 'value');
      }
      for (const name of ['issueAddLabel', 'commentEdit']) {
        const operation = functions.find(candidate => candidate.name === name) as JsonRow;
        assert.equal(operation.ir ?? null, null, `${name} could not declare the complete program as current IR`);
      }
    });

    const sourceActors = Object.fromEntries(ACTOR_IDS.map(actor => [
      actor,
      text(bound?.receipt.actors[actor].sourceUserID, `${actor} source user`),
    ])) as Record<ActorId, string>;
    const scenarios = mutationScenarios(oracle, sourceActors);
    assert.equal(scenarios.length, 16);
    assert.equal(scenarios.filter(scenario => scenario.triggersIntent).length, 8);

    for (const [index, scenario] of scenarios.entries()) {
      await check(`mutator-${String(index + 1).padStart(2, '0')}-${scenario.logicalName}`, async () => {
        assert(oracle && bound && unbound, 'lane4 clients and oracle are initialized');
        const beforeRefusal = normalizedObservedAudit(await audit());
        const refusalClient = scenario.refusalActor === 'unbound'
          ? unbound
          : bound.sessions.get(scenario.refusalActor)?.client as unknown as Client | undefined;
        assert(refusalClient, `${scenario.refusalActor} refusal client exists`);
        await assert.rejects(refusalClient.mutate(api[scenario.name], {
          args: scenario.refusalArgs ?? scenario.args,
          clientMutationId: `zb-l4-refused-${String(index + 1).padStart(2, '0')}`,
          queue: false,
        }));
        const afterRefusal = normalizedObservedAudit(await audit());
        assert.deepEqual(afterRefusal, beforeRefusal, 'authorization refusal made no partial write or intent');
        assert.equal(
          readModelRebuildDigest(afterRefusal),
          readModelRebuildDigest(beforeRefusal),
          'authorization refusal did not disturb read-model digest',
        );

        const actorClient = bound.sessions.get(scenario.actor)?.client as unknown as Client | undefined;
        assert(actorClient, `${scenario.actor} mutation client exists`);
        const clientMutationId = `zb-l4-applied-${String(index + 1).padStart(2, '0')}`;
        const response = await actorClient.mutate(api[scenario.name], {
          args: scenario.args,
          clientMutationId,
          queue: false,
        });
        const result = receipt(response.result, scenario);
        const expectedIntent = applyExpectedMutation(oracle, {
          mutator: scenario.logicalName,
          args: scenario.args,
          actorID: sourceActors[scenario.actor],
          authoritativeTime: result.authoritativeTime,
        });
        assert.equal(Boolean(expectedIntent), scenario.triggersIntent);

        const observedAfterCommit = await audit();
        const addedIntents = newIntentRows(beforeRefusal, observedAfterCommit);
        if (expectedIntent) {
          assert.equal(addedIntents.length, 1, 'trigger mutation creates exactly one durable intent');
          assertIntent(addedIntents[0], expectedIntent, result);
          oracle.notificationIntent.push({...addedIntents[0]});
        } else {
          assert.equal(addedIntents.length, 0, 'non-trigger mutation creates no intent');
        }
        assert.equal((observedAfterCommit.notificationAttempt as JsonRow[]).length, 0, 'Lane 4 performs no delivery');
        assertParity(oracle, observedAfterCommit, `${scenario.logicalName} commit`);

        const replay = await actorClient.mutate(api[scenario.name], {
          args: scenario.args,
          clientMutationId,
          queue: false,
        });
        assert.equal(
          canonicalValue(replay.result),
          canonicalValue(response.result),
          'same client mutation id returns the retained authoritative result',
        );
        const observedAfterReplay = await audit();
        assert.deepEqual(
          normalizedObservedAudit(observedAfterReplay),
          normalizedObservedAudit(observedAfterCommit),
          'same client mutation id does not double-apply state or intent',
        );
        assertParity(oracle, observedAfterReplay, `${scenario.logicalName} replay`);
      });
    }
  } catch (error) {
    if (checks.length === 0) {
      checks.push({id: 'settled-start-fixture-and-lane2-bindings', status: 'fail', error: errorText(error)});
    } else {
      checks.push({id: 'harness-unexpected-failure', status: 'fail', error: errorText(error)});
    }
  } finally {
    const closed = await Promise.allSettled([
      ...(unbound ? [unbound.closeAuth()] : []),
      ...(bound ? [bound.close()] : []),
    ]);
    const closeFailure = closed.find(result => result.status === 'rejected');
    if (closeFailure?.status === 'rejected') {
      checks.push({id: 'client-close', status: 'fail', error: errorText(closeFailure.reason)});
    }
  }

  const status = checks.length === EXPECTED_CHECKS && checks.every(check => check.status === 'pass')
    ? 'ok'
    : 'failed';
  const output = {
    schemaVersion: 'zerobugs-lane4-live.v1',
    status,
    expectedChecks: EXPECTED_CHECKS,
    executedChecks: checks.length,
    checks,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (status !== 'ok') process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${errorText(error)}\n`);
  process.exitCode = 1;
});
