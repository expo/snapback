# zb5 hot-baseline clone blocked: SQLite online backup never progresses

**Opened:** 2026-08-25 (P-B measurement battery, LLP 0209 G3-C arm)

The commissioned hot-arm recipe (`sqlite3 <src> ".backup <dst>"` against `demos/zerobugs/fixtures-local/hot-diag-baseline/`, read-only, primary server on 127.0.0.1:4290 untouched) hangs: after >5 minutes the destination is 0 bytes plus a 512-byte rollback journal. Reproduced independently by two separate runs (the killed 2026-08-25 P-B attempt ×2 and the redispatch ×1). Likely cause: the live server's long-lived connection holds the database in a state the online-backup API cannot drain while shared-load pressure keeps resetting backup progress, or the restore lock documented in the primary checkout.

**Effect:** zb5-hot A/B arms a–d are N=0; D2-H2 N≥3 requalification, D2-H3 hot-shape numbers, and G0-BCAST-BOUNDS hot observations are all blocked (`issues/20260824-g0-bcast-bounds-large-hot-observations.md` stays open; LLP 0268 B1 stays gated). Unblock paths: quiesce/checkpoint the primary during a maintenance window and file-copy; or regenerate an equivalent hot baseline from the pinned seed recipe into a fresh directory; or run the backup from a moment the server is stopped. Any substitute must be declared in the measurement report — no silent filesystem-copy of a live WAL DB.

**Status:** open.
