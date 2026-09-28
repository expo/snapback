# Lane DG — audience and helper-bound diagnostics

Round 2 fixes the remaining query-cap gate and dedicated why pages, and
strengthens the job-caller traversal regression; see [ROUND2.md](./ROUND2.md).

Round 1 narrows the diagnostic scope after the Astra/Grok reviews; see
[ROUND1.md](./ROUND1.md) for the fixes, regression evidence and final checks.
The record below is round 0, including its historical failure ledger and
the job visibility presentation corrected in round 1.

Implemented LLP 3000.028 §§2.4, 4, 7.4 and 7.5 within the diagnostic lane.
Branch: `sb4-intent/dg-audience-bound-diagnostics`. First command was
`git fetch origin && git merge origin/main`; already up to date at
`a745b110f2187004abb1cec8380b33b6d1396108`. Nothing pushed or published.

## Changes

- M6 keeps both refusals and their codes. The explicit-sync syntax refusal
  now resolves source declarations across files before explaining the public
  inherited sync, no horizon, and conflicting explicit read. The narrow-read
  E_SYNC points at that read declaration. Both repairs describe their offline
  consequences. Neither suggests narrowing the public source.
- N_MAINTAIN_SYNCED and `why ownLikes` explain the horizon-free inherited
  audience and link `maintains` and `offline-interactions`. The new compiled
  card deliberately emits this note, with an exact guide-test assertion. It
  places the measured public replica census beside the limited owner-key pilot
  and clearly says the proposed source policy is not implemented.
- M8 retains E_QUARRY_BOUND at the helper read. A compiler-only call stack
  includes transitive query callers and their call sites; the message prints
  the original read and unpinned deciding columns. Job callers are discovered
  through helper calls for explanation, without granting any authority.
  `first 50` is explicitly a partial preview, with a cursor and separate name;
  the complete job remains subject to the whole-recipient chunk meter.
- The jobs card names its paged query `unreadPreview`; the bounds card and
  `why` code pages match. Inspection also found
  `why digest` printing the default 8,192-row ceiling and viewer-rule analysis
  for job scans. It now prints the actual 16,384-row job ceiling, system read
  authority, shared chunk meter and rollback of partial totals. No runtime
  ceiling or authority changed.

No core, device, wire, schema serialization, client runtime, dependency,
version or budget changes. Existing valid source retains its admission and
execution. The larger integrated social example, owner-key policy, history,
search and React/Expo lifecycle work are outside this lane; this report does
not claim all of LLP 3000.028 is implemented.

## Acceptance evidence

`experiments/p19-one-query/builder.q` is byte-identical to the supplied final
builder program. `inputs.json` records hashes of it, the run log, SQLite and
WAL. The originals were only read as bytes. The full store, WAL and assets
were copied with `cp -a --reflink=auto`, then made writable under this report's
ignored `.work/builder/`. No other lane's store or worktree was mutated.

The compiler regressions use the complete builder and reconstruct:

1. `ownLikes` with owner read plus explicit owner sync: E_QUARRY_SYNTAX.
2. `ownLikes` with owner read alone: E_SYNC.
3. The same two edits to `ownReposts`.
4. `digestPreview` calling the original `digestCounts`: E_QUARRY_BOUND at
   the original helper's `members[principal = reader]` loop.
5. An intermediate helper in that caller chain; the same job IR survives.
6. A source declared later in another file, with the read after the invalid
   sync line, proving the diagnostic is based on resolved declarations.

Both M6 repairs compile. The public repair keeps the original view schema;
`online only` keeps the original public source unchanged and removes the
view's sync. Original/new-compiler and original/baseline-compiler CLI checks
pass, with byte-identical generated API; all three P19 invalid edits retain their failure codes. CLI JSON and
`why` captures are retained in `logs/` and `cli-diagnostics.json`.

The job/preview tests use the complete builder schema, original helper and
unchanged job plus a separately named paged per-chat query. In the controlled
100-chat case, page one has 50 unread messages and a continuation; two pages
cover all 100 distinct chats and the job emits the complete total of 100.
An outsider gets no chats. A single recipient with 16,400 messages parks at
16,384 examined rows after six adaptive retries, with zero chunks committed,
zero writes, no effect and no emission key.

