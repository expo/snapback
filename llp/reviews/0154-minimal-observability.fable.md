# LLP 0154 minimal observability review — Fable family

## Round 3 — 2026-08-02

**Reviewer family:** Claude (Fable 5)
**Provider / runtime:** Claude Code `general-purpose` subagent
(`claude-fable-5`), fresh non-author session (distinct from rounds 1–2)
**Date:** 2026-08-02
**Redacted:** no (repository-local review)
**Method:** fresh non-author agent context, read-only instruction, over the
working tree; mutually blind — instructed not to read any `llp/reviews/`
artifact concerning LLP 0154, and the review states it did not. SHA-pinned
target verified by the reviewer. Design-partner framing per author
directive. Focused re-review of the v0.4 round-2 repairs.
**Target:** `llp/0154-minimal-observability.rfc.md` (827 lines, Draft, v0.4)
**Target SHA-256:** `564dbdd9786d79733c842403a97cb29f44618493ebb42e37ff0dbf7ff6f55036`
**Repo revision at review start:** `main` `4f7890eb` (target file untracked)
**Status:** completed
**Verdict:** NOT READY (2 MATERIAL, both localized repairs; converged
architecture explicitly endorsed — "should not be reopened"; READY after a
v0.5 delta with delta-only verification)

### Verbatim review (round 3)

1. **Overall assessment**

I verified the target at SHA-256 `564bdd…` (matches; 827 lines) and checked v0.4's load-bearing claims against the repository rather than taking the document's word: the substrate map is accurate (`src/server.rs` is 44,539 lines with exactly two `eprintln!` sites at server.rs:3848 and server.rs:20420, both genuinely background/terminal anomalies as D2 characterizes them; no `tracing`/`log` in Cargo.toml), the reset-incarnation authority D1 binds to is real (`src/storage.rs:265-273` "the one durable authorization-stream witness. The incarnation closes reset", rotated inside the reset transaction at storage.rs:930-932), the cron-rejection rationale is factually grounded (`META_CRON_STATE` persists in the app database, src/storage.rs:150 and 2712; LLP 0028's run ledger presupposes source-manifest definitions, llp/0028:18-19), the corrected authorizer description is now accurate (Ibex is allow-by-default denying only Attach/Detach/load_extension with refusal tests, vendor/ibex/src/host/abi.rs:3075-3091, 10832-10863; rusqlite `hooks` is indeed only transitive — vendor/ibex/Cargo.toml:59 has it, Snapback's Cargo.toml:33 does not), the sensitivity split matches LLP 0031 exactly (`OperatorMetadata` and raw `SensitiveApplicationData` including handler errors/source/arguments at llp/0031:186, raw types requiring `AdminSecretRead` at llp/0031:205), and the two-stage span matches LLP 0104's admission-bound semantics (occurredAt/attribution/budget bound at admission, llp/0104:67-77; "one accepted query, mutation, action…" llp/0104:99). The round-2 repairs are sound: each one I traced resolves the defect it claims to resolve without regressing a constraint. What remains is smaller in kind than what rounds 1–2 found — but two defects are above MINOR: the normative D2 schema stamps every row with admission-time `ts_ms` while the normative visibility view filters on `ts_ms`, which makes terminal records of long-lived spans (a week-old websocket's disconnect, an old subscription's teardown) invisible or badly mis-ordered at the moment they are written; and the Cloudflare arm ships C5-sensitive kinds into Analytics Engine, a store where the C5 apparatus (file permissions, generation fencing, deletion, AdminSecretRead-gated raw reads) structurally cannot follow, and the document does not say so. Both are one-field / one-paragraph repairs that do not disturb the architecture, but they sit in normative text of the document's own core constraint system, so I cannot honestly call them MINOR. Verdict: NOT READY

2. **Strengths**

- **The two-stage span + projection matrix (C4, D2) is the correct resolution of the round-2 metering incompatibility.** LLP 0104 really does bind attribution and budget at admission before outcome exists (llp/0104:67-77), so a terminal-only envelope could never have been the metering projection; the admission/terminal split with "exactly one record per class is billable" and a versioned registry stamped per row is the right shape, and the matrix's transport-request row ("carrier of a logical call") is consistent with 0104's chargeable-request definition (llp/0104:99).
- **Typed operations as the cross-target contract (D5, D8) is verified against the repo's own precedent.** LLP 0024's "one core, thin projections" rule (llp/0024:105-106) and the control MCP's actual 1:1 host-ops projection (`packages/snapback-cli/mcp-control.mjs:4-8`) make this the native pattern, and it genuinely dissolves the Cloudflare credential-locus contradiction — the worker writes, the control plane (which holds the credential under LLP 0072 custody) answers. The guide_mcp exclusion is correct (`src/guide_mcp.rs:3-8` is resources-only).
- **The generation protocol (D1) is bound to a real, durable authority with an honest crash matrix.** The reset transaction rotates the incarnation with a committed successor (storage.rs:930-932); binding telemetry generations to it and healing the reset-commit/telemetry-rebind gap at boot by pair comparison — rather than pretending cross-database atomicity — is exactly right, and routing *every* read surface including the SQL hatch through the visibility view converts a race into a filter.
- **The cron rejection (D4, Alternatives) is now factually load-bearing, not hand-waved:** cron state genuinely lives in the app database (storage.rs:150, 2681-2712), so flush-path maintenance is the only design that satisfies C1/C2/C5 simultaneously. The watermarked aggregate-before-delete ordering plus read-time retention enforcement is a clean separation of reclamation from the privacy boundary.
- **The corrected authorizer/rusqlite text (D5) is exactly right** — v0.4's "inspired by, and stricter than" framing with adversarial tests beyond the Ibex refusal set, and the explicit-feature-declaration note, both check out against the code.
- **Honesty engineering throughout:** the per-field variance envelope, the `_unmatched` sentinel with shed-first-by-construction, the `log` kind making the Logs page honest (`runtime.log` is a real host call, src/runtime.rs:1901), the C8 envelope decoupled from commercial tiers, the settle-write wording resolving the C2/boot-lifecycle contradiction, and the deliverable-4 self-report that `guide/capabilities.md` violates its own "never silent" GAP policy (verified: no observability row exists; policy at guide/capabilities.md:21-22).
- **Diagnostic seam scoping (D2)** — "emission boundary, not construction sites" — matches the code: diagnostics are pervasive typed refusal values (src/diagnostic.rs), severities are exactly `Info/Warning/Error/Fatal` (src/diagnostic.rs:11-20), and the details-carry-operator-context claim is documented in the source itself (src/diagnostic.rs:31-33).

3. **Concerns**

