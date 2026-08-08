# Review: derived-fork requalification round 3 (delta), commit 03f9d147c

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-07
**Redacted:** no
**Reviewed commit (round-3 qualification C):**
`03f9d147cbf6798de2f74467cf5a2a3d8d3d756a`
**Implementation tree SHA-256 (v3 scoped):**
`sha256:582ed92c5aa69e1aac52a009e95680131de6f743b713035e29d2eec90602bed5`
**Digest version:** `snapback:agent-safe-implementation-tree:v3` (scope
unchanged from round 2: roots `src`; files `.gitmodules`, `Cargo.lock`,
`Cargo.toml`, `build.rs`, the two checker scripts, the selection-policy
file, `vendor/ibex`)

**Method:** declared **delta round** on my round-1 and round-2 heads. I did
not read any codex review; the new finding was restated neutrally in the
commission — it is the sharp edge under my own round-2 N1 note (the pinned
`accepted 2026-08-06` author line and 2026-08-06 evidence locators made a
truthful fresh acceptance inadmissible without backdating or rewriting
retained history). I read the complete `622d61b9f..03f9d147c` delta on the
scoped surface plus the out-of-scope bench emitter change, re-derived the
digest with this C's own checker, and re-ran the Node suite. No Rust
execution in this worktree; the bench-emitter unit tests are
supervisor-supplied execution evidence.

**Commit identity note.** The commission names `2d4d276d9` and `3c50c970e`;
the landed commits are `c24ee93e1` and `03f9d147c`. `git patch-id --stable`
is identical for both pairs (`c48b2462…`, `f9303a60…`) — same changes
pre-rebase. No content discrepancy.

---

## Execution evidence produced in this worktree

- Digest recomputed with this C's checker:
  `sha256:582ed92c5aa69e1aac52a009e95680131de6f743b713035e29d2eec90602bed5`
  — matches the commissioned digest exactly.
- `node scripts/check-agent-safe-publication.mjs` on the clean tree:
  both records `withheld` — correct posture.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: **95/95 pass**
  (was 90; +6 new tests, one of which folds an assertion set into an
  existing P-vs-C test).
- Scoped-surface delta enumerated: exactly
  `scripts/check-agent-safe-publication.mjs` (the dating fix),
  `src/manifest.rs` (one pinned local-persistent-store carrier digest
  constant, `d16beecff` — the Delete-admission client change rotated the
  pinned `local-read-admission.mjs` digest; not fork-relevant), and the two
  digest-excluded allowlisted store JSONs. `generated-artifact-policy.mjs`,
  the selection-policy file, `src/instance_fork.rs`, `src/cli.rs`,
  `Cargo.*`, `build.rs`, `.gitmodules`, and the `vendor/ibex` gitlink are
  byte-identical to round-2 C. The bench emitter change
  (`tests/instance_fork_bench_v1.rs`) is outside the digest, as evidence
  tooling should be; its output is bound at validation time instead.

---

## (a) Is my N1 fully resolved — truthful dating *enforced*?

**Yes.** The resolution is structural, not a date bump:

- The four current-evidence locators (both platform benches, bounds
  ratification, author acceptance) are now **dated append-only patterns**,
  not pinned paths. A current v3 receipt must cite
  `instance-fork-lifecycle-bench.<date>.<platform>.v1.json` /
  `author-acceptance.<date>.v3.json` where the date (i) is a valid
  calendar date, (ii) is `>=` qualification C's commit date, and (iii) the
  path **did not exist in the tree at C** (`git ls-tree` empty) — so
  evidence must be freshly allocated after C, under its real date.
- The author line is no longer a frozen 2026-08-06 string: it must read
  exactly `Charlie Cheever — accepted <locator-date>` where the date is
  parsed from the acceptance's own locator. A missing/invalid locator date
  yields `accepted undefined`, which can never match — fail-closed.