On the full copied calibration store, u0500 has 100 memberships. Two pages
produce 4,460 unread messages for `[1790563200000, 1790563319998)`; all 53
recipient payloads equal an independent enumeration of posts, follows,
members and live messages. The original job completes in 501 chunks, final
chunk size 2, five adaptive retries, heap peak 2,601,911 B, 53 writes. The
store initially retained `dev:replay=true`, suppressing payloads; the isolated
engine witness disables suppression **on the copy only** to inspect effects.
No worker, schedule driver, provider or network dispatch runs in this witness.

The copied-store census independently reproduces the guide's numbers:

| View | Rows | Logical stored row bytes |
| --- | ---: | ---: |
| ownLikes | 5,008 | 1,121,792 |
| ownReposts | 1,004 | 220,880 |
| Total | 6,012 | 1,342,672 |

These are tagged row JSON bytes, not indexes, transfer bytes or SQLite pages.
The 568-byte four-key pilot remains historical P19 evidence, not a projection
implementation or a lifetime bound. See `census.json`.

## Validation

Final affected checks: 273 tests pass across the 92-test whole guide, compiler/
runtime diagnostic targets and 74 CLI checks; the full-store witness separately
passes (1 test). The ordinary runtime target intentionally skips that external
store case. `affected-verified.log.gz` contains the whole guide and other affected
passes plus the older residency-text assertion before correction;
`guide-verified.log.gz` rechecks all 92 guide tests after naming `unreadPreview`;
`legacy-verified.log.gz` records all 40 residency, 22 ergonomics and 7 server-opt-in
checks passing after their assertion updates. `cli-verified.log.gz` is 74/74.
Root ref-check passes: 522 LLP documents, 9,750 references, zero errors or
unchecked references. Whitespace checks pass.

The requested single `scripts/test.sh` run exited 1. Its exact summary is:

```text
== 1 failure(s) in 1850 s
   cargo test
```

The Cargo stage reported four failing assertions, all **ours**, listed below.
That stage compiled before their final corrections; the final affected targets
pass. The full suite was not repeated. Every other stage passed: native and
wasm builds, docs budget, release guard, package build/typecheck, chat check,
chat/Expo typechecks, fixture tests, client tests and all 79 client model tests.
The client main run reports 3,845 passes and 10 existing skips; its separately
run acquisition/server shards also pass. The complete output is preserved in
`logs/test-sh.log.gz`. The elapsed total exceeds the documented 60-second
suite budget; no budget changed and no baseline timing comparison was run.

Commands use Node 24.13.1, Bun 1.3.14, Rust 1.97.0 and wasm-bindgen 0.2.127,
with eight Cargo jobs, Rust test threads 8, debug info and incremental off,
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, and fd limit 65,536.
No tool was installed; no shared path changed. The full suite uses its ordinary
Rust-test concurrency and host-load selection for client concurrency.

```sh
# From snapback4/, with the environment above:
cargo test -p snapback4-lang --test guide --test audience_bounds --test audience_bounds_runtime --test helper_placement --test maintains --test prefix_reads --test residency_notes
cargo test -p snapback4-lang --test ergonomics --test residency_notes --test server_opt_in
cargo test -p snapback4 --test check
DG_STORE="$PWD/reports/20260928-dg/.work/builder/.snapback4/store.sqlite" cargo test -p snapback4-lang --test audience_bounds_runtime copied_calibration_store -- --ignored --nocapture
bash scripts/test.sh
# From repository root:
./ref-check --verbose
git diff --check
```

The heavy copied-store case is explicitly ignored in ordinary runs because
its calibration input is external; it was run explicitly here and passed.
The test refuses a path outside this worktree's `.work` copy. The ordinary
runtime cases are part of the full suite. This lane provides native compiler/
engine and CLI evidence, not new browser or Expo lifecycle qualification.

## Failure ledger

All development failures below are **ours**, corrected before completion:

- Initial compiler build: an extra borrow around `Option::map_or` in the new
  source-site selection produced E0308. A retry repeated it because a path
  used during the repair wrongly included a second `snapback4/`; the corrected
  path and borrow fix passed. Logs: `affected-initial.log.gz`, `affected-2.log.gz`.
- Initial guide: missing new keyword in the entry lists, and the new longer
  guide pointer made an existing detailed explanation exceed 4,096 bytes.
  Added the lists and shortened its redundant summary without dropping facts.
- Next guide: the pinned expected keyword list needed the new card, and the
  prose budget was one word over. Updated the list expectation and shortened
  the added prose. A further affected run still reported the one-word budget
  overrun; final text is shortened further. No budget was raised.
