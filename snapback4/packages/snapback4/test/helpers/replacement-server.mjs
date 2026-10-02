import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { devServer } from '../../../../witness/lib.mjs';
import { hangBudget } from './wait.mjs';

// @ref LLP 3000#publication-suite-under-contention — the fixture competes
// with the live server's writer. Copy one snapshot atomically, with a bounded
// asynchronous busy retry; a failed setup still owns and closes its server.
export async function replacementServer({ original, session, start = devServer, copyTimeout = 5000, onBusy = () => {}, ...options }) {
  assert.ok(Number.isFinite(copyTimeout) && copyTimeout >= 0 && copyTimeout <= 5000, 'copy deadline must be at most five seconds');
  const replacement = await start(options);
  try {
    const db = new DatabaseSync(join(replacement.app, '.snapback4/store.sqlite'));
    try {
      db.prepare('ATTACH DATABASE ? AS source').run(join(original.app, '.snapback4/store.sqlite'));
      const deadline = performance.now() + copyTimeout;
      for (;;) {
        let transaction = false;
        try {
          db.exec('BEGIN IMMEDIATE'); transaction = true;
          for (const table of ['_principals', '_sessions', '_principal_generations'])
            db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM source.${table}`);
          db.exec('COMMIT');
          break;
        } catch (error) {
          if (transaction) db.exec('ROLLBACK');
          if (![5, 6].includes(error.errcode & 255)) throw error;
          onBusy(error);
          if (performance.now() >= deadline)
            throw new Error(`TEST_REPLACEMENT_COPY: writer remained locked for ${copyTimeout} ms`, { cause: error });
          await sleep(Math.min(25, Math.max(1, deadline - performance.now())));
        }
      }
    } finally { db.close(); }
    const heads = await Promise.all([original.api, replacement.api].map(backend => fetch(backend + '/probe', {
      headers: { authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(hangBudget()),
    }).then(r => r.json())));
    assert.ok(heads.every(head => head.ok === true));
    assert.notEqual(heads[0].store_id, heads[1].store_id);
    return replacement;
  } catch (error) {
    await replacement.close();
    throw error;
  }
}
