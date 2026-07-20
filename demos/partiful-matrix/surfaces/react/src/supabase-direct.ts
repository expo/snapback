import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

import type {
  Connection,
  EventRow,
  MatrixProvider,
  MutationName,
  PostRow,
  ProviderDelivery,
  QueryName,
  RsvpRow,
} from '../../../shared/model';

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_PUBLISHABLE_KEY__: string;
declare const __PARTITIME_DISABLE_POLL_FALLBACK__: boolean;

// The browser-direct cell: supabase-js with the publishable key, no gateway.
// Reads and writes go straight to PostgREST; freshness comes from Realtime
// postgres_changes on the partiful_matrix_* tables (added to the
// supabase_realtime publication by backends/gateway/harden-supabase.ts).
// Write-shape invariants (host displacement, DELETE) are enforced by RLS
// policies rather than by this client.

const QUERY_TABLES: Record<QueryName, string> = {
  listEvents: 'partiful_matrix_events',
  eventDetails: 'partiful_matrix_events',
  guestList: 'partiful_matrix_rsvps',
  eventWall: 'partiful_matrix_posts',
};

const eventRow = (row: Record<string, unknown>): EventRow => ({
  _id: String(row.id), title: String(row.title), emoji: String(row.emoji),
  description: String(row.description), location: String(row.location),
  startsAt: Number(row.starts_at), hostId: String(row.host_id),
  hostName: String(row.host_name), accent: String(row.accent),
});
const rsvpRow = (row: Record<string, unknown>): RsvpRow => ({
  _id: String(row.id), eventId: String(row.event_id), userId: String(row.user_id),
  guestName: String(row.guest_name), status: String(row.status) as RsvpRow['status'],
});
const postRow = (row: Record<string, unknown>): PostRow => ({
  _id: String(row.id), eventId: String(row.event_id), authorId: String(row.author_id),
  authorName: String(row.author_name), message: String(row.message), createdAt: Number(row.created_at),
});

async function runQuery(client: SupabaseClient, name: QueryName, args: Record<string, unknown>) {
  if (name === 'listEvents') {
    const { data, error } = await client.from('partiful_matrix_events').select('*').order('starts_at');
    if (error) throw new Error(error.message);
    return (data ?? []).map(eventRow);
  }
  if (name === 'eventDetails') {
    const { data, error } = await client.from('partiful_matrix_events').select('*').eq('id', String(args.eventId));
    if (error) throw new Error(error.message);
    return (data ?? []).map(eventRow);
  }
  if (name === 'guestList') {
    const { data, error } = await client.from('partiful_matrix_rsvps').select('*').eq('event_id', String(args.eventId)).order('id');
    if (error) throw new Error(error.message);
    return (data ?? []).map(rsvpRow);
  }
  if (name === 'eventWall') {
    const { data, error } = await client.from('partiful_matrix_posts').select('*').eq('event_id', String(args.eventId)).order('created_at');
    if (error) throw new Error(error.message);
    return (data ?? []).map(postRow);
  }
  throw new Error(`unknown query: ${name}`);
}

