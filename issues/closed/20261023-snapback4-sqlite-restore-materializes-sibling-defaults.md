# Column restoration materializes sibling fields on both stores

Date: 2026-10-23
Status: Closed
Scope: Snapback 4 dormant-column restoration
Related: LLP 3000.009.001.000 §3.5; P1-EV-1 fix rounds 1–2

The round-1 reproduction was `{id,n,memo}` → retire memo and add
`extra: text <=100 ?` / `count: int default 7` → restore memo while keeping
the additions. Ordinary add-column leaves both siblings physically absent.
SQLite's restore walk materializes the predecessor and stores `extra = null`
and `count = 7`, including rows with no retained memo cell. Round-1 Postgres
kept those fields absent.

Resolution (lead ruling, 2026-10-23): SQLite's existing restore behavior is
the reference. Postgres now matches its stored bytes. Both stores materialize
predecessor optionals/defaults on restore; SQLite production is unchanged.
The old claim that interpreted query equality made the raw difference
unobservable was wrong: referenced-parent deletion records raw images, whose
size can widen `/changes`, and metered scans price canonical stored JSON.

`postgres_evolution.rs` compares literal `r.data` for this reproduction and a
300 KiB default, post-restore query meters, and parent-delete evidence. The
public EV-1 witness also compares `/changes` after the large-default restore.
Any future sparse-restore proposal must change both stores and qualify those
observable effects. There is no SQLite-only correction left in this ticket.
