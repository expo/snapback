import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {createExternalSessionClient} from '@expo/snapback-client';

import {mintDevSession, type JsonValue} from './load-fixture.mts';

export const ACTOR_IDS = [
  'ordinary-user',
  'creator',
  'assignee',
  'crew-admin',
  'removed-member',
] as const;

export type ActorId = (typeof ACTOR_IDS)[number];

interface FrozenActorBinding {
  role: 'crew' | 'user';
  sourceUserID: string;
  userID: string;
}

export interface ActorBindingReceipt {
  schemaVersion: 'zerobugs-actor-bindings.v1';
  status: 'ok';
  actors: Record<ActorId, {
    email: string;
    principal: string;
    sourceUserID: string;
  }>;
  rebindingRefused: true;
}

type ActorClient = ReturnType<typeof createExternalSessionClient>;

export interface BoundActorSession {
  actor: ActorId;
  baseUrl: string;
  client: ActorClient;
  email: string;
  principal: string;
  token: string;
}

const CONTROL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_READY_FILE = join(CONTROL_ROOT, '.snapback/dev.ready.json');
const DEFAULT_RECEIPT_FILE = join(CONTROL_ROOT, '.snapback/actor-bindings.json');
const FIXTURE_METADATA_PATH = join(CONTROL_ROOT, 'fixtures/normal-seed-v1/fixture.json');

function fail(message: string): never {
  throw new Error(`ZBUGS_ACTOR_BIND_FAILED: ${message}`);
}

export function actorEmail(actor: ActorId): string {
  return `zerobugs-${actor}@acceptance.invalid`;
}

async function frozenActorBindings(): Promise<Record<ActorId, FrozenActorBinding>> {
  const metadata = JSON.parse(await readFile(FIXTURE_METADATA_PATH, 'utf8')) as {
    actorBindings?: Partial<Record<ActorId, FrozenActorBinding>>;
  };
  const bindings = metadata.actorBindings;
  if (!bindings) fail('fixture metadata has no actorBindings contract');
  const result = {} as Record<ActorId, FrozenActorBinding>;
  for (const actor of ACTOR_IDS) {
    const binding = bindings[actor];
    if (
      !binding
      || (binding.role !== 'crew' && binding.role !== 'user')
      || typeof binding.sourceUserID !== 'string'
      || typeof binding.userID !== 'string'
    ) {
      fail(`fixture metadata has no valid binding for ${actor}`);
    }
    result[actor] = binding;
  }
  if (Object.keys(bindings).length !== ACTOR_IDS.length) {
    fail('fixture metadata actor set differs from the frozen five actors');
  }
  return result;
}

function assertSelfBinding(
  actor: ActorId,
  expected: FrozenActorBinding,
  principal: string,
  row: Record<string, unknown> | undefined,
): void {
  if (
    !row
    || row.principal !== principal
    || row.sourceUserID !== expected.sourceUserID
    || row.role !== expected.role
  ) {
    fail(`${actor} resolved to the wrong principal/source user binding`);
  }
}

async function expectRebindingRefused(
  client: ActorClient,
  api: {acceptanceBindActor: unknown},
  actor: ActorId,
): Promise<void> {
  try {
    await client.mutate(api.acceptanceBindActor as never, {args: {actor}});
  } catch {
    return;
  }
  fail(`${actor} rebinding unexpectedly succeeded`);
}

export async function bindActorsAgainstReadyFile(
  readyFile = process.env.SNAPBACK_READY_FILE ?? DEFAULT_READY_FILE,
): Promise<{
  receipt: ActorBindingReceipt;
  sessions: Map<ActorId, BoundActorSession>;
  close: () => Promise<void>;
}> {
  const expected = await frozenActorBindings();
  const generatedApiPath = join(CONTROL_ROOT, 'snapback/generated/api.mjs');
  const {default: api} = await import(pathToFileURL(generatedApiPath).href) as {
    default: {
      acceptanceActorBindingSelf: unknown;
      acceptanceBindActor: unknown;
    };
  };
  const sessions = new Map<ActorId, BoundActorSession>();
  const actors = {} as ActorBindingReceipt['actors'];

  try {
    for (const actor of ACTOR_IDS) {
      const email = actorEmail(actor);
      const minted = await mintDevSession(resolve(readyFile), email);
      const client = createExternalSessionClient(minted.baseUrl, {
        bearerToken: minted.token,
        clientStoreId: `zerobugs-lane2-${actor}`,
        rqsStore: null,
      });
      sessions.set(actor, {
        actor,
        baseUrl: minted.baseUrl,
        client,
        email,
        principal: minted.principal,
        token: minted.token,
      });

      try {
        const response = await client.mutate(api.acceptanceBindActor as never, {
          args: {actor},
        });
        const result = response.result as Record<string, unknown>;
        assertSelfBinding(actor, expected[actor], minted.principal, result);
      } catch {
        // A repeat harness run must observe the server's refusal, then prove
        // that the already-bound row is exactly the same one-to-one mapping.
      }

      const self = await client.query(api.acceptanceActorBindingSelf as never, {args: {}});
      assertSelfBinding(
        actor,
        expected[actor],
        minted.principal,
        self.rows[0] as Record<string, unknown> | undefined,
      );
      await expectRebindingRefused(client, api, actor);

      actors[actor] = {
        email,
        principal: minted.principal,
        sourceUserID: expected[actor].sourceUserID,
      };
    }

    if (new Set(Object.values(actors).map(actor => actor.email)).size !== ACTOR_IDS.length) {
      fail('actor emails are not distinct');
    }
    if (new Set(Object.values(actors).map(actor => actor.principal)).size !== ACTOR_IDS.length) {
      fail('server minted duplicate actor principals');
    }
    if (new Set(Object.values(actors).map(actor => actor.sourceUserID)).size !== ACTOR_IDS.length) {
      fail('fixture actor source users are not distinct');
    }

    const receipt: ActorBindingReceipt = {
      schemaVersion: 'zerobugs-actor-bindings.v1',
      status: 'ok',
      actors,
      rebindingRefused: true,
    };
    return {
      receipt,
      sessions,
      close: async () => {
        const settled = await Promise.allSettled(
          [...sessions.values()].map(session => session.client.closeAuth()),
        );
        const rejected = settled.find(result => result.status === 'rejected');
        if (rejected?.status === 'rejected') throw rejected.reason;
      },
    };
  } catch (error) {
    await Promise.allSettled([...sessions.values()].map(session => session.client.closeAuth()));
    throw error;
  }
}

export async function emitActorBindingReceipt(
  receipt: ActorBindingReceipt,
  path = process.env.SNAPBACK_ACTOR_BINDINGS_RECEIPT ?? DEFAULT_RECEIPT_FILE,
): Promise<string> {
  const resolved = resolve(path);
  await mkdir(dirname(resolved), {recursive: true});
  await writeFile(resolved, `${JSON.stringify(receipt)}\n`, {mode: 0o600});
  return resolved;
}

async function main(): Promise<void> {
  const bound = await bindActorsAgainstReadyFile();
  try {
    await emitActorBindingReceipt(bound.receipt);
    process.stdout.write(`${JSON.stringify(bound.receipt as unknown as JsonValue)}\n`);
  } finally {
    await bound.close();
  }
}

if (import.meta.main) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