- First new diagnostic assertions: two expected an unparenthesized explicit
  read and one expected the builder's bracket spelling. The diagnostic now
  prints the ungrouped read rule and uses the existing original-source map for
  the failed helper read. All three pass.
- First runtime assertions: the synthetic message fixture omitted its optional
  expiresAt field; the no-effects test queried a lazily absent `_effect_keys`
  table. Made the fixture explicit and count a missing key table as zero.
- First full-store comparison: the job correctly completed but the inherited
  replay setting suppressed every effect payload. Disabled replay on the
  isolated copy, used a distinct period end to avoid the earlier emission
  keys, and verified every payload. No product change was needed.
- Exploratory/setup commands also encountered nonexistent guessed source paths
  (parser maintain module, bind.rs, guide maintains.rs/E_SYNC.md, why module,
  jobs module and hook files), one duplicate-directory build-log path, a
  read-only copied-directory SQLite open, a tagged-JSON field lookup, and a
  guessed `_effects` table (the table is `_outbox`). Corrected through file
  discovery, copy-only permissions and the actual representations. No original
  evidence was opened in SQLite or modified.

The full Rust inventory also exercised three older exact-text checks and one
keyword discovery assertion that the first selected targets did not all cover:

| Test | Classification | Repair / final result |
| --- | --- | --- |
| `ergonomics::s10_s11_evidence_already_repaired_at_the_base_keeps_positive_cases` | Ours | Updated its expected named inheritance message and guide; target 22/22. |
| `residency_notes::maintain_sync_explains_inheritance_and_both_valid_choices` | Ours | Updated expected message/repair to the new contract; target 40/40. Also failed in the preceding selected run before this correction. |
| `server_opt_in::why_and_discovery_keep_the_opt_in_one_step_away` | Ours | Compare exact keyword tokens: `offline-interactions` contains the substring `actions`, but is not the gated actions card; target 7/7. |
| `guide::familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block` | Ours | The one-word navigation change described above; whole guide 92/92. |
| `check::w9b_new_maintains_share_one_note_without_pre_adoption_counts` | Ours, selected CLI run | Updated its expected no-horizon note; complete CLI target 74/74. |

The six baseline/current CLI refusals are **expected acceptance outcomes**, not
regressions. The release guard's deliberately refused build is also an expected
passing check. Full-suite baseline failures: **none**. Environmental test/build
failures: **none**. The single failed stage is the four corrected assertions
above; the complete suite is recorded as red, not retroactively called green.

## Wasm

Same-worktree, same-toolchain builds before and after:
**2,019,815 B raw / 585,384 B gzip**, delta **0 / 0 B**. The artifact is
byte-identical, SHA-256
`083297984d5d963d3d356ac1fb73fb4b05c3239f7a25ac6c69bc05f50185f625`.
The unchanged budget is **586,193 B gzip**, leaving 809 B. No wasm-opt was
installed or used. `wasm.json` and the baseline/full-suite build logs preserve
the measurements. Compiler diagnostics and CLI presentation add no device code.

## Orientation and handoff

Read LLP 3000.028 in full before editing; read the Snapback 4 agent sheet,
root/design brief, exclusions, journal and relevant compiler guide cards.
Applied `llp-orient` read-only from the initialized skill under lane-a5 because
this lane's vendor skill symlink was unpopulated. No skill installation or
other-lane modification occurred.

Scope: parser refusals, schema sync validation, helper prefix binding, residency
notes, CLI why and the current guide. Governing context:

- LLP 3000.028 §4 and §§7.4–7.5: source/caller chains and complete repair costs.
- LLP 3000.007 §5.2, §§6.7–6.8 and §20.22: caller placement, inherited audiences,
  fixture residency measurement and uniformly decided meter-bounded prefixes.
- LLP 3000 / LLP 2000.000 §§6–7: unchanged disclosure, logical meters and
  partition coverage. The Snapback 4 fence excludes Snapback 1 inventories.

The Snapback 4 root and applicable 3000.007/3000.028 documents are in current;
there is no Snapback 4 foundation entry. Rationale: a truncated preview cannot
replace a total, and a missing windowed key cannot prove absence. The code's
existing references remain applicable; implementation notes update 3000.028
in place. Handoff: none for these diagnostics; the remaining RFC capabilities
and integrated social/lifecycle example belong to their implementation lanes.

Commit trailer: `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
