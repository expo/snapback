import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const LIVE_PHASE_TIMEOUT_MS = 15_000;
const LIVE_ATTEMPT_LIMIT = 2;
const secrets = readFileSync(resolve(import.meta.dirname, '..', '..', '..', '.agent-local-secrets.md'), 'utf8');
const unquote = (value) => value?.trim().replace(/^(['"])(.*)\1$/, '$2');
const values = (name) =>
  [...secrets.matchAll(new RegExp(`^${name}=(.+)$`, 'gm'))].map((match) => unquote(match[1]));
const url = values('SUPABASE_URL').find((value) => /^https?:\/\//.test(value));
const publicKey = [
  ...values('SUPABASE_PUBLISHABLE_KEY'),
  ...values('SUPABASE_ANON_KEY'),
].find((value) => value.length > 20 && value !== '...');
const secretKey = values('SUPABASE_SECRET_KEY').find(
  (value) => value.length > 20 && value !== '...',
);
if (!url || !publicKey || !secretKey) throw new Error('Supabase test credentials are missing');

const client = createClient(url, publicKey);
const admin = createClient(url, secretKey);
let incidentId = null;
const realtimeResources = new Set();

async function withTimeout(promise, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          LIVE_PHASE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function observeCommentAttempt(attempt, nonce) {
  const witness = `Supabase live witness ${nonce}-${attempt}`;
  const timing = {
    attempt,
    outcome: 'started',
    subscriptionStartedAt: new Date().toISOString(),
    subscribedAt: null,
    insertCompletedAt: null,
    deliveredAt: null,
  };
  let resolveDelivery;
  const delivery = new Promise((resolve) => {
    resolveDelivery = resolve;
  });
  // Each bounded retry owns a new transport as well as a new channel. Reusing
  // a socket after a channel-level timeout would not be an independent retry.
  const realtimeClient = createClient(url, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const channel = realtimeClient
    .channel(`bakeoff-test-${nonce}-${attempt}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'bakeoff_comments',
      },
      (payload) => {
        if (
          payload.new.incident_id === incidentId
          && payload.new.body === witness
        ) {
          timing.deliveredAt = new Date().toISOString();
          resolveDelivery(payload);
        }
      },
    );
  const resource = { channel, realtimeClient };
  realtimeResources.add(resource);
  try {
    await withTimeout(
      new Promise((resolve, reject) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            timing.subscribedAt = new Date().toISOString();
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            reject(new Error(`Supabase Realtime status: ${status}`));
          }
        });
      }),
      'Supabase Realtime subscription',
    );
    const added = await client.rpc('bakeoff_add_comment', {
      p_actor_id: 'user_grace',
      p_incident_id: incidentId,
      p_body: witness,
      p_at_ms: Date.now(),
    });
    if (added.error) throw added.error;
    timing.insertCompletedAt = new Date().toISOString();
    await withTimeout(delivery, 'Supabase Realtime delivery');
    timing.outcome = 'passed';
    return timing;
  } catch (error) {
    timing.outcome = 'failed';
    timing.diagnostic = error instanceof Error ? error.message : String(error);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      timing,
    });
  } finally {
    await realtimeClient.removeChannel(channel);
    realtimeClient.realtime.disconnect();
    realtimeResources.delete(resource);
  }
}

try {
  const nonce = randomUUID();
  const title = `Bakeoff acceptance ${nonce}`;
  const created = await client.rpc('bakeoff_create_incident', {
    p_actor_id: 'user_ada',
    p_title: title,
    p_severity: 'SEV-2',
    p_at_ms: Date.now(),
  });
  if (created.error) throw created.error;
  incidentId = created.data;

  const attempts = [];
  const errors = [];
  for (let attempt = 1; attempt <= LIVE_ATTEMPT_LIMIT; attempt += 1) {
    try {
      const timing = await observeCommentAttempt(attempt, nonce);
      attempts.push(timing);
      break;
    } catch (error) {
      attempts.push(error.timing ?? {
        attempt,
        outcome: 'failed',
        diagnostic: error instanceof Error ? error.message : String(error),
      });
      errors.push(error);
      if (attempt < LIVE_ATTEMPT_LIMIT) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }
  for (const attempt of attempts) {
    process.stdout.write(`Supabase Realtime attempt: ${JSON.stringify(attempt)}\n`);
  }
  if (attempts.at(-1)?.outcome !== 'passed') {
    throw new AggregateError(
      errors,
      `Supabase Realtime failed after ${LIVE_ATTEMPT_LIMIT} bounded attempts`,
    );
  }
  const brief = await client.rpc('bakeoff_generate_brief', { p_incident_id: incidentId });
  if (brief.error || !brief.data.includes('tasks complete')) {
    throw brief.error ?? new Error('Supabase brief missing task summary');
  }
  const search = await client
    .from('bakeoff_incidents')
    .select('title')
    .textSearch('search_document', 'acceptance', { type: 'websearch' });
  if (search.error || !search.data.some((row) => row.title === title)) {
    throw search.error ?? new Error('Supabase search did not find acceptance incident');
  }
  process.stdout.write('Supabase integration: transaction RPC, native realtime, search, brief — pass\n');
} finally {
  for (const { channel, realtimeClient } of realtimeResources) {
    await realtimeClient.removeChannel(channel);
    realtimeClient.realtime.disconnect();
  }
  if (incidentId) await admin.from('bakeoff_incidents').delete().eq('id', incidentId);
}