1. **MATERIAL — Terminal records of long-lived spans are invisible or mis-ordered under the normative visibility semantics.** Evidence: D2 defines `ts_ms` as "admission time" in the normative schema (llp/0154:381) and the terminal completion carries no timestamp of its own (llp/0154:350-352); the normative view filters `ts_ms >= now − max_days` (llp/0154:390-393) and `telemetry.events` orders by `(ts_ms, id)` (llp/0154:541-543). Consequence: a `ws_connect` or `live_subscribe` span outliving `max_days` (default 7) writes its terminal record *already outside the retention window* — the disconnect the D3 priority system explicitly reserves capacity for (llp/0154:463-465) is born invisible; even a three-day-old connection's disconnect lands three days deep in the Logs ordering, defeating the "recent past" product for exactly the long-lived kinds. Rollup hour-bucketing by admission time has the same wrinkle. Resolution: give records a write-time timestamp (e.g. `recorded_ts_ms`) stamped at persistence; key visibility, retention, ordering, and the freshness watermark on it; keep `ts_ms` as the admission-bound attribution timestamp per LLP 0104. One column plus three sentences.
2. **MATERIAL — The Cloudflare arm forwards C5-sensitive kinds into a store where the C5 apparatus cannot follow.** Evidence: C5 commits to duty-of-care handling — restrictive permissions, generation deletion semantics, AdminSecretRead-gated raw reads (llp/0154:245-253); D2 allows `log`/`diagnostic` details to carry source paths and handler text under the redactor (llp/0154:448-453); D8 says the worker "owns `writeDataPoint` only" with no statement of *which kinds or fields* cross into Analytics Engine (llp/0154:666-676). AE has fixed ~3-month retention, no deletion, no per-row read authority — generations cannot fence it and `AdminSecretRead` cannot gate what its account-scoped credential can query. Resolution: one normative paragraph in D8: the CF arm ships only closed classification fields (kind, name pattern, status class, duration, code) by default; `log`/`diagnostic` details and `_unmatched` raw paths are excluded, and the raw-read product (`telemetry.events` detail, Logs modal) is honestly `unsupported`/degraded on this arm unless a future decision changes it. This is a Phase-2 surface, but C5 is a Phase-1 constraint of this document, so the boundary belongs in this text.
3. **MINOR — "in-memory unrolled tail" is a contradiction in terms.** D5 says stats merge histograms "with the in-memory unrolled tail, so results are fresh to the last flush" (llp/0154:544-546) and D7 repeats it (llp/0154:622-624). The unrolled tail — rows above the watermark — is *on disk*; the in-memory content is the unflushed buffer, and including it would make results fresh to the last *event*, contradicting "fresh to the last flush." Say "the flushed-but-unrolled tail."
4. **MINOR — No span-stage discriminator in the schema.** The matrix has classes persisting "admission + terminal rows" (live subscription, llp/0154:361) but `telemetry_events` (llp/0154:375-388) offers no `phase`/record-type column; distinguishing the two rows of one observation only by NULL `status` is an implicit encoding the doc never states. Add a small closed `phase` column (`point|admission|terminal|joined`) or state the NULL-encoding rule explicitly.
5. **MINOR — The visibility view's parameters are unsourced.** The view needs `max_days` and "now" (llp/0154:390-393), but `max_days` is a config-store knob (deliverable 1, llp/0154:728-729) and the view is SQL inside the telemetry file, also opened out-of-process by the CLI hatch (llp/0154:568-570). Unstated: mirror `max_days` into `telemetry_meta` (it already holds generation) at boot/config change so server and hatch agree on the boundary, and note the view is rebuilt/parameterized accordingly.
6. **MINOR — "denying the base tables" naively breaks the view.** SQLite's authorizer fires read callbacks for a view's underlying tables during expansion; a literal deny-on-base-tables policy makes `telemetry_events_visible` itself unqueryable. The callback's innermost-view context makes the correct policy expressible (allow base-table reads only when attributed to the visibility/rollup views), but D5 (llp/0154:568-577) should say so — the adversarial-test deliverable would catch it, cheaper to catch it in text.
7. **MINOR — At-cap behavior can starve reclamation.** C8's file-size cap is "shed-on-full, counted" (llp/0154:270-271) and D4 maintenance is "post-flush" (llp/0154:489-491); if inserts shed because the file is at cap, it is unstated whether a fully-shed flush attempt still arms maintenance — if not, a long-running server at cap reclaims nothing until reboot. State that a shed-due-to-cap cycle triggers maintenance.
8. **MINOR — Drop-counter semantics are split.** D3 surfaces drop counters "since boot" (llp/0154:468-471) while D7 persists `drop_counters` in `telemetry_meta` (llp/0154:616-617). Say which is which (persisted lifetime counters vs. since-boot deltas) so the Health page and variance envelope mean one thing.
9. **MINOR — Priority-class trigger vocabulary is HTTP-centric.** "`status >= 500`" (llp/0154:462) is meaningful for `http_request` but undefined for `function_run`/`job_run` outcomes; the registry presumably defines a per-class failure predicate — say so.
10. **MINOR (environment note, not a document defect) — LLP 0148 is cited but absent from this checkout.** The Related list and D1/D2 cite the LLP 0148 grammar; that document exists on `origin/main` (`llp/0148-prefixed-identifiers.decision.md`, commits ee707fe8/74900baf) but is not an ancestor of this worktree's HEAD (4f7890eb). I verified the grammar from the origin blob (`prefix := [a-z][a-z0-9]{1,11}`, 26-char Crockford base32), and `gen_`/`obs_` fit; note only that new prefixes must be registered in 0148's registry, which the doc could state in deliverable 1.

What I could not check: all external landscape figures (PocketBase batch/flush/retention specifics, Convex/Supabase/PostHog/AE/Expo Observe claims) — the document correctly firewalls these as dated research the design "does not stand or fall on" (llp/0154:153-157). The C1 aside that asset-system commits bypass the change journal is only spot-checked (asset modules never reference `_snapback_changes`; 54 references all in storage.rs) — consistent, not proven. I did not read anything under `llp/reviews/` for 0154.

4. **Design proposals**

