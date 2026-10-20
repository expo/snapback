# Integration 19 — Snapback 4 0.4.35

Completed in `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`.
Committed locally; **not pushed or published**. Qualification source:
`a3f0274d4ed0f8e92a18097cb5443d03d2c6d3e1`. The final evidence commit changes reports only.

## Ordered integration and release

Started clean at `8b1b688190`, fetched origin, and ran the requested ff-only
main merge. Each lane report was read before its no-ff merge. Root report
conflicts kept the integration side; this report replaces all checkpoints.

| Lane | Merge | Integrated change |
| --- | --- | --- |
| QRY | `15a2f9df83` | Partial-branch returns, shared return reservations and hidden lookup semantics. |
| DX4 | `dca77a9be8` | Staging discovery, upgrade warnings, dev/upload/retry fixes and local production lifecycle. |
| SEC4 | `1fef5e95e8` | Independent invariants, generated fixtures/campaigns, test discovery, audit/coverage, check speed and wave-19 security addendum. |
| COLR | `04995606ae` | Column-level read rules, omitted protected properties, compiler/prover/audit/client support. |
| DORM | `0634834e5b` | Reverse projections, dormant visibility, honest checks, forward backfills, SQL inspection, column rename and argument aliases. |

The parallel public 0.4.33 records (`312e6def3d`) were merged in `b909b02cd9`.
A later unrelated Postgres research commit on main was outside this integration.
No publication worktree, forbidden publication output or other existing worktree
was touched. The prescribed Exact scratch clone was used separately.

Separate bump **`9ec63002ee991a70dd5d028280262b5391c56e47`**:
`snapback4 0.4.35: column privacy, reversible old views and invariant quality`.
Its ten files/23 replacements match `77dd50092f`; the independent `log`
dependency stays at 0.4.34. One coherent 0.4.35 CHANGELOG entry explains all lanes
and upgrade effects. Existing apps do not acquire column policies, inverse
backfills or privacy declarations automatically. The migration-history format-7
custody is documented, including older-CLI refusal and backup expectations.
LLP 3000.037 §20.3 extends the day-two bakeoff from the supplied wave-19 analysis
and describes what 0.4.35 changes; historical timings are not claimed as .35 results.

## Integration corrections and review

Integration `8dbe9ece2b`, release-precondition regression `7dff38691a`, and wasm
ratchet/survey producer `1c59daa995` precede the review fixes:
`138d61dcbf`, `fdd5b61fbb`, `5db382795c`, `8e1fa93bcd`, `2152289f46`,
`f5d010c3f0`, `750c8fc94e`, `9a080a38b4`, `ffce9018f6`, `8f68ff23e0`.

Column rules and independent column invariants now share the prover, audit,
privilege/effects analysis and generated campaigns. Omission is distinct from
nullable storage through scalar reads, whole rows, nested spreads and defaults.
Every accepted argument spelling participates in alias availability and old-client
compatibility. Deploy/rollback previews combine security, client differences,
backfills and visibility in one report. Local lifecycle fixes retain release-path
lock and stop behavior.

Reverse migration repairs preserve newer-source staging, exact native preimages,
inactive receipts, scalar-only custody, reference-input lifetimes, absent cells,
narrowed/retired images and dormant overlays. Eligibility includes already-hidden
rows; incoming native receipts take precedence over leaving projections. Native
edits and expired/pruned evidence refuse rather than silently replace data.
Source indexes rebuild lazily for applicable expressions; raw existence admission
validates plain/prefix/range indexes. Governing LLP 3000.000.000 §19.1 and the
current deploy guide explain the resulting contracts. All 111 migration tests pass,
including the 64-seed, twelve-step, eight-variant release walk.

Eleven independent review rounds produced verbatim Muse and fresh Codex artifacts
with briefs and provenance in [llp/reviews/integration19](llp/reviews/integration19/).
Round eleven marks the same product revision `8f68ff23e0` READY in both families.
No author acceptance is inferred. `ad0309c8cd` subsequently corrects test witnesses
and regenerates the delivery await census. `a3f0274d4e` only soft-wraps two guide
paragraphs to satisfy the existing rules/deploy budgets (374/280 lines); paragraph
words and every fenced program are identical. Equivalence records accompany the
final evidence. The full source checks and packed consumers reran after that fix.

## Final Linux verification

- Exact requested five-crate `cargo test ... --no-fail-fast`: **6975 passed,
  0 failed, 45 existing ignores across 438 result groups.
  This is one complete run after the last fix. Earlier interrupted/superseded
  attempts are not counted. No flaky rerun is substituted for a red full run.
- Full ordinary client pool: 423 files in one invocation, then both full models
  (5,000 app-session / 3,000 online sequences), plus fixture wrapper tests.
  Total **7845 passed, 0 failed, 56 platform skips** across
  7901 tests. Native TAP and actual per-file exits agree. The final CLI
  was pinned inside this checkout so upgrade helper lookup is exercised correctly.
- Native differential `run`: 20,000 cases / 1,222,111 executions, zero disagreements.
  `run-devices`: seeds 0–999 / 27,922 executions, zero disagreements.
  `run-lean`: 20,000 cases / 56,917 executions; 16,697 pass, 3,173 unsupported,
  130 mismatches. The exact base `8b1b688190` reproduces all four signatures and
  counts: code E_RULE/NOT_FOUND 3; continuation-next 35; next 67; prelude-code 25.
  **No new signature or count increase.** Required column-rule Lean witnesses: 3/3.
