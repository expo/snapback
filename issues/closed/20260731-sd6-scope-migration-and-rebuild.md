# SD-6: the @expo/snapback-* scope migration, then slice 5-rebuild

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 2
**Confidence:** 4
**Severity:** P0
**Systems:** Packaging, Client integration, Code generation, Runtime,
Documentation, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-31
**Related:** LLP 0130, LLP 0115, LLP 0122, LLP 0041, LLP 0111, LLP 0074,
issues/closed/20260730-move5-runtime-qual-and-types-sweep.md
**Marker:** parity-moves, move-5, sd-6

LLP 0130 SD-6 (Charlie's standing decision, 2026-07-31) sequences the
npm scope migration after slices 5-qual and 5-types land and before
the starter/GA front-door moment. Both gates cleared 2026-07-31
(5-qual: `814acd77`/`63dacde2`/`5ac77b8d`; 5-types: `1f475864`), so
this ticket is ARMED. Decision 9 fixed the terminal scope as
`@expo/snapback-*` — the repository moved to the expo/snapback GitHub
org — with the `@snapback` org release request filed in parallel by
Charlie, gating nothing; if granted it becomes deprecation-stub
aliases pointing at @expo names, never a second migration.

Work items. (1) The scope migration itself, as its own serialized
landing: rename the publishing `@snapback/*` packages to
`@expo/snapback-*`, migrating everything LLP 0115's decision-9 note
calls a proof-system migration — the protocol name table, schema
consts, the cold-install preset, and ledger lineage — plus workspace
references, generated-artifact specifiers, guide/docs snippets, and
the export-types gate's inventory. Existing on-disk generated
fixtures regenerate rather than hand-edit. (2) Slice 5-rebuild after
or with it (LLP 0115 CV-1's exit clause: the external workout-arm
rebuild from published artifacts only), so the external-rebuild proof
binds the terminal name, not a throwaway alias. 5-rebuild's custody
inputs are already decided (decision 4: CLI-fold + published helpers;
decision 1: LLP 0074's parallel channel gate).

Sequencing constraint. The migration is a repo-wide rename: run it as
its own landing with no concurrent code lanes touching `packages/`,
after in-flight wave-1 lanes (C2 jobs, C6 move1) land. The
`check:export-types` gate and the package-test inventory gate are the
regression rails; both must be green on the renamed tree.

Exit. Every publishing package carries its terminal `@expo/snapback-*`
name with the proof green end-to-end; the external rebuild consumes
only published artifacts under the terminal names, satisfying LLP
0115 CV-1's exit; the `@snapback` alias question stays external
(Charlie's dispute) and gates nothing here.

## Execution record — work item 1 (2026-07-31, SD-6 lane)

Work item 1 (the in-repo scope migration) EXECUTED on the SD-6 lane
branch. Landing structure:

1. Baseline repair: canonical package-test inventory reconciled with
   the wave-1 lane landings (outbox-store, jobs-authoring,
   inline-helper-sharing, args-contract goldens, search-AST fixtures;
   127 -> 132) and the `live.wire-fixtures` formatVersion-3 pin fixed
   in the contract conformance block — both pre-existing cross-lane
   breaks found red on the base.
2. Rename + workspace: all workspace packages renamed to
   `@expo/snapback-*` (nine publishing + hosted-supervisor + private
   admin-client and publication-authority; decision and rationale in
   LLP 0041's dated revision), import specifiers, emitter constants,
   CLI templates/error strings, demo live sources, test fixtures,
   the package-test inventory ids, and the three bun.lock files
   (partiful native gains an explicit override pinning the nested
   contract semver to the local package).
3. Proof-system lineage: v4 lease/issue-request generation with the
   terminal name table (v2/v3 still validate the recorded
   `@ccheever/snapback-*` artifacts), `PACKAGE_NAME_LINEAGE`,
   `scopePreset`-keyed ledger/dependency validation
   (`identity` = terminal write-side; `ccheever` read-side only),
   terminal cold-install preset (`@expo/snapback-cli@latest`
   direct root), install-tree inspection and propagation witness
   generation-derived, GitHub proof repository slug
   `expo/snapback` for terminal evidence (a proof surface decision
   9's four-item list did not name; recorded in LLP 0041), and the
   frozen partiful step5 evidence pinned to the legacy generation
   in its test.
4. Regen: 18 demo backends, admin-ui bindings, CLI comparator
   fixture app, guide manifest/flat.
5. Docs/board: guide pages renamed + authoring-loop alias prose
   rewritten; dated notes in LLP 0041 (lead record), LLP 0113
   (authority co-amendment), LLP 0115 (Revised entry + CV-1 row).

Deliberate leave-behinds (records, not drift): recorded evidence
under demos/*/acceptance and final-confirmation trees, the frozen
backend-bakeoff work trees and protocol inventory, the
auth-invalidation composed receipt + its report prose (regenerates
together on the next genuine rerun), run-capsule legacy fixture
data, and all `llp/`/`diaries/` history.

Still open here: work item 2 (slice 5-rebuild) and the actual npm
publication under the terminal names — both explicitly excluded
from this landing and sequenced after it.

## Execution record — npm candidate publication (2026-08-01, publish lane)

The first real publication under the terminal names EXECUTED. All nine
`@expo/snapback-*` packages are live on the public registry at 0.1.7
under the immutable candidate tag `bakeoff-0-1-7-fdd49db8abf1`:
staging run 30684007891 (tree `fdd49db8`, both platform proofs green
after four real defects were found and fixed by the staged proof —
codegen tarball missing `search-request-schema.mjs`, stale comparator
fixture, missing TCP_NODELAY stalling Linux live frames, and the
browser-capture race), qualified ledger + both platform receipts
consumed unrestaged, every row's registry bytes verified byte-equal
to the staged digests, candidate tag verified selecting 0.1.7 on all
nine, closed candidate ledger emitted. Operational notes: npm applies
a ~15–20 min serving hold to each brand-new package name (PUT 200 +
receipt email, then packument 404 / web 403 until it clears) — the
per-row publish-then-verify loop serializes on these holds, so the
remaining uploads were fired in one batch (the exact staged tarballs)
and the canonical script run once after all holds cleared, verifying
every row via its skipped-already-published path. Ledger custody:
candidate + qualified ledgers preserved at
`~/snapback-release-ledgers/{candidate,qualified}-ledger-0.1.7-fdd49db8.json`
(committed home to be decided by the promotion/5-rebuild lane, which
consumes the candidate ledger). Charlie joined the npm expo org and
the publish used an org-scoped granular token; the `latest` tag is
untouched. STILL OPEN on this ticket: the leased promotion (moving
`latest`; needs the publication-authority lease) and work item 2,
slice 5-rebuild from the published artifacts.

## Execution record — leased promotion standup (2026-08-01, promotion/5-rebuild lane)

The first-time standup of the leased default-tag promotion was
attempted under Charlie's 2026-08-01 authorization and HALTED at
preflight by two deterministic fail-closed validation refusals,
reported per the lane's no-workarounds-on-validation rule rather
than edited around. NOT EXECUTED as a result: the promotion, the
authority standup, and the proof-matrix dispatch (work item 2).

Decisive registry observation first (read-only `npm view`,
2026-08-01): all nine `@expo/snapback-*` packages ALREADY carry
`latest: 0.1.7` beside `bakeoff-0-1-7-fdd49db8abf1: 0.1.7`. npm
assigns `latest` at a package's first-ever publication even under a
non-default `--tag` (the behavior `validatePriorDependencyAlias`'s
docstring anticipates); the 2026-08-01 publish verified the
candidate tag without observing `latest`. The material goal of the
promotion — the default vector at 0.1.7 — therefore already holds,
and only the leased lineage + promotion-bound proof matrix are
missing.

The two refusals (verbatim strings, both firing in promote's
preflight before authority acquisition and before any registry
mutation):

1. `snapback-promote: promotion requires a v3 lease bound to prior
   default closure evidence` — `scripts/snapback-promote.mjs:205`
   pins the v3 lease generation while the migrated authority issues
   only v4; every issuable lease is refused, and a v3 lease cannot
   exist for the terminal name table. Filed as
   `issues/20260801-promote-v3-lease-pin-refuses-v4.md` (P0; the
   pin predates the migration and was not bumped by `add06902`).
2. `snapback-promote: latest-root proof preflight refused:
   latest-root proof has no distinct signed prior CLI root` — with
   the observed prior vector all-`0.1.7`, the bootstrap case
   (prior == new) is categorically refused by `loadLatestProofPlan`
   and the proof-plan/barrier machinery. Filed with the standup
   prerequisites (committed+pushed ledger home for the proof plan;
   HTTPS-only authority origin needing local TLS termination) and
   the author decision on bootstrap lineage as
   `issues/20260801-first-latest-promotion-no-distinct-prior-root.md`.

External state: ZERO mutations by this lane — npm untouched (reads
only), no GitHub dispatch, no authority process started, no lease
requested or issued, and `~/.snapback-publication-authority/` was
deliberately NOT created so no permanent custody exists containing a
doomed (unacquirable-then-expired) first lease. Input-side
validation that creates no lineage ran green: the candidate ledger
`~/snapback-release-ledgers/candidate-ledger-0.1.7-fdd49db8.json`
revalidates (`validateCandidateLedger` OK; sha256 `d64d6bce…`;
scopePreset `identity`).

LLP 0115 CV-1 remains UNSATISFIED — no external rebuild ran; work
item 2 stays open. Unblocking order: fix the v3 pin (P0 ticket),
decide the bootstrap-lineage question (author decision ticket),
land the candidate ledger at a committed home on a pushed ref, then
either execute the first leased promotion (0.1.8+ with a genuine
prior) or dispatch the 5-rebuild matrix standalone per the decided
option.
