import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

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
let channel = null;
try {
  const title = `Bakeoff acceptance ${Date.now()}`;
  const created = await client.rpc('bakeoff_create_incident', {
    p_actor_id: 'user_ada',
    p_title: title,
    p_severity: 'SEV-2',
    p_at_ms: Date.now(),
  });
  if (created.error) throw created.error;
  incidentId = created.data;

  let resolveLive;
  let rejectLive;
  const live = new Promise((resolve, reject) => {
    resolveLive = resolve;
    rejectLive = reject;
  });
  const subscribed = new Promise((resolve, reject) => {
    const subscriptionTimeout = setTimeout(
      () => reject(new Error('Supabase Realtime subscription timed out')),
      8_000,
    );
    const timeout = setTimeout(
      () => rejectLive(new Error('Supabase Realtime timed out')),
      8_000,
    );
    channel = client
      .channel(`bakeoff-test-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bakeoff_comments',
          filter: `incident_id=eq.${incidentId}`,
        },
        (payload) => {
          if (payload.new.body === 'Supabase live witness') {
            clearTimeout(timeout);
            resolveLive(payload);
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(subscriptionTimeout);
          resolve();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(subscriptionTimeout);
          reject(new Error(`Supabase Realtime status: ${status}`));
        }
      });
  });
  await subscribed;
  const added = await client.rpc('bakeoff_add_comment', {
    p_actor_id: 'user_grace',
    p_incident_id: incidentId,
    p_body: 'Supabase live witness',
    p_at_ms: Date.now(),
  });
  if (added.error) throw added.error;
  await live;
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
  if (channel) await client.removeChannel(channel);
  if (incidentId) await admin.from('bakeoff_incidents').delete().eq('id', incidentId);
}
