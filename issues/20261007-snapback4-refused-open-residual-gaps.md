# Snapback 4: a refused open can still change a store in three remaining cases

- Opened: 2026-10-07
- Area: Snapback 4 store opening and adoption: `snapback4-core` `Engine::open`/`new`/`new_release`, the SQLite store, and the native device opening path
- Source: lane RS round-1 review (Astra), `~/sb4-intent/reviews/rs-r1.astra.md` with reproductions in `rs-r1.astra.evidence/REVIEW.md` on eb1000

## Context

Lane RS restored the darwin fence: a refused adoption no longer creates `_read_sessions`. It also closed a PostgreSQL version race, a WAL checkpoint on refused opens, and a native upgrade that committed before its refusal. The review then found three more gaps in the full guarantee, "a refused open or adoption never changes the store's bytes". They are residual holes, not regressions introduced by RS:

1. **SQLite version race.** A waiting `Engine::open` accepts a concurrent change of the stored version to `future-store` and installs `_effect_steps`. This is the SQLite analogue of the PostgreSQL race RS fixed.
2. **Server refusal after commit.** With an unreadable `_meta.store_id` (for example the SQLite BLOB `X'80'`), `Engine::open`, `Engine::new` and `Engine::new_release` return `Sql(InvalidColumnType…)`, but only after installing `_effect_steps`. `new_release` also leaves `_meta.release = '1'` committed. All six combinations of entry point and WAL or DELETE mode reproduce this.
3. **WAL growth during rollback.** A large legacy migration followed by a native refusal keeps logical data and the main file byte-identical, but grows the WAL from 8,272 to 11,470,112 bytes (dirty-page spill).

## Expected

- Recheck the version, and everything the decision depends on, under the same lock or transaction, as RS did for PostgreSQL.
- Complete every fallible construction read inside the accepting transaction, before any upgrade commits. Add malformed-metadata regressions, including the release pointer.
- Decide the WAL-byte contract: either avoid pre-acceptance writes that spill, or state the narrower guarantee (logical data and main-file bytes) explicitly in LLP 3000.033 and the fence. Add a spill-sized regression.