- **P1 (strong) — Dual timestamps: admission for attribution, recorded for observation.** Resolves Concern 1. `ts_ms` stays the admission-bound attribution timestamp (the 0104-aligned identity of the span); a `recorded_ts_ms` stamped at persistence drives visibility, retention, `telemetry.events` ordering, and the freshness watermark. Rollup bucketing should key on `recorded_ts_ms` too — it makes the watermark state machine strictly append-ordered (no late row can land behind an already-finalized hour keyed by old admission time), at the acceptable cost that a long span's terminal aggregates into the hour it *ended*.
- **P2 (moderate) — Make the span stage explicit in the store.** A closed `phase` column gives the projection matrix a concrete anchor in the schema, lets the OQ1 shared fixture pin admission-vs-terminal timing per class mechanically (it would have caught Concern 1), and makes `telemetry.stats` definitions unambiguous about which rows count (terminal/joined only, presumably) without relying on NULL-status inference.
- **P3 (moderate) — Promote `telemetry_meta` to the single read-boundary authority.** The server mirrors `max_days` (and the C8 caps that affect reads) into `telemetry_meta` at boot and on config change; the view is defined against `telemetry_meta` alone. The out-of-process CLI hatch then inherits the exact same generation *and* retention boundary with zero coordination — the same move D1 already made for generations, applied uniformly.
- **P4 (moderate) — Declare the Cloudflare arm classification-only by default.** Resolves Concern 2: the worker's `writeDataPoint` payload is a closed projection of non-C5 fields; raw-detail surfaces return `unsupported` on this arm. This also keeps the arm's story coherent with its appeal — writes only on traffic, nothing on the arm that needs deletion semantics the platform cannot provide.
- **P5 (exploratory) — Count shed-at-cap cycles as maintenance-arming events** (Concern 7), so the file self-heals under sustained pressure rather than at next boot only.

5. **Open questions**

- **OQ1** — Right gate, right mechanism. The shared deserialization fixture is the strongest single line in the deliverables: it converts "projection, not translation" from prose into CI. Recommend the fixture also pin per-class *record timing and timestamp semantics* (admission vs terminal vs recorded — P1/P2), since that is exactly where v0.4's one remaining Phase-1 defect lives.
- **OQ2** — Agree with don't-link-by-default and release-on-commit. On the deletion-compatible aggregate strategy: the honest fork is between (a) exact per-period distinct sets retained only inside the raw window (deletion genuinely un-counts within the window; history beyond it is already aggregate-only) and (b) sketches plus an explicit "deletion does not restate historical aggregates" contract — the industry norm. Either is defensible; what the doc already gets right is that the *contract wording precedes the number shipping*. I lean (b) with plain wording: restating history is a data-warehouse behavior this layer has already forsworn (C3).
- **OQ3** — Agree, and the reasoning is now airtight: because telemetry disk is billing-invisible under C5, an unbounded hosted telemetry file would be a free-storage hole, so the Phase-2 pin cannot wait for the commercial process. C8 makes the local default safe meanwhile.
- **OQ4** — Agree with cap-for-v1. The variance envelope exists precisely so the cheap answer can be truthful (`bounded-window`), and DO-persisted rollups would attach a durable-write surface to the arm whose entire appeal is writes-only-on-traffic. Decide after the control-plane projection is real, as written — and note P4 makes the capped answer even simpler because the arm's data surface is already classification-only.

6. **Recommended next step**