- The historical 2026-08-06 chain is retained as
  `DERIVED_FORK_HISTORICAL_EVIDENCE` for legacy withheld v1/v2 receipts
  only; a v3 receipt cannot cite it: the historical acceptance filename is
  `.v1.json` (the v3 pattern requires `.v3.json`), and the historical
  bench dates both predate C's commit date and exist at C — each refused
  independently.
- P-vs-C custody: fresh dated evidence paths are admitted with status `A`
  only; `M` refuses — dated evidence is append-only through the
  publication window too.

So a truthful fresh acceptance is now the *only* admissible shape:
backdating fails (ii), reusing history fails (i–iii) plus the pattern, and
rewriting the retained artifact is not a path to admissibility at all. The
ceremony deadlock my N1 described (any checker edit after C rotates the
digest) is dissolved because the checker no longer needs editing at mint
time — the dated patterns absorb whatever honest date the ceremony lands
on. This is enforcement, not permission.

## (b) Date arithmetic soundness

- **Calendar validation** (`validIsoDate`): strict regex plus a
  UTC-anchored `Date` round-trip through `toISOString` — rejects
  `2026-02-30`, `2026-13-01`, and non-leap `02-29`; accepts real leap
  days. The `T00:00:00Z` anchor means the host's local timezone cannot
  perturb the round-trip. Sound.
- **Ordering**: `locatorDate >= commitDate` compares zero-padded ISO
  strings, where lexicographic equals chronological. Sound.
- **Emitter UTC date** (`utc_date_from_unix_days`): Hinnant
  civil-from-days over `epoch_secs / 86400` — timezone-free by
  construction. I verified the algorithm's arithmetic (era/day-of-era/
  year-of-era derivation, the `mp < 10 ? 3 : -9` month fold, the
  `month <= 2` year increment) and its unit anchors (day 0 →
  `1970-01-01`; day 10 957 → `2000-01-01`, which correctly counts the 7
  leap days in 1970–1999). All intermediate values are non-negative for
  post-epoch inputs, so Rust's truncating division matches the algorithm's
  assumptions. Sound.
- **The one genuine timezone seam**: the C-side date is
  `git show -s --format=%cs`, which renders in the **committer's recorded
  offset**, while the emitter mints **UTC** run dates. Two consequences,
  neither exploitable:
  1. *Committer offset ahead of UTC* (e.g. +14): `%cs` can be one day
     ahead of the UTC date, so truthful same-instant evidence is refused
     until UTC midnight catches up — a false refusal of up to ~14 h,
     fail-closed (R3-1 below, papercut).
  2. *Date-granularity looseness around midnight*: evidence minted
     earlier on the same calendar day as C — before C existed — passes
     the date check. This is backstopped where it matters: both platform
     bench artifacts must carry `environment.commit === C` exactly
     (line 1851), which cannot be truthfully satisfied by a pre-C run,
     and the acceptance binds C, the digest, and the review-history heads,
     none of which exist pre-C. No forgery path opens; no truthful path
     closes (in UTC-or-behind timezones, which is where this repo
     commits).
- No upper bound on locator dates (a future-dated locator would pass) —
  note R3-3; the emitter can't produce one and the acceptance date is
  review-visible.

## (c) Do the six new negatives bite?

Yes — each pins the specific refusal string of the code path it attacks,
and all run in the green 95: (1) historical `.v1` acceptance locator
presented as the current v3 acceptance → `evidence 12 drifted` (pattern
mismatch); (2) author line date ≠ its own locator date → acceptance
drifted; (3) acceptance locator `2026-08-06` against a `2026-08-07` C →
the exact predates-C message; (4) locator path already present at C →
the append-only message; (5) platform/bounds locators reusing pre-C dated
history → evidence-bytes drift naming the fresh `2026-08-07.v3` path; (6)
the positive control: fresh dated evidence paths do not move the v3 digest
(they are outside the scope), plus per-path `A`-allowed/`M`-refused
assertions for every current dated locator. The emitter side adds two
supervisor-run Rust tests: the UTC anchors and an exclusive-create
overwrite refusal that proves retained bytes survive
(`ErrorKind::AlreadyExists`, original content intact).

