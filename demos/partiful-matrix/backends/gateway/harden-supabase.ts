#!/usr/bin/env bun
// Idempotent hardening for the hosted Supabase project backing the matrix.
//
// Before this script, the partiful_matrix_* tables carried the schema-owner
// defaults for tables created over a direct Postgres connection: RLS disabled
// and full grants (including DELETE and TRUNCATE) for the `anon` and
// `authenticated` roles. That was invisible while every browser cell routed
// through the local gateway, but it makes publishable-key browser access
// unshippable. This script closes that gap and registers the tables for
// Realtime so the browser-direct cell can subscribe to postgres_changes.
//
// The gateway keeps working unchanged: it connects as the table owner, which
// is not subject to these policies.
//
// Run: bun run harden-supabase.ts  (reads DIRECT_URL etc. from
// .agent-local-secrets.md at the repo root, same as server.ts)

import { SQL } from 'bun';

import { loadLocalSecrets, requireSecret } from './secrets.mjs';

const TABLES = ['partiful_matrix_events', 'partiful_matrix_rsvps', 'partiful_matrix_posts'];

const databaseUrl = process.env.PARTIFUL_MATRIX_SUPABASE_DB_URL
  ?? requireSecret(loadLocalSecrets(), 'DIRECT_URL', 'DATABASE_URL', 'SUPABASE_DB_URL');
const sql = new SQL(databaseUrl);

for (const table of TABLES) {
  await sql.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await sql.unsafe(`REVOKE TRUNCATE, DELETE ON ${table} FROM anon, authenticated`);
  await sql.unsafe(`ALTER TABLE ${table} REPLICA IDENTITY FULL`);
  await sql.unsafe(`DROP POLICY IF EXISTS ${table}_select ON ${table}`);
  await sql.unsafe(`CREATE POLICY ${table}_select ON ${table} FOR SELECT USING (true)`);
  await sql.unsafe(`DROP POLICY IF EXISTS ${table}_insert ON ${table}`);
  await sql.unsafe(`CREATE POLICY ${table}_insert ON ${table} FOR INSERT WITH CHECK (true)`);
}

// Direct browser clients never supply wall time. A BEFORE INSERT trigger is
// the authority boundary: it replaces even a hostile client's created_at
// value with database time, so the public insert policy cannot forge order.
await sql.unsafe(`CREATE OR REPLACE FUNCTION partiful_matrix_set_post_created_at()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    NEW.created_at := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
    RETURN NEW;
  END;
  $$`);
await sql.unsafe(`DROP TRIGGER IF EXISTS partiful_matrix_posts_created_at ON partiful_matrix_posts`);
await sql.unsafe(`CREATE TRIGGER partiful_matrix_posts_created_at
  BEFORE INSERT ON partiful_matrix_posts
  FOR EACH ROW EXECUTE FUNCTION partiful_matrix_set_post_created_at()`);

// The RSVP invariant lives in the database, not in read-before-write client
// code: an existing host row is not updatable and no row may become a host
// row through UPDATE, so an upsert that would displace the host fails at the
// policy layer. createEvent still inserts its own host row (insert allows
// status = 'host').
await sql.unsafe(`DROP POLICY IF EXISTS partiful_matrix_rsvps_update ON partiful_matrix_rsvps`);
await sql.unsafe(`CREATE POLICY partiful_matrix_rsvps_update ON partiful_matrix_rsvps
  FOR UPDATE USING (status <> 'host') WITH CHECK (status <> 'host')`);

for (const table of TABLES) {
  const member = await sql`SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = ${table}`;
  if (member.length === 0) {
    await sql.unsafe(`ALTER PUBLICATION supabase_realtime ADD TABLE ${table}`);
  }
}

const tableList = TABLES.map((table) => `'${table}'`).join(',');
const rls = await sql.unsafe(`SELECT relname, relrowsecurity FROM pg_class
  WHERE relname IN (${tableList}) AND relkind = 'r' ORDER BY relname`);
const policies = await sql.unsafe(`SELECT tablename, policyname, cmd FROM pg_policies
  WHERE tablename IN (${tableList}) ORDER BY tablename, policyname`);
const dangerous = await sql.unsafe(`SELECT table_name, grantee, privilege_type FROM information_schema.table_privileges
  WHERE table_name IN (${tableList}) AND grantee IN ('anon','authenticated')
  AND privilege_type IN ('DELETE','TRUNCATE')`);
const published = await sql.unsafe(`SELECT tablename FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime' AND tablename IN (${tableList}) ORDER BY tablename`);
const trustedTimeTriggers = await sql.unsafe(`SELECT tgname FROM pg_trigger
  WHERE tgrelid = 'partiful_matrix_posts'::regclass
  AND tgname = 'partiful_matrix_posts_created_at'
  AND NOT tgisinternal`);
await sql.close();

const ok = rls.every((row: { relrowsecurity: boolean }) => row.relrowsecurity)
  && dangerous.length === 0
  && published.length === TABLES.length
  && policies.length === 7
  && trustedTimeTriggers.length === 1;
console.log(JSON.stringify({
  schemaVersion: 'partitime.supabase-hardening.v1',
  ok,
  rls,
  policies,
  dangerousGrantsRemaining: dangerous,
  realtimePublication: published.map((row: { tablename: string }) => row.tablename),
  trustedTimeTriggers: trustedTimeTriggers.map((row: { tgname: string }) => row.tgname),
}, null, 2));
if (!ok) process.exit(1);