One focused v0.5, not a restructure: (a) the recorded-timestamp repair with visibility/ordering/watermark keyed on it (Concern 1 / P1, with P2's phase column if the author agrees); (b) the one-paragraph Cloudflare classification-only default (Concern 2 / P4); (c) the MINOR wording sweeps (Concerns 3–9, each a sentence or two). None of these disturb the converged architecture — the span model, the operation contract, the generation protocol, and the maintenance state machine should not be reopened. After that delta lands I would regard the document as READY to enter Review without a further full round; a delta-only check of the two MATERIAL repairs would suffice.

## Round 2 — 2026-08-02

**Reviewer family:** Claude (Fable 5)
**Provider / runtime:** Claude Code `general-purpose` subagent
(`claude-fable-5`), fresh non-author session (distinct from the round-1
session)
**Date:** 2026-08-02
**Redacted:** no (repository-local review)
**Method:** fresh non-author agent context, read-only instruction, over the
working tree; mutually blind — instructed not to read any `llp/reviews/`
artifact concerning LLP 0154. SHA-pinned target verified by the reviewer.
Design-partner framing per author directive.
**Target:** `llp/0154-minimal-observability.rfc.md` (648 lines, Draft, v0.3)
**Target SHA-256:** `2578344420fd8a13b4dcb395667e27da8a0b0a49adbad3d2205acf1206f23f72`
**Repo revision at review start:** `main` `4f7890eb` (target file untracked)
**Status:** completed
**Verdict:** NOT READY (three MATERIAL under-specifications; architecture
explicitly endorsed; "clear READY-to-enter-Review candidate" after a small
v0.4)

### Verbatim review (round 2)

**1. Overall assessment**

LLP 0154 v0.3 is a strong, evidence-honest RFC whose round-1 restructure
made the right big moves: deleting the network SQL endpoint was correct
(`PRAGMA query_only` is not an authorization boundary, and the local-only
replacement matches a real in-repo precedent — the Ibex authorizer at
`vendor/ibex/src/host/abi.rs:3075-3090` denies `ATTACH`/`DETACH` and tests
its refusals at `abi.rs:10832`); folding maintenance into the flush path is
justified by verified fact (cron state persists in the app database via
`META_CRON_STATE`, `src/storage.rs:150,2700`, and LLP 0028 "structurally
rejects runtime-created entries", `llp/0028:18-20`); the
observation-envelope/three-projections model correctly separates seams from
transports against LLP 0104's admission-bound `occurredAt`
(`llp/0104:67-73`) and its "sampled observability separated from billable
totals" list (`llp/0104:475`); and the C5 reclassification is right.
Nearly every factual anchor I checked holds: exactly 2 `eprintln!` in a
44,539-line `src/server.rs`, no `tracing`/`log` crate in `Cargo.toml`,
severity names match `src/diagnostic.rs:11-20`, the operator-only details
caveat matches `src/diagnostic.rs:31-33`, LLP 0010:747 says verbatim "This
is not a production observability replacement", the explainer reserves
Observability (`llp/0000:955`) and `guide/capabilities.md` indeed has no
observability row despite GAP-row precedent for unbuilt capabilities
(vector-search, line 52). However, three MATERIAL under-specifications
remain, each fixable with a paragraph: the `lifecycle` boot event
contradicts deliverable 4's zero-writes acceptance gate as written; the D1
generation identifier has no minting/persistence/restart specification
(the existing `app_generation` at `src/server.rs:894` is an in-memory
`u64`, so "wire into the existing reset transition" underdetermines restart
semantics); and the Cloudflare arm's Tier-1 serving location is
structurally unresolved given the credential-custody rule the RFC itself
states. One stated implementation fact is also wrong in an interesting
direction (the rusqlite authorizer feature is already active via feature
unification). Because the acceptance-gate contradiction and the generation
gap would mislead an implementer conforming to the text, this is not yet
at "remaining defects at most MINOR." Verdict: NOT READY

**2. Strengths**

- **Substrate constraints (C1–C7)** are the document's spine and every one
  I checked is real: the serialized write lane and
  `_snapback_changes`/`_snapback_version` journaling
  (`src/storage.rs:474,809,1456,2248`), the LLP 0035 idle evidence (zero
  disk writes over 120s, `llp/0035:277-296`) and the 7,200s Cloudflare
  quiet window (`llp/0000:596`), the analytics non-goals
  (`llp/0000:713-718`), and the LLP 0031 root-vs-`/_snapback/api/*`
  invariant (`llp/0031:45,93-107`). C4/C7's "shared seams, separate
  transports" cleanly resolves what v0.2 apparently got wrong.
- **D4 (flush-path maintenance)** is a genuinely better design than cron
  here, and its stated rationale is verified fact, not assertion. The
  "accepted cost" sentence shows honest engineering.
- **D5's corrected seams are accurate**: `src/guide_mcp.rs` is
  resources-only (line 8), and `packages/snapback-cli/mcp-control.mjs:772`
  says "Control-plane tools project LLP 0024 host operations" — the MCP
  seam claim is exactly right.
- **D7 mergeable-by-construction rollups** (counters + fixed-bucket
  histograms, rejecting stored scalar percentiles and non-unionable
  DISTINCT scalars) is the correct aggregation theory, and deferring
  distinct-user metrics behind the Phase-3 identity policy rather than
  shipping dishonest numbers is the right call.
- **The variance envelope** (D5) is an unusually good idea: it makes the
  Cloudflare arm's sampling/retention honesty a wire-contract property
  instead of a docs footnote, and it fits the repo's
  fixture-pinned-contract culture.
- **Phasing and the Landscape section**: dated external figures explicitly
  marked non-load-bearing; the scope line (fixed dashboards yes, ad-hoc
  slicing no) is drawn from evidence and matches the explainer's
  non-goals.
- **The diagnostic emission-boundary distinction** (D2) — capturing
  diagnostics at emission rather than at hundreds of construction sites —
  matches how `Diagnostic` values actually flow as typed refusals in this
  codebase.

**3. Concerns**

1. **MATERIAL — `lifecycle` boot events contradict the zero-writes
   acceptance gate (D1/D2 vs deliverable 4).** D2 declares `lifecycle`
   rows for "boot, bundle load/activation" (0154:310-312); D3 flushes
   ≤3000ms after first buffered record (0154:355-359). So every
   boot/provisioning writes the telemetry file ~3s later. Yet D1 claims
   the file "is absent until the first event is written, preserving the
   zero-footprint idle profile" (0154:248-249) — hollow once boot is
   itself an event — and deliverable 4 requires "re-run the LLP 0035 idle
   measurement with telemetry enabled and no traffic; zero writes must
   hold" (0154:582-584). LLP 0035's methodology samples a provisioned
   instance over 120s (`llp/0035:282-289`); bundle-activation lifecycle
   events flush ~3s after provisioning, inside that window as specified.
   C2's letter ("armed only by event arrival") survives; the acceptance
   gate as written does not. Resolution: one paragraph defining the idle
   window as starting after post-provision telemetry settle (boot flush
   drained), and rewording the D1 zero-footprint claim to "no writes
   after settle."
2. **MATERIAL — the generation identifier's minting, persistence, and
   restart semantics are unspecified (D1).** The schema stores
   `generation TEXT` and rotation triggers are listed (reset, restore,
   "any operation that replaces the app database", 0154:250-259), but
   nothing says where the current generation lives or how a plain
   restart-without-reset keeps it. The only existing incarnation concept
   is `app_generation: u64` at `src/server.rs:894` — in-memory fencing
   state that resets with the process. An implementer following the text
   could make all history vanish on every restart (fresh generation per
   boot) or resurrect fenced rows (counter collision), both conformant.
   Also, "any operation that replaces the app database" cannot be a
   runtime hook for out-of-band replacement (operator copies a file in
   place); detection needs a durable binding, not a trigger list.
   Resolution: specify minting (e.g., random id persisted in a telemetry
   meta table) plus a durable app-DB identity binding compared at boot,
   rotating on mismatch — see proposal P1.
3. **MATERIAL — the Cloudflare arm cannot serve its own Tier-1 contract
   as specified (D8/OQ4).** D5 promises "the same shape lets the
   Cloudflare arm answer honestly (D8) without changing the contract"
   (0154:416-417), i.e., `/_snapback/api/telemetry/*` exists on that arm.
   But Workers Analytics Engine is queried through the account-scoped SQL
   API, and D8 itself rules the credential out of the worker: "never as
   an app-runtime secret behind an app-serving route" (0154:522-524).
   Then the worker cannot answer `events`/`stats` at all — Tier-1 on
   Cloudflare must be served by the control plane or a
   CLI-to-control-plane path, which changes where the contract lives, its
   auth story, and its LLP 0031 registry rows. "Partial until its Tier-1
   contract is proven" gestures at this but never names the actual
   structural problem. Resolution: one paragraph naming the
   serving-location question explicitly and folding it into OQ4.
4. **MINOR — the rusqlite feature note is factually wrong, in a
   convenient direction (D5).** The doc says the authorizer hook
   "requires enabling a rusqlite feature not currently in the build"
   (0154:440-441). Snapback's own declaration lacks it (`Cargo.toml:33`:
   `backup, bundled, column_decltype`), but `vendor/ibex/Cargo.toml:59`
   enables `hooks` on the same rusqlite 0.31, and Snapback links
   `ibex-runtime` (`Cargo.toml:27`) — Cargo feature unification means the
   authorizer API is already compiled into the rusqlite this binary
   links. Correct the note to "active today only transitively via
   ibex-runtime; declare it explicitly rather than relying on
   unification."
5. **MINOR — retention is a sweep, not a promise (D4 + C5).** A
   long-running process that goes quiet retains C5-sensitive rows past
   `max_days` indefinitely (D4's accepted cost, 0154:386-387,
   acknowledges deferred *cleanup* but not the *privacy-window*
   consequence of the sensitivity class C5 claims to take seriously).
   Boot flushes mitigate across restarts only. Resolution: enforce the
   retention boundary at read time on every query surface (P2), demoting
   sweeps to space reclamation.
6. **MINOR — "query strings stripped to declared-safe parameters"
   (0154:331-332) has no Phase-1 declaration mechanism.** Declaration
   arrives with `defineTelemetry` in Phase 3. State the Phase-1 behavior
   plainly (strip all query strings).
7. **MINOR — Health/stats percentile freshness is bounded by rollup
   cadence and unstated.** D4 updates rollups at ≥6h-or-hour-boundary
   moments (0154:373-377); `stats` computes percentiles "from D7
   histograms" (0154:406-408). The most recent partial hour — exactly
   what a debugging agent wants — may be stale or absent. The freshness
   watermark makes this honest but not useful. See P3.
8. **MINOR — the Phase-3 ingestion route has no named admission-quota
   obligation.** A root, connection-credentialed, best-effort write route
   (0154:541-545) is a disk-growth and junk-data vector even with
   declared event names; LLP 0047 sits in Related (0154:41) but is never
   invoked. Add one sentence making per-connection/per-app admission
   limits a Phase-3 design obligation.
9. **MINOR — the `*.sqlite3` glob-exclusion rationale is asserted, not
   grounded.** I could not find path-glob backup tooling keyed on
   `*.sqlite3` (LLP 0007 defines logical portability; `Cargo.toml`
   carries rusqlite's `backup` feature, i.e., API-level backup), and the
   app's own `-wal` sibling wouldn't match such a glob either. The naming
   choice is fine; the stated justification over-claims. Also, the
   "existing sibling-file convention (config JSON, locks, receipts)"
   (0154:226-227) didn't match what I sampled (`demos/*/.snapback/`
   contains only `codegen-cache`; receipts live next to the binary) —
   possibly true for provisioned instances, which I could not check.
10. **MINOR — unmatched-request cardinality (D2).** `name` = route
    *pattern* is right, but 404s/scanner floods have no pattern; without
    a stated fallback (e.g., a fixed `_unmatched` sentinel with the raw
    path only in capped `details`), internet-facing instances get
    unbounded `name` cardinality in exactly the rows that shed last
    resistance.

**4. Design proposals**

- **P1 (strong) — Specify generation as a persisted pair.** Mint
  `gen_<random>` at fence time; persist it in a `telemetry_meta` table
  inside the telemetry file *together with a durable identity of the app
  database it belongs to* (an incarnation nonce written once at app-DB
  creation/reset — a natural companion to the existing reset transition).
  At boot, compare: app-DB nonce mismatch ⇒ rotate. This gives
  restart-stability, out-of-band-replacement detection, and makes
  "rotated by any operation that replaces the app database" a checked
  property instead of a trigger list. Aligns with the prefixed-id grammar
  now in the repo (LLP 0148-style `gen_` prefix).
- **P2 (strong) — Make retention a read-time contract.** Every query
  surface (Tier-1, CLI, the SQL hatch via a view, export) filters
  `ts_ms >= now − max_days` regardless of sweep state. One clause
  converts concern 5 from a privacy defect to a disk-space footnote and
  makes `max_days` a testable promise. The SQL hatch can honor it by
  exposing a `telemetry_events_visible` view and having the authorizer
  deny reads of the base table — the deny-by-default authorizer is
  already in the design.
- **P3 (moderate) — Serve the partial hour from memory.** The flusher
  already accumulates per-name data to update rollups; keep the current
  hour's counters/histograms in memory and have `stats` merge them with
  stored hourly rows. Health percentiles become fresh-to-the-last-flush
  at zero extra writes, and the variance envelope's watermark reports it.
  This closes the biggest gap between motivation 1 ("agents debugging
  the recent past") and what D4's cadence actually delivers.
- **P4 (moderate) — Name the Cloudflare Tier-1 topology now, decide it in
  Phase 2.** State in D8 that on the CF arm the Tier-1 contract is served
  by the control plane (which holds the AE credential per LLP 0072
  custody), not by the worker, with the worker owning only
  `writeDataPoint`; fold "or DO-persisted rollups let the worker serve a
  subset" into OQ4. This turns concern 3 from an unstated contradiction
  into a scoped decision.
- **P5 (moderate) — Sweep on boot, explicitly.** Since boot emits a
  `lifecycle` event (and thus a flush), specify that the boot flush
  always runs D4 maintenance. Combined with P2, the idle-retention story
  is fully closed: read-time enforcement always, physical deletion at
  next activity or boot.
- **P6 (exploratory) — Join telemetry to inspect.** Expose buffer depth,
  drop counters, and last-flush watermark through the LLP 0010 inspect
  surface too. Inspect is "current instant," telemetry is "recent past"
  (0154:463-464) — the buffer is precisely the seam between them, and an
  agent diagnosing shedding wants it in both places.
- **P7 (exploratory) — `_unmatched` sentinel for patternless requests**
  (concern 10): fixed `name`, raw path capped inside `details`,
  classified low-priority so scanner floods shed first by construction.

**5. Open questions**

- **OQ1 (envelope ratification):** Agree this must precede seam landing.
  Suggest the reconciliation land as a field-mapping table in this RFC
  checked by a shared fixture that both the metering and telemetry
  projections deserialize — making "projection, not translation" a CI
  property, in this repo's style.
- **OQ2 (identity policy):** Recommend app-declared linking with default
  *don't link* — privacy posture varies too much by app for a global
  answer, and the declared-events philosophy (D8) extends naturally to
  declared identity policy. Be honest in the same breath that HLL
  sketches cannot un-count a deleted subject: deletion removes raw rows
  and stops future counting; historical sketch aggregates retain the
  contribution. Say so in the contract rather than discovering it later.
- **OQ3 (hosted ceilings):** Agree it's an LLP 0104-process decision;
  note that because C5 excludes telemetry from the billed logical-bytes
  basis, hosted telemetry disk is billing-invisible — so a hosted default
  `max_days` (and a file-size cap) should be pinned at Phase 2 landing,
  not left to the commercial discussion.
- **OQ4 (CF rollups):** Recommend honestly capping at AE retention for
  v1 — no DO rollup persistence. The variance envelope exists precisely
  so the cheap answer can be truthful; DO-persisted rollups add a
  durable-write surface to the arm whose whole appeal is
  writes-only-on-traffic. Revisit on demand. (And fold P4's
  serving-location question in here.)
- **OQ5 (lifecycle inventory):** Keep v1 minimal: boot, bundle
  activation, migration, reset/generation rotation, graceful shutdown.
  Config changes as coded events without values; secret rotations at
  most as a count, never an identifier — C5 argues for starting stingy
  since every addition is operator-visible history.

**6. Recommended next step**

Author applies a small v0.4: (a) reconcile the boot-lifecycle/zero-writes
acceptance gate (concern 1), (b) add the generation minting/persistence
paragraph (concern 2, P1), (c) name the Cloudflare Tier-1 serving
topology (concern 3, P4), (d) correct the rusqlite feature note (concern
4), and optionally take P2/P5 as one-sentence hardenings. All are
localized text additions; none disturb the architecture, which I consider
sound. After that revision this document is a clear READY-to-enter-Review
candidate — the phase-1 kernel (D1–D7) could plausibly begin
implementation planning in parallel with the Review period, with only OQ1
as a hard pre-seam gate.

*Not checked: external landscape figures (PocketBase batch
sizes/retention defaults, Convex/Supabase/PostHog/AE product facts) —
out-of-repo, and the RFC correctly marks them dated and non-load-bearing.
Also unverified: a concrete "live connection count" accounting for D6
(plausible via LLP 0031's aggregate ephemeral-health inspect projection,
but I did not locate the specific counter), and sibling-file conventions
on a provisioned instance (sampled demo `.snapback/` dirs contain only
`codegen-cache`; receipts live next to the binary).*

## Round 1 — 2026-08-02

**Reviewer family:** Claude (Fable 5)
**Provider / runtime:** Claude Code `general-purpose` subagent
(`claude-fable-5`), fresh non-author session
**Date:** 2026-08-02
**Redacted:** no (repository-local review; no external transmission beyond
the Anthropic API serving the session)
**Method:** fresh non-author agent context, read-only instruction, over the
working tree; mutually blind — instructed not to read any `llp/reviews/`
artifact concerning LLP 0154. SHA-pinned target verified by the reviewer
before reviewing. Design-partner framing per author directive: reviewer
explicitly invited to propose significant design changes.
**Target:** `llp/0154-minimal-observability.rfc.md` (489 lines, Draft, v0.2)
**Target SHA-256:** `a6fc5deec321f1ea8847b0f450d9402686845c053e275a3f75e040134117cfca`
**Repo revision at review start:** `main` `4f7890eb` (target file untracked)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

This is a well-grounded RFC whose factual substrate claims check out almost
everywhere I probed: the no-`tracing`/two-`eprintln!` characterization is
exact (`src/server.rs` is 44,539 lines with exactly 2 `eprintln!` calls at
lines 3848 and 20420; no tracing/log crate in `Cargo.toml`), the reserved
Observability slot exists (`llp/0000-snapback.explainer.md:955-957`), the
non-goals and idle-zero-writes evidence are as described (0000:713-718,
586-610; `llp/0035:282-296`), LLP 0010 really does self-describe as "not a
production observability replacement" (0010:747), the capability index
really has no observability row (verified by grep over
`guide/capabilities.md`), and the C4 compatibility claims against LLP 0104
(admission-bound `occurredAt`, append-only events, shadow meters, the
write-unit meter) are real (0104:67-74, 90-91, 200-214, 330). The scope
line — fixed dashboards over rollups in, ad-hoc slicing out — is the right
one for this codebase, and the v0.2 agents-first restructure of D5 is
genuinely good. But four mechanism-level defects are MATERIAL, not MINOR:
the tier-3 "safe because of D1" isolation argument is technically wrong as
specified (`PRAGMA query_only` is flippable by the submitted SQL itself and
does not block `ATTACH`-ing the predictably-named sibling app database);
D4's retention cron conflicts with how LLP 0028 cron actually works (run
state persists *inside the app database* via `META_CRON_STATE`, and the run
ledger structurally rejects non-manifest jobs); the client-facing `track()`
route sits in the admin-token-gated `/_snapback/api/*` namespace in
conflict with LLP 0031's taxonomy; and the shared-seam story with LLP 0104
never states that the two consumers need opposite loss disciplines. All are
fixable in text without restructuring the design. Verdict: NOT READY

## 2. Strengths

- **Substrate constraints section (C1–C6) is accurate and load-bearing.**
  C1's single-write-lane description matches `src/storage.rs`
  (`_snapback_version` at 1247, `_snapback_changes` at 1456/1509,
  `ReaderPool` at 809/1654). C2's idle evidence citations are correct
  (0035:282-296: "zero disk writes" over 120s). C5's separation argument is
  correctly derived from 0104's logical-bytes billing basis (0104:102,
  115). This is the best part of the document — the design is argued *from*
  the substrate rather than pasted onto it.