## (d) Regressions to round-1/round-2 closures

None found. The canonical-scope deep-equality refusal (line 1191), the
admitted-gates mirror and its committed-record/trigger checks (lines
101/745), the v3 acceptance's explicit `implementationScope` and
`residualV2DepartingClass` bindings (lines 2075–2092), the frozen-per-round
prose bindings, and the closed 12-round legacy enumeration are all present
and untouched; the review-validation changes are pure path indirection
(locators now read from `receipt.evidence[i].path`, constrained by
`currentDerivedForkLocatorMatches` to the exact historical review paths —
correct, since the review artifacts legitimately accrue rounds under the
prefix-freeze discipline, and `LEGACY_REVIEW_VERDICT_CODES` keys off the
same paths). `install_app_root_identity_sync` and the atomic-write surface
are byte-identical to round 2.

## (e) Anything else in the scoped delta

Only the `src/manifest.rs` one-line digest-pin refresh (covered above) and
the digest-excluded store carrier/anchor JSONs. Nothing else.

---

## Findings (all non-blocking)

**R3-1 — Low. `%cs` committer-timezone date vs UTC emitter dates.** A
qualification C committed from a UTC-ahead timezone falsely refuses
truthful same-UTC-day evidence until UTC midnight (fail-closed papercut;
this repo commits at `-0700`, where the seam is harmless). *Resolution:*
derive the C-side date from the committer epoch in UTC
(`--format=%ct` + the same civil-from-days arithmetic, or
`--date=format-local:` with `TZ=UTC`), next time the checker legitimately
rotates.

**R3-2 — Low-Medium. Historical 2026-08-06 evidence bytes are still
mutable through the P-window allowlist.** The four historical locators
remain in `PUBLICATION_CYCLE_ALLOWLIST`, and `allowedPublicationChange`
checks `PUBLICATION_ONLY_PATHS` **before** the dated `A`-only branch — so
a post-C `M` of a retained 2026-08-06 bench or acceptance file is still
admitted by P-vs-C custody. Substitution into a current claim is fully
refused (see (a)), so no forgery follows; but "historical artifacts
preserved byte-for-byte" is presently review discipline, not machine
custody, and the requalification ticket's own constraint is that old
records are never rewritten. *Resolution:* reorder the dated-pattern
branch ahead of the allowlist branch in `allowedPublicationChange` (this
freezes the three bench paths: pattern-matched, `M` refused, `A`
impossible since they exist at C) and consider a pattern for the retired
`.v1` acceptance; the reorder touches change admission only, not digest
exclusion, so neither record's digest moves at this C — but landing it
later rotates the checker, so schedule it with the next legitimate
rotation (with R3-1).

**R3-3 — Note. No upper bound on locator dates.** A future-dated locator
would validate; the emitter mints only real UTC run dates and the
acceptance date is a human-reviewed field. Harmless today; a
`<= today-UTC` guard would be cheap alongside R3-1.

---

## Verdict

The round-3 fix closes the acceptance-dating blocker the right way:
truthful dating is now the only admissible shape — enforced by calendar
validation, C-relative ordering, append-only existence checks, the
derived author line, and A-only publication custody — while the retained
2026-08-06 chain stays citable only by the withheld legacy receipts it
belongs to. The date arithmetic is sound end to end, with one benign
timezone seam and one residual history-mutability papercut, both
fail-closed and both scheduled work rather than holes. All round-1/round-2
closures stand untouched, and the rest of the scoped delta is one
unrelated digest-pin constant. Conditional on the supervisor-supplied
dual-platform execution evidence (fork suites, the two new emitter tests,
and the row-13 bench) green at exactly
`03f9d147cbf6798de2f74467cf5a2a3d8d3d756a`:

**Verdict: READY** — no blocking findings; R3-1/R3-2/R3-3 are non-blocking
hardening to ride the next legitimate checker rotation.
