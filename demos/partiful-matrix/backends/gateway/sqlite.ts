import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';

import seed from '../../shared/seed.json';

export function createSqliteAdapter(filename = resolve(import.meta.dirname, 'partiful-matrix.sqlite')) {
  const db = new Database(filename, { create: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, emoji TEXT NOT NULL,
    description TEXT NOT NULL, location TEXT NOT NULL, starts_at INTEGER NOT NULL,
    host_id TEXT NOT NULL, host_name TEXT NOT NULL, accent TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS rsvps (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT NOT NULL,
    guest_name TEXT NOT NULL, status TEXT NOT NULL,
    UNIQUE(event_id, user_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, author_id TEXT NOT NULL,
    author_name TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);

  const insertEvent = db.prepare('INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertRsvp = db.prepare('INSERT OR IGNORE INTO rsvps VALUES (?, ?, ?, ?, ?)');
  const insertPost = db.prepare('INSERT OR IGNORE INTO posts VALUES (?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const row of seed.events) insertEvent.run(row._id, row.title, row.emoji, row.description, row.location, row.startsAt, row.hostId, row.hostName, row.accent);
    for (const row of seed.rsvps) insertRsvp.run(row._id, row.eventId, row.userId, row.guestName, row.status);
    for (const row of seed.posts) insertPost.run(row._id, row.eventId, row.authorId, row.authorName, row.message, row.createdAt);
  })();

  const eventRow = (row: any) => ({
    _id: row.id, title: row.title, emoji: row.emoji, description: row.description,
    location: row.location, startsAt: Number(row.starts_at), hostId: row.host_id,
    hostName: row.host_name, accent: row.accent,
  });
  const rsvpRow = (row: any) => ({ _id: row.id, eventId: row.event_id, userId: row.user_id, guestName: row.guest_name, status: row.status });
  const postRow = (row: any) => ({ _id: row.id, eventId: row.event_id, authorId: row.author_id, authorName: row.author_name, message: row.message, createdAt: Number(row.created_at) });

  return {
    backend: 'sqlite',
    async query(name: string, args: Record<string, unknown>) {
      if (name === 'listEvents') return db.query('SELECT * FROM events ORDER BY starts_at').all().map(eventRow);
      if (name === 'eventDetails') return db.query('SELECT * FROM events WHERE id = ?').all(String(args.eventId)).map(eventRow);
      if (name === 'guestList') return db.query('SELECT * FROM rsvps WHERE event_id = ? ORDER BY rowid').all(String(args.eventId)).map(rsvpRow);
      if (name === 'eventWall') return db.query('SELECT * FROM posts WHERE event_id = ? ORDER BY created_at').all(String(args.eventId)).map(postRow);
      throw new Error(`unknown query: ${name}`);
    },
    async mutate(name: string, args: Record<string, any>, userId: string) {
      if (name === 'createEvent') {
        const id = `event_${crypto.randomUUID()}`;
        db.transaction(() => {
          insertEvent.run(id, args.title.trim(), args.emoji || '✨', args.description?.trim() || '', args.location.trim(), args.startsAt, userId, args.hostName, args.accent || 'tangerine');
          insertRsvp.run(`rsvp_${crypto.randomUUID()}`, id, userId, args.hostName, 'host');
        })();
        return id;
      }
      if (name === 'rsvp') {
        const current = db.query('SELECT * FROM rsvps WHERE event_id = ? AND user_id = ?').get(args.eventId, userId) as any;
        if (current?.status === 'host') throw new Error('the host is already going');
        const id = current?.id ?? `rsvp_${crypto.randomUUID()}`;
        db.prepare(`INSERT INTO rsvps (id, event_id, user_id, guest_name, status) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(event_id, user_id) DO UPDATE SET guest_name = excluded.guest_name, status = excluded.status`)
          .run(id, args.eventId, userId, args.guestName, args.status);
        return id;
      }
      if (name === 'postMessage') {
        const id = `post_${crypto.randomUUID()}`;
        insertPost.run(id, args.eventId, userId, args.authorName, args.message.trim(), args.createdAt);
        return id;
      }
      throw new Error(`unknown mutation: ${name}`);
    },
    async cleanupAcceptanceEvent(eventId: string) {
      const event = db.query('SELECT * FROM events WHERE id = ?').get(eventId) as any;
      if (!event || event.host_id !== 'user_matrix_acceptance' || !event.title.startsWith('[acceptance]')) return false;
      db.transaction(() => {
        db.prepare('DELETE FROM posts WHERE event_id = ?').run(eventId);
        db.prepare('DELETE FROM rsvps WHERE event_id = ?').run(eventId);
        db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
      })();
      return true;
    },
    close() { db.close(); },
  };
}