- **D5's three-tier restructure** (routes as contract, CLI/MCP as thin
  clients, console as one more client) is the right shape for this repo.
  The named integration points exist: `src/guide_mcp.rs` and
  `packages/snapback-cli/mcp-control.mjs` are real, and the acceptance
  posture in deliverable 2 ("agents are the tested consumer, the console is
  not the proof", lines 422-423) matches the LLP 0010 acceptance culture.
- **D7's rollup argument** is what makes the C3 boundary honest rather than
  aspirational: fan-out counters accumulate in memory and land in rollups,
  never as per-frame events (lines 377-379), which is exactly the
  discipline the excluded-firehose non-goal requires.
- **The Alternatives section** (433-456) is genuinely argued, and the
  rejected in-app-events-table alternative correctly cites the live
  Cloudflare declared-tables fan-out defect, which I verified exists and
  says what the RFC says it says
  (`issues/20260801-cloudflare-live-fanout-uses-declared-tables.md`).
- **Deliverable 4** (re-run the LLP 0035 idle measurement with telemetry
  enabled, lines 428-430) turns C2 from a promise into a regression gate.
  Good instinct.
- **Retention default coherence:** the 7-day raw default (D4) happens to
  agree with 0104's proposed free-tier "Logs 7 days" row (0104:233) — the
  RFC doesn't even claim credit for this, but it means OQ4 starts from an
  aligned position.

## 3. Concerns

1. **MATERIAL — Tier-3 isolation mechanism is wrong as specified.** Lines
   296-303 claim the SQL hatch is safe because the connection is opened
   with `PRAGMA query_only = ON` and "can only ever see `telemetry_events`
   and the rollup tables — no app data, no auth tables." Two defects: (a)
   `query_only` is a connection pragma; the submitted SQL can simply
   execute `PRAGMA query_only = OFF` and then write. (b) Nothing stated
   prevents `ATTACH DATABASE '.snapback/dev.sqlite3' AS app` — and D1
   makes the app DB path a *predictable sibling* of the telemetry file.
   The endpoint is admin-gated, so this is privilege-escalation-within-
   admin rather than a public hole, but the RFC's own safety argument
   ("safe *because of* D1") is the thing being violated. Resolution: open
   the connection with `SQLITE_OPEN_READ_ONLY` (kills the pragma flip at
   the file level) *plus* an authorizer callback denying `SQLITE_ATTACH`
   and pragma execution — which currently requires enabling a rusqlite
   feature not in the build (`Cargo.toml:33` enables only `backup,
   bundled, column_decltype`). The RFC should specify this mechanism, not
   `query_only`.

2. **MATERIAL — D4's retention cron conflicts with LLP 0028's actual
   machinery.** Two problems. First, cron scheduler/run state persists
   **inside the app database** (`src/storage.rs:150` `META_CRON_STATE`;
   `save_cron_state` at 2700; `persist_cron_state` call sites throughout
   `src/local.rs`), so a `telemetry.cleanup` job running under LLP 0028
   would write app-DB bytes on every run — precisely the C1/C5
   contamination the sibling-file design exists to avoid. Second, LLP
   0028's run-ledger identity model "presupposes source-manifest
   definitions and structurally rejects runtime-created entries" (0028
   header, 2026-07-30 boundary amendment), so an "internal cron job" is a
   new job class this RFC silently invents. Resolution: either specify the
   internal-job concept (state kept in the telemetry DB, excluded from the
   app-DB ledger), or — better, see proposal P1 — drop the cron dependency
   entirely.

