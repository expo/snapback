# Snapback 4: every in-memory store created a temp directory and nothing removed it — 4.5 million of them on one machine

Status: Closed 2026-09-19 — the source fixed on main (this landing; two-family blind review, GPT READY WITH CHANGES → applied, Grok READY). The host cleanup is a separate, running job: see "The cleanup" below for what was verified when
Priority: P1 for the host (every `mkdtemp`, sandboxed launch and `$TMPDIR` listing on the machine was timing out); no product defect
Date: 2026-09-19
Systems: `snapback4-core` `store.rs` (`Store::memory`, `prepare`), `assets.rs` (`Upload::write`)
Observed version: main through `0518ec9e76`; every published pin
Evidence status: reported by another project's session (a `/tmp` listing took 14 s; `$TMPDIR` would not list in 120 s); counted and attributed by execution

## Problem

`Store::memory()` chose an assets directory `temp_dir()/snapback4-<pid>-<ulid>` and
`Store::prepare` created it, owner-only, at once — for **every** in-memory store: every
`Engine::memory(..)` in every test, every `dev --memory`, every simulator and device fixture.
Nothing removed it. On this machine, after a week of suites: **347,130** such directories in
`/private/tmp` (processes without `TMPDIR`) and **4,146,028** in the user's `$TMPDIR`, from
13,048 distinct creator processes, 474 of them non-empty (dead `dev --memory` servers'
uploads, ~42 MB in all). One test binary leaves about 1,900. Their creation times are in
their ULIDs: 2026-09-12 to 2026-09-17 in `/tmp`, through the day of the report in `$TMPDIR`.

At that size the directory is pathological for everyone: a name lookup in it took ~17 ms
and a removal ~20–50 ms, so `mkdtemp`-based tests and sandboxed launches across the machine
timed out, and the cleanup itself runs for hours.

## Fix (this landing)

- `Store::memory()` no longer creates anything: the directory is created by the first upload
  (`Upload::write` now ensures its parent exists, owner-only), and `Store`'s `Drop` removes an
  ephemeral directory and whatever it holds. A file store's `assets/` beside the database is
  unchanged (created and made private at open, never removed). A reader handle never owns
  the directory.
- Regression: `an_in_memory_store_leaves_no_assets_directory_behind` (sim `security.rs`) — no
  directory before an upload, owner-only after one, gone after the drop.

A process killed by a signal still leaks its one directory per store that uploaded
something; that is one per server run, not one per engine, and the sweep below handles it.

*Review finding, applied:* an `Upload` is handed out without borrowing the engine, so one
written after the engine dropped recreated the directory and its drop removed only the
files. Now the upload knows the directory is ephemeral: it creates it only then, and an
uncommitted upload's drop removes the directory too when it is left empty (`remove_dir`,
never `remove_dir_all`, so a live store's other assets are untouched). A file store's
`assets/` is no longer touched by uploads at all. Regression:
`a_detached_upload_cannot_resurrect_a_dropped_stores_directory`.

## The cleanup, for the record

Delete list built from the names (a ULID's first ten characters are its creation time, so no
`stat` was needed): every `snapback4-<pid>-<ulid>` older than an hour whose pid is not a live
`snapback4` process; other `snapback4-*` names (publish stages, `loopbar-verify`, `test.`)
left alone. Removal in the 4-million-entry directory runs at 300–400 removals a second
(a name lookup there costs ~17 ms; six-way `rm -rf` gave 300/s, thirty-two-way `rmdir`
400/s), so the 4.5 million take hours. **As of this landing the cleanup is still running**
(detached, `~/projects/snapback-next-20260914/tmpdir-leak/cleanup-rest.sh`, log `rest2.log`);
the last line of that log records the count left in `/private/tmp` when it finishes, and
this ticket is amended then.

## Related

- `scripts/publish.mjs` also leaves `snapback4-publish-*` and `snapback4-publish-consumer-*`
  work directories behind (69 and 4 on this machine, the consumer ones holding a `node_modules`);
  small in number, filed here as a follow-up rather than fixed.