export function createSupabaseDirectProvider(): MatrixProvider {
  if (!__SUPABASE_URL__ || !__SUPABASE_PUBLISHABLE_KEY__) {
    throw new Error('supabase-realtime cell needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY at build time');
  }
  const client = createClient(__SUPABASE_URL__, __SUPABASE_PUBLISHABLE_KEY__);
  const subscriptionEvents: Record<string, unknown>[] = [];
  // Own mutations refresh the local subscriptions directly instead of waiting
  // for their Realtime echo: a write committed in the gap between channel
  // creation and server-side registration would otherwise never be reflected
  // (there is no poll to catch it). Out-of-band writes still arrive only via
  // postgres_changes.
  const activeSubscriptions = new Set<() => void>();
  const refreshAfterOwnMutation = () => { for (const refresh of activeSubscriptions) refresh(); };
  let counter = 0;

  return {
    backend: 'supabase-realtime',
    transport: 'push',
    externalStoreProtocol: 'snapback.external-store.v1',
    async subscribe<Row>(name: QueryName, args: Record<string, unknown>, _userId: string, observer: (rows: Row[], connection: Connection, delivery?: ProviderDelivery) => void) {
      const channelName = `partiful_matrix_${name}_${counter += 1}`;
      let latestRows: Row[] = [];
      let disposed = false;
      let pollTimer: number | undefined;
      const refetch = async (connection: Connection) => {
        const rows = await runQuery(client, name, args) as Row[];
        if (disposed) return rows;
        latestRows = rows;
        observer(rows, connection, { kind: 'authoritative' });
        return rows;
      };
      const startPollFallback = () => {
        if (__PARTITIME_DISABLE_POLL_FALLBACK__ || disposed || pollTimer !== undefined) {
          observer(latestRows, 'disconnected', { kind: 'connection' });
          return;
        }
        subscriptionEvents.push({ queryName: name, event: 'fallback', transport: 'poll', pollFallbackEnabled: true });
        const poll = async () => {
          try {
            await refetch('polling');
          } catch (error) {
            observer(latestRows, 'disconnected', { kind: 'error', error });
          }
          if (!disposed) pollTimer = window.setTimeout(poll, 1000);
        };
        pollTimer = window.setTimeout(poll, 1000);
      };

      observer([], 'connecting', { kind: 'connection' });
      const filter = name === 'listEvents'
        ? { event: '*' as const, schema: 'public', table: QUERY_TABLES[name] }
        : name === 'eventDetails'
          ? { event: '*' as const, schema: 'public', table: QUERY_TABLES[name], filter: `id=eq.${String(args.eventId)}` }
          : { event: '*' as const, schema: 'public', table: QUERY_TABLES[name], filter: `event_id=eq.${String(args.eventId)}` };
      const channel: RealtimeChannel = client
        .channel(channelName)
        .on('postgres_changes', filter, (change) => {
          subscriptionEvents.push({ queryName: name, event: 'change', transport: 'push', eventType: change.eventType, table: change.table });
          void refetch('live').catch((error) => observer(latestRows, 'disconnected', { kind: 'error', error }));
        })
        .subscribe((status) => {
          if (disposed) return;
          if (status === 'SUBSCRIBED') {
            subscriptionEvents.push({
              queryName: name, event: 'established', transport: 'push',
              pollFallbackEnabled: !__PARTITIME_DISABLE_POLL_FALLBACK__, channel: channelName,
            });
            void refetch('live').catch((error) => observer(latestRows, 'disconnected', { kind: 'error', error }));
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            subscriptionEvents.push({ queryName: name, event: 'channel-degraded', status, channel: channelName });
            startPollFallback();
          }
        });

      const refresh = () => {
        void refetch('live').catch((error) => observer(latestRows, 'disconnected', { kind: 'error', error }));
      };
      activeSubscriptions.add(refresh);
      const rows = await refetch(__PARTITIME_DISABLE_POLL_FALLBACK__ ? 'connecting' : 'live');
      return {
        rows,
        dispose() {
          disposed = true;
          activeSubscriptions.delete(refresh);
          if (pollTimer !== undefined) window.clearTimeout(pollTimer);
          void client.removeChannel(channel);
        },
      };
    },
    async mutate<T>(name: MutationName, args: Record<string, any>, userId: string) {
      if (name === 'createEvent') {
        const id = `event_${crypto.randomUUID()}`;
        const { error } = await client.from('partiful_matrix_events').insert({
          id, title: String(args.title).trim(), emoji: args.emoji || '✨',
          description: String(args.description ?? '').trim(), location: String(args.location).trim(),
          starts_at: args.startsAt, host_id: userId, host_name: args.hostName, accent: args.accent || 'tangerine',
        });
        if (error) throw new Error(error.message);
        const { error: rsvpError } = await client.from('partiful_matrix_rsvps').insert({
          id: `rsvp_${crypto.randomUUID()}`, event_id: id, user_id: userId, guest_name: args.hostName, status: 'host',
        });
        if (rsvpError) throw new Error(rsvpError.message);
        refreshAfterOwnMutation();
        return id as T;
      }
      if (name === 'rsvp') {
        const { data: current, error: readError } = await client.from('partiful_matrix_rsvps')
          .select('id,status').eq('event_id', String(args.eventId)).eq('user_id', userId);
        if (readError) throw new Error(readError.message);
        if (current?.[0]?.status === 'host') throw new Error('the host is already going');
        // Reuse the existing row id: an upsert that rewrites `id` breaks the
        // seed's ON CONFLICT (id) idempotence for every later run.
        const id = current?.[0]?.id ?? `rsvp_${crypto.randomUUID()}`;
        const { error } = await client.from('partiful_matrix_rsvps').upsert(
          { id, event_id: args.eventId, user_id: userId, guest_name: args.guestName, status: args.status },
          { onConflict: 'event_id,user_id' },
        );
        if (error) {
          throw new Error(error.message.includes('row-level security') ? 'the host is already going' : error.message);
        }
        refreshAfterOwnMutation();
        return id as T;
      }
      if (name === 'postMessage') {
        const id = `post_${crypto.randomUUID()}`;
        const { error } = await client.from('partiful_matrix_posts').insert({
          id, event_id: args.eventId, author_id: userId, author_name: args.authorName,
          message: String(args.message).trim(),
        });
        if (error) throw new Error(error.message);
        refreshAfterOwnMutation();
        return id as T;
      }
      throw new Error(`unknown mutation: ${name}`);
    },
    transportEvidence: () => subscriptionEvents.map((event) => ({ ...event })),
    dispose() { void client.removeAllChannels(); },
  };
}