3. **MATERIAL — `POST /_snapback/api/telemetry/track` breaks the LLP 0031
   route taxonomy.** App routes live at the root with app auth; system
   routes live under `/_snapback/*` and `SNAPBACK_ADMIN_TOKEN` "only
   guards `/_snapback/api/*`"; "No route is both, and no system route
   hides at the root" (0031:40-45, 63, 99-103). D6's track endpoint (lines
   341-343) is client-facing ingestion — app clients cannot hold admin
   tokens — placed in the admin namespace. The "rate-limited per
   connection" language implies connection-token auth (LLP 0031
   §Connection capability grants), which is a *third* auth class for that
   namespace that the registry doesn't have. Resolution: classify the
   route explicitly — most cleanly as a root-level app-facing route under
   connection-token auth — and name the LLP 0031 registry rows (path
   class, credential resolution, response sensitivity) for *all* new
   routes in deliverable 2, which currently omits the registry obligation
   entirely.

4. **MATERIAL — the shared-seam story with 0104 needs a transport split
   stated.** 0104's contract is at-least-once ingestion, idempotent
   `eventId`, dedupe, completeness watermarks (0104:66, 90-93). D3's
   buffer is deliberately lossy — full channel drops records (lines
   246-248). Both are correct *for their consumer*, but C4 and OQ6 say the
   seams are shared, and nothing says the transports must not be. If the
   0104 write-unit meter ever rides the D3 buffer, load-shedding corrupts
   invoices. One sentence fixes this: the seam is shared, the transport is
   not; metering events take a non-shedding path with `eventId`, telemetry
   takes the lossy buffer.