- Fresh official `publish.mjs --prepare-client --prepare-directory` pack followed
  by `qualify-linux.mjs --consumer-only`: green. Twelve frontend proofs, six
  starters, actual Ubuntu 24.04 and Alpine consumers via proot, and every merged
  production/regression/security/migration/staging/DX4/rule/client-recipe proof.
  All eleven new dormant cases passed, including rename and old argument mapping.
  Consumer-only avoids the explicitly forbidden full `scripts/test.sh`; the
  five-crate/client suites are independently green. `publicationQualified` remains
  false: this integration does not claim a publication receipt.
- Root prescribed frozen Bun install, hoist and generated-artifact setup completed.
  Inventories: 365 package tests / 35 script tests / 31 demos / 487 publication leaves.
  Guide: 22 pass, 0 fail, 0 skip, 0 missing preconditions; 162 pages / 1,937 snippets.
  Its 121 inherited warnings are recorded. Ref-check: 556 LLP docs / 12,144 refs,
  zero errors and zero unchecked. Diagnostics registry and guide manifest were
  producer-regenerated; final checks confirm the complete chain.
- Docs budget: README 319/320 lines; exact named self-containment test ran and passed.
  RULES4 authoring census producer: 872 items / 72,262 bytes, byte-identical.
  Delivery await boundary regenerated for 147 source files; all 213 actual fault
  sites remain unchanged. No generated file was hand-merged.

The initial unbound client attempt selected an old 0.4.28 CLI and is invalid as
merged verification. That binary is preserved recoverably outside the source
checkout. Superseded mixed/interrupted client logs are also excluded. The first
packed attempt hit strace PTRACE_LISTEN EIO; subsequent complete qualification
passed with listener auditing enabled. Test witness corrections retain their
assertions (idempotent auth recipe, honest rollback wording, qualifier refusal
mocks, and fresh HTTP connections after synchronous long CLI previews).

## Survey, upgrades and Exact

The final pinned merged binary accepted **250/250** unchanged original schemas:
wave 15 = 100, waves 16/18/19 = 50 each. Zero refusals and zero false refusals.
[survey.json](snapback4/reports/integration19/survey.json) records per-wave and total
counts by code, distinct affected-app counts and original source hashes. All
compilation occurred in owned scratch copies.

The public registry supplied exact `snapback4@0.4.33` and
`snapback4-expo@0.4.33` installs. A fresh Expo app was checked at .33, then the actual
merged CLI `upgrade 0.4.35 --json` adopted the final prepared core/Expo/platform
packs through a local metadata proxy (unpublished .35 bytes; all other metadata
forwarded to the public registry). Exact .35 pins, check, TypeScript and the
installed CLI without an override pass. Artifact hashes match final packed
qualification. No package was published.

The store upgrade used a read-only SQLite backup of wave-19 lane039 deploy plus
its release history. Published .33 first rolled it back to release 1, creating
dormant rows. The merged .35 build adopted it, performed honest checks and two
forward/rollback cycles, restored authoritative rows exactly, and exposed 52
dormant jobReviews rows through `sql --dormant`. The original store is untouched.
See [upgrade.json](snapback4/reports/integration19/upgrade.json).

Exact was cloned cleanly from Exact2 origin/main at
`bacf31a8e0160908c9fd84b44bf8ac5b28f60683` under
`~/sb4-loop/prewave19/exact2`, containing EX10 `contract migrate`. Its only local
adaptation redirects core/device/lang dependencies to merged .35 source, with a
lockfile refresh; the exact diff/digest is recorded. Fresh synced and online apps
created in this session both pass the final binary/client recheck (two web tests
each, including offline behavior and refused domain writes respectively).

For each app, the final commands were: parent `npm install` of the prepared core
pack; in the app, `bun exact.mjs snapback --port PORT`,
`bun exact.mjs contract migrate app.contract`,
`bun exact.mjs contract types app.contract -o app.contract.d.ts`, then
`bun exact.mjs test web --backend http://127.0.0.1:PORT` against the pinned merged
`dev --port PORT --no-watch` backend. Ports: synced 26990, online 26991.
[exact.json](snapback4/reports/integration19/exact.json) records exact commands,
working directories, exits, binary/client digests and the manifest adaptation.

## Wasm, deferrals and evidence

Final wasm: **2,404,722 raw bytes; 733,690 gzip bytes**.
Budget: **734,190 gzip bytes = measurement + 500**.
The whole-artifact change from Integration 18 is +18,880 raw / +6,677 gzip bytes:
column omission/projection, shared query branch reservations, argument-alias
metadata and the .35 stamp. Server-only reverse custody is absent from the device.
Strict family/server-only/Unicode absence attribution passes; no runtime ceiling
was raised.

**Mac checks were not run.** The designated Mac Studio repeatedly timed out on
SSH port 22 for well over the allowed one-hour threshold. Attempts are recorded
in summary.json; no black M5 or alternate Mac was used. Darwin/platform-sensitive
clients, affected Mac Cargo targets and the Expo native witness remain unverified
for this integration. Lane evidence is not substituted. This is the sole required
platform deferral under the explicit unreachable exception. Lean's reproduced
baseline mismatches and existing platform skips/ignores are stated above.

Sanitized, hash-bound summaries are in
[snapback4/reports/integration19](snapback4/reports/integration19/).
Raw logs, packs and private test-store copies remain in
`/home/ccheever/sb4-loop/integ19/`. Every shell launch has a timeout; Final Cargo runs
inherit no incremental compilation and zero dev/test debug settings. All local
integration commits use the requested Charlie Cheever identity. No push was run.
