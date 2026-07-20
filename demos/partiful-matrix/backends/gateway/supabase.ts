import { SQL } from 'bun';

import seed from '../../shared/seed.json';

const eventRow = (row: any) => ({ _id: row.id, title: row.title, emoji: row.emoji, description: row.description, location: row.location, startsAt: Number(row.starts_at), hostId: row.host_id, hostName: row.host_name, accent: row.accent });
const rsvpRow = (row: any) => ({ _id: row.id, eventId: row.event_id, userId: row.user_id, guestName: row.guest_name, status: row.status });
const postRow = (row: any) => ({ _id: row.id, eventId: row.event_id, authorId: row.author_id, authorName: row.author_name, message: row.message, createdAt: Number(row.created_at) });

// Ephemeral schemas give acceptance runs a disposable database on the hosted
// project: DDL + seed land in a per-run schema and dropEphemeralSchema()
// removes every trace afterwards. The mandatory prefix keeps DROP ... CASCADE
// constitutionally unable to touch the shared fixture. Table references are
// schema-qualified on every statement because the hosted pooler ignores the
// `options=-csearch_path` startup parameter, which would otherwise silently
// redirect "ephemeral" runs at the shared public fixture.
export const EPHEMERAL_SCHEMA_PREFIX = 'partiful_matrix_test_';

export async function createSupabaseAdapter(databaseUrl: string, { schema }: { schema?: string } = {}) {
  if (schema && !new RegExp(`^${EPHEMERAL_SCHEMA_PREFIX}[a-z0-9_]+$`).test(schema)) {
    throw new Error(`ephemeral Supabase schema must match ${EPHEMERAL_SCHEMA_PREFIX}[a-z0-9_]+: ${schema}`);
  }
  const ns = schema ?? 'public';
  const sql = new SQL(databaseUrl);
  const events = () => sql`${sql(ns)}.${sql('partiful_matrix_events')}`;
  const rsvps = () => sql`${sql(ns)}.${sql('partiful_matrix_rsvps')}`;
  const posts = () => sql`${sql(ns)}.${sql('partiful_matrix_posts')}`;
  if (schema) await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await sql`CREATE TABLE IF NOT EXISTS ${events()} (
    id text PRIMARY KEY, title text NOT NULL, emoji text NOT NULL,
    description text NOT NULL, location text NOT NULL, starts_at bigint NOT NULL,
    host_id text NOT NULL, host_name text NOT NULL, accent text NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS ${rsvps()} (
    id text PRIMARY KEY, event_id text NOT NULL REFERENCES ${events()}(id) ON DELETE CASCADE,
    user_id text NOT NULL, guest_name text NOT NULL, status text NOT NULL,
    UNIQUE(event_id, user_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS ${posts()} (
    id text PRIMARY KEY, event_id text NOT NULL REFERENCES ${events()}(id) ON DELETE CASCADE,
    author_id text NOT NULL, author_name text NOT NULL, message text NOT NULL, created_at bigint NOT NULL
  )`;
  for (const row of seed.events) {
    await sql`INSERT INTO ${events()} (id,title,emoji,description,location,starts_at,host_id,host_name,accent)
      VALUES (${row._id},${row.title},${row.emoji},${row.description},${row.location},${row.startsAt},${row.hostId},${row.hostName},${row.accent})
      ON CONFLICT (id) DO NOTHING`;
  }
  for (const row of seed.rsvps) {
    await sql`INSERT INTO ${rsvps()} (id,event_id,user_id,guest_name,status)
      VALUES (${row._id},${row.eventId},${row.userId},${row.guestName},${row.status}) ON CONFLICT (id) DO NOTHING`;
  }
  for (const row of seed.posts) {
    await sql`INSERT INTO ${posts()} (id,event_id,author_id,author_name,message,created_at)
      VALUES (${row._id},${row.eventId},${row.authorId},${row.authorName},${row.message},${row.createdAt}) ON CONFLICT (id) DO NOTHING`;
  }

  return {
    backend: 'supabase',
    async query(name: string, args: Record<string, unknown>) {
      if (name === 'listEvents') return (await sql`SELECT * FROM ${events()} ORDER BY starts_at`).map(eventRow);
      if (name === 'eventDetails') return (await sql`SELECT * FROM ${events()} WHERE id = ${String(args.eventId)}`).map(eventRow);
      if (name === 'guestList') return (await sql`SELECT * FROM ${rsvps()} WHERE event_id = ${String(args.eventId)} ORDER BY id`).map(rsvpRow);
      if (name === 'eventWall') return (await sql`SELECT * FROM ${posts()} WHERE event_id = ${String(args.eventId)} ORDER BY created_at`).map(postRow);
      throw new Error(`unknown query: ${name}`);
    },
    async mutate(name: string, args: Record<string, any>, userId: string) {
      if (name === 'createEvent') {
        const id = `event_${crypto.randomUUID()}`;
        await sql.begin(async (tx) => {
          await tx`INSERT INTO ${tx(ns)}.${tx('partiful_matrix_events')} (id,title,emoji,description,location,starts_at,host_id,host_name,accent)
            VALUES (${id},${args.title.trim()},${args.emoji || '✨'},${args.description?.trim() || ''},${args.location.trim()},${args.startsAt},${userId},${args.hostName},${args.accent || 'tangerine'})`;
          await tx`INSERT INTO ${tx(ns)}.${tx('partiful_matrix_rsvps')} (id,event_id,user_id,guest_name,status)
            VALUES (${`rsvp_${crypto.randomUUID()}`},${id},${userId},${args.hostName},'host')`;
        });
        return id;
      }
      if (name === 'rsvp') {
        const current = await sql`SELECT id,status FROM ${rsvps()} WHERE event_id = ${args.eventId} AND user_id = ${userId}`;
        if (current[0]?.status === 'host') throw new Error('the host is already going');
        const id = current[0]?.id ?? `rsvp_${crypto.randomUUID()}`;
        await sql`INSERT INTO ${rsvps()} (id,event_id,user_id,guest_name,status)
          VALUES (${id},${args.eventId},${userId},${args.guestName},${args.status})
          ON CONFLICT (event_id,user_id) DO UPDATE SET guest_name=excluded.guest_name,status=excluded.status`;
        return id;
      }
      if (name === 'postMessage') {
        const id = `post_${crypto.randomUUID()}`;
        await sql`INSERT INTO ${posts()} (id,event_id,author_id,author_name,message,created_at)
          VALUES (${id},${args.eventId},${userId},${args.authorName},${args.message.trim()},${args.createdAt})`;
        return id;
      }
      throw new Error(`unknown mutation: ${name}`);
    },
    async cleanupAcceptanceEvent(eventId: string) {
      const rows = await sql`SELECT id FROM ${events()} WHERE id=${eventId} AND host_id='user_matrix_acceptance' AND title LIKE '[acceptance]%'`;
      if (rows.length === 0) return false;
      await sql.begin(async (tx) => {
        await tx`DELETE FROM ${tx(ns)}.${tx('partiful_matrix_posts')} WHERE event_id=${eventId}`;
        await tx`DELETE FROM ${tx(ns)}.${tx('partiful_matrix_rsvps')} WHERE event_id=${eventId}`;
        await tx`DELETE FROM ${tx(ns)}.${tx('partiful_matrix_events')} WHERE id=${eventId}`;
      });
      return true;
    },
    async dropEphemeralSchema() {
      if (!schema) return false;
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      return true;
    },
    async close() { await sql.close(); },
  };
}