5. **MATERIAL — the `diagnostic` kind's seam is not a seam.** D2's table
   claims each kind maps to "one existing server seam," but the diagnostic
   row says "wherever a `Diagnostic` is constructed at `warn`+ severity"
   (lines 223-224). Diagnostics are constructed pervasively as typed
   refusal values — 707 construction sites in just
   `src/local.rs`/`src/server.rs`/`src/storage.rs` (grep counts
   345/180/182) — many of which are caught, handled, or returned as
   ordinary 4xx refusals already captured by `http_request`/`function_run`
   rows (whose schema already has a `code` column). As written this
   double-counts every failed request and instruments hundreds of sites.
   Resolution: define the seam as the *emission boundary* — a
   request/function/job that terminates with a Warning+ Diagnostic gets
   its `code` on its own event row; a standalone `diagnostic` event exists
   only for diagnostics not attached to any request. Also note
   `DiagnosticSeverity` is `Info/Warning/Error/Fatal`
   (`src/diagnostic.rs:11-20`) — there is no `warn` level, and the
   `min_level` knob should use the real names.

6. **MATERIAL — D8's Cloudflare arm silently loses the Usage-history
   property.** Locally, rollups are "kept indefinitely" and are "what let
   raw retention stay at 7 days without the Usage page losing history"
   (lines 374-377). On Cloudflare there are no rollup tables — the arm
   maps everything to Analytics Engine with its ~3-month retention (lines
   394-399). So the Usage page's indefinite history, and the exact-
   `DISTINCT subject` actives computation (AE is sampled), do not survive
   the arm mapping. D8 says "the capability index row stays partial" but
   doesn't name *this* divergence. Resolution: either state the divergence
   in D8 (Usage history capped at AE retention on CF; actives
   approximate), or specify rollups landing in DO storage on that arm.

7. **MINOR — Diagnostic `details` vs the no-payloads discipline.** D2 says
   "`details` never contains payloads" (line 230), but the Logs page shows
   "the full record (Diagnostic code/subsystem/details for failures)"
   (line 318), and `src/diagnostic.rs:31-33` documents that Diagnostic
   messages/details "can contain source paths, handler text, arguments,
   or other operator-only context." Admin gating makes this acceptable,
   but the RFC should acknowledge that persisted diagnostic details are
   operator-only context under the 8 KiB cap, not payload-free.

8. **MINOR — scale arithmetic wording.** "1M requests/day is ~12 batched
   inserts/second" (line 382) — it is ~12 *rows*/second; at the D3
   defaults that is roughly one batched INSERT every ~20 seconds. The real
   number is even more favorable than the stated one; say it correctly.

9. **MINOR — rollup percentiles are not mergeable.** `duration_p50/p95`
   stored per-day (D7 schema, lines 367-369) cannot be aggregated into
   weekly/monthly percentiles. Fine if the Usage/Health pages only ever
   display per-day values; the RFC should say so, or store a small
   histogram/t-digest instead.

10. **MINOR — Related-header gloss drift.** "LLP 0012 (diagnostics
    taxonomy)" — 0012 is the headless integration contract, which
    *registers* the diagnostic dialect; and "LLP 0110 (activity patterns)"
    is `0110-bounded-children-and-activity-patterns.spec.md`. Both glosses
    are defensible but worth tightening.

11. **Not checked:** I could not verify any of the external landscape
    claims offline (PocketBase's 200-row/3s flush, 5-day `MaxDays`,
    6-hourly cron; Convex's chart set and percentiles; Supabase Logflare
    internals; PostHog's ~4x identified-event pricing; AE's 3-month
    retention and `_sample_interval`). The RFC's design does not stand or
    fall on their exact values, but they are presented as evidence and
    should be pinned to the LLP 0152/0153-style research doc or dated
    citations if one exists for this pass ("the 2026-08-02 landscape
    research pass" is referenced at lines 9-11 but no research LLP number
    is given — if that pass produced a document, Related should name it;
    if it did not, the evidence section is the only record and should say
    so).

## 4. Design proposals

**P1 — Delete the cron dependency; unify retention into the flush path
(strong).** The RFC already has the right mechanism and uses it for
rollups: "triggered opportunistically after flushes cross an hour boundary,
never by timer (C2)" (lines 361-363). Retention should use the *same*
trigger: after a flush, if the last sweep is >N hours old, run the `DELETE`
+ occasional checkpoint on the telemetry connection. This makes D4 a
two-line addendum to D7, removes the internal-cron-job concept entirely
(resolving concern 2), automatically satisfies "only while serving traffic"
(flushes only happen with traffic), and keeps every telemetry-related write
off the app DB. The only cost is that a server that goes idle right after a
burst defers cleanup — which the RFC already accepts ("an idle instance
defers cleanup to its next active period," line 260). D4 as a separate cron
design is machinery the design doesn't need.

**P2 — Add a `lifecycle` kind; the RFC's own flagship query requires it
(strong).** Tier 3's motivating example is "which routes' p95 regressed
after yesterday's deploy?" (lines 305-306) — but the D2 taxonomy has no
deploy marker, so the question is unanswerable from the telemetry DB alone.
Add `kind = 'lifecycle'` events (server boot, bundle load/activation,
schema migration, reset) — a handful of rows per week, high correlation
value, and the seams already exist (`app/reset` at `src/server.rs:8177`,
bundle activation). This is the cheapest row in the whole taxonomy and the
one agents will join against most.

**P3 — Narrow the `diagnostic` kind into the `code` column (strong).**
Follow-through on concern 5: since every event row already carries `code`,
the standalone `diagnostic` kind should be the exception
(background/unattributed failures), not a parallel record of every failed
request. This shrinks v1's instrumentation surface from "hundreds of
construction sites" to the six-ish seams the D2 table actually promises,
and makes the Logs page's failure view a filter (`code IS NOT NULL`)
rather than a join-and-dedupe.

**P4 — Specify the tier-3 sandbox as: read-only open + authorizer + no
ATTACH (strong).** Per concern 1. Concretely: a dedicated connection opened
`SQLITE_OPEN_READ_ONLY`, `sqlite3_set_authorizer` denying
`SQLITE_ATTACH`/`SQLITE_DETACH`/`SQLITE_PRAGMA`, `SQLITE_LIMIT_ATTACHED` =
0, a progress-handler-based timeout, and the row cap. Note the rusqlite
feature implication in the deliverable so it isn't discovered at
implementation time.

**P5 — State the metering/telemetry transport split as a numbered
constraint (moderate).** Per concern 4 — I would promote it to a C7:
"shared seams, separate transports; telemetry may shed, metering may not."
It costs a paragraph and prevents the single most expensive
misimplementation this RFC could induce.

**P6 — Scope tier 3 to SQLite-backed arms in v1 (moderate).** My answer to
OQ7, and a scope cut: ship the SQL hatch where it is one connection away
(local, container-VM), leave Cloudflare at tiers 1–2, and let demand — not
symmetry — justify proxying AE's ClickHouse-flavored dialect through an
account-scoped token (which also defers OQ3 out of v1 entirely). The RFC's
own leaning ("native dialect per arm") is fine as the *eventual* answer;
v1 doesn't need it.

**P7 — Sequence v1 as Health/Logs first, Usage second (exploratory).** The
Usage page is the only v1 surface that needs `telemetry_rollup_actives`,
and its real payoff arrives with D6 `track()` in phase 2 (the RFC admits
the empty state, lines 320-321). Shipping D1–D5 with Health+Logs plus
`stats`/`events` routes, and moving Usage+rollups into the D6 phase, would
make phase 1 smaller and defer the DAU/distinct-subject design (and OQ5)
to the phase that actually exercises it. Counterargument: system events
alone populate actives for authed apps, and rollups are cheap — so this is
a judgment call, not a defect.

**P8 — Keep the `.telemetry` suffix exactly as proposed (endorsement,
moderate).** One nonobvious virtue worth stating in D1: the file
deliberately does *not* match `*.sqlite3`, so path-glob-based
backup/export tooling (LLP 0007) excludes it by default rather than by
remembering to. The existing sibling convention is real
(`dev.sqlite3.config.json`, `src/config.rs:265`; `.snapback.lock`,
`src/instance_lock.rs:135`). Do note WAL mode mints
`.telemetry-wal`/`.telemetry-shm` siblings that reset/delete paths must
sweep.

## 5. Open questions

- **OQ1:** Yes to the reserved sub-buffer for Warning+ events — error
  visibility surviving load-shedding is exactly what an agent debugging an
  overloaded server needs, and it is cheap. For the general pool,
  drop-newest (with the visible counter): under sustained overload the
  oldest buffered events are the ones adjacent to whatever caused the
  overload.
- **OQ2:** Defer concrete numbers to implementation, but require from day
  one the 0104-vocabulary shadow meter on `app_event` admission so the
  pricing decision is made with data. Don't meter customer-facing at
  launch.
- **OQ3:** Dissolved by P6 — deferring the CF tier-3 hatch removes the v1
  credential question; when it returns, it belongs in the LLP 0072 target-
  descriptor credential custody story, not a new lane.
- **OQ4:** Keep local `max_days` operator-free permanently — a local file
  on the operator's own disk is not a plan lever, and gating it would be
  pure hostility. Tier-gate only hosted arms, and only via LLP 0104's
  process.
- **OQ5:** Skip sessions in v1. DAU + request counts answer the day-one
  question; gap-based server-side sessionization is derivable later at
  rollup time without schema changes, so nothing is foreclosed by waiting
  for a demand signal.
- **OQ6:** Land the seams once, together with telemetry v1, with the 0104
  write-unit meter as a shadow consumer of the same seam — under P5's
  transport split. The expensive thing is touching the seams twice, not
  choosing an order.
- **OQ7:** Per P6 — scope tier 3 to SQLite arms now; when Cloudflare earns
  it, native-dialect-per-arm with documented divergence (the RFC's
  leaning) is right, and translation machinery is correctly identified as
  the complexity to refuse.

## 6. Recommended next step

Author revision pass addressing concerns 1–6 — all are text-level fixes
that don't disturb the architecture: respecify the tier-3 sandbox
mechanism (P4), fold retention into the flush path (P1), classify the
track route against the LLP 0031 registry, add the transport-split
constraint (P5), redefine the diagnostic seam (P3), and state the D8
Usage-history divergence. Add the `lifecycle` kind (P2) while in there.
After that revision this RFC is a sound candidate for Review status and,
in my view, close to acceptance-shaped; the underlying design — sibling
file, batched event-driven writes, rollups, agents-first query contract —
is the right minimal layer and I would not restructure it.
