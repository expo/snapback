# Author decision packet — RESOLVED 2026-08-02 (sitting record)

**Status:** Resolved except two standing conditionals (below); this file is
now the provenance record for the 2026-08-02 decision sitting (Charlie
Cheever, with Claude Fable 5 presenting). Propagation of each ruling into
its owning LLP as a dated amendment is tracked by
`issues/20260802-decision-propagation-amendments.md`.

## Rulings, 2026-08-02

Tier 1:

1. **npm default channel = the 0074 parallel gate.** The locally-provable
   nine-package surface promotes to npm `latest` on its own qualification
   bar (LLP 0134's maturity machinery), in parallel with hosted work;
   hosted-dependent capabilities stay honestly gated in the capability
   index. 0111's hosted-serialized promotion is superseded on this point.
   (0115 OQ5 / 0122 option 5.)
2. **Helper-class cutline = context-reader helpers first, declared
   reads/writes as evidence, not ceilings.** (0118 OQ7 / 0127 move 2.)
   Unblocks G-03.
3. **Identity packet:**
   - 0151 credential ownership: **Option D adopted** — app-owned
     credentials for every provider; agent-executed registration where
     APIs exist; deterministic guided walkthroughs (Google, Apple);
     0036-owned config/secret state; preview-only dev broker at most;
     the transparent Google-issuer relay stays the pre-pinned conditional.
   - 0151 SMS OTP: **tier 2** (supported with vendor config, not paved
     tier-1; promotable when a delivery-vendor owner exists).
   - 0152 OQ14: external CIAM is a **sibling paved path** governed by
     0153's provider class; 0151 stays first-party-focused.
   - 0150 OQ2: **exclusive** — one agent principal, one credential kind
     at a time; kind change supersedes.

Tier 2:

4. **LLP 0143 ACCEPTED** (header flipped, dated note). Push-seam
   implementation released: `issues/20260802-push-01-0143-implementation.md`.
5. **LLP 0147 ACCEPTED** (header flipped, dated note). Micro-profile
   Phases A–B released with the stop rule:
   `issues/20260802-pkg-02-0147-phase-ab-micro-core.md`.
6. **LLP 0154 ACCEPTED** (header flipped, dated note; asymmetric stop
   recorded honestly). obs-01..04 released.
7. **LLP 0156: standing accept on loop close.** When the live refinement
   loop concludes (dual-family READY or the author's loop session ends the
   rounds), the doc is Accepted without a fresh sitting — the loop session
   flips the header citing this record. obs-05/06 release then.
   **Executed 2026-08-02:** loop closed at v0.7 under the asymmetric
   stopping rule; header flipped Accepted citing this record; obs-05/06
   released and realigned to the v0.7 checklist.
8. **0140 D-1: keep the TypeScript checker** in the shipped codegen
   closure; Oxc replaces syntax-only scanners. Admission semantics do not
   weaken. **Program E stays parked** until the wave clears; D-1 is
   recorded so Stage 0 can start whenever capacity opens.
9. **0144 OQ1 = B3**: an invalid declared-refusal payload keeps its
   admitted code and drops the payload with a diagnostic. Fixes D2's
   union grammar and the wire carrier key; the extension axes are now
   designable.

Tier 3:

10. **0149 Slice-0: the 0062 served envelope** owns the consumption
    descriptor and operation-journal projection. (Implementation is
    next-wave; the ruling unblocks 0149's slice sequence.)
11. **0155 Move-1 composition-algebra Spec: authored by a dedicated Fable
    session** with the standard dual-family loop; acceptance remains the
    author's. Tracker: `issues/20260802-0155-move1-composition-spec-commission.md`.

## Standing conditionals (not open decisions)

- **0141 OQ1** (embedder demand): D2/D3 activate when a real embedder
  profile appears — evidence-driven, no sitting needed.
- **Aggregates**: deferred to LLP 0130 SD-2's evidence branch (0155
  acceptance); arrives with evidence.
- **CV-6 strictness** (0115 OQ3): decided after A+E land, per the
  recorded ordering dependency.
- 0150 OQ3 (identifier/secret-class registrations) and OQ8 (numeric
  parameters) resolve at 0150 implementation time against the LLP 0148
  registry and the acceptance matrix, per the doc.
- The two 0151-commissioned implementing specs (completion protocol,
  lifecycle) still need owners and numbers — assign when identity
  implementation is scheduled (next wave).

## Questions appended after the sitting

- **2026-08-02 — LLP 0143 installation identity carrier and reset semantics
  (OQ2).** D1a requires an opaque installation identity persisted beside auth
  custody, explicitly not in the RQS cache, while OQ2 leaves its final home and
  reset semantics open. The shipped client has no mechanically owned durable
  installation carrier: its auth and RQS stores have different lifecycle
  contracts, and selecting either one (or adding an Expo FileSystem/SecureStore
  carrier) would decide whether logout, app-data reset, account switching, and
  reinstall preserve or replace the identity. Author ruling requested: choose
  the production carrier and enumerate its reset events. The registry slice
  will require explicit storage injection and refuse registration with
  `SNAPBACK_PUSH_INSTALLATION_CUSTODY_REQUIRED` when none is configured; it
  will not silently substitute process-memory custody.

- **2026-08-02 — LLP 0154 telemetry export carrier across host ops / control
  MCP.** The accepted RFC requires `telemetry.export` to be snapshot-bounded
  streaming and also projects the operation one-to-one through LLP 0024 host
  ops and control MCP. The current `HostOpsResult` and MCP structured-content
  carrier each return one finite JSON object; buffering the NDJSON payload,
  returning a local path, or silently omitting the projection would each add a
  contract not chosen by the RFC. Author ruling requested: introduce a stream
  or resource carrier, explicitly permit a bounded non-streaming MCP
  projection, or defer only the MCP export projection. This question does not
  block the HTTP/CLI streaming export or the stats/events projections, and no
  implementation session should infer an answer for the MCP export carrier.
- **2026-08-02 — LLP 0154 admission identity representation.** Accepted D2
  requires every admission record to carry app/environment identity and
  release identity (function-bundle hash / deployment id), but its normative
  fixed `telemetry_events` schema defines no columns for those fields. The
  current `details` allowlist admits `release`; app/environment identity may
  instead be implicit in the per-app local sibling store or represented in
  `telemetry_meta`, but the RFC does not choose a durable representation.
  Author ruling requested: add fixed event columns; keep `release` in
  `details` while making app/environment implicit or meta-bound; or explicitly
  defer/clarify these admission fields. obs-01 will not invent a schema, and
  obs-02 cannot ratify the shared projection fixture until this is clarified;
  the remaining D1–D4 implementation continues independently.
  **RESOLVED 2026-08-02 (worked through with Charlie in the 0156-promotion
  session; dated 0154 amendment landed):** release identity = a fixed
  nullable `release TEXT` column on `telemetry_events`, removed from the
  `details` allowlist (first-class in D2, schema-on-write, needed per-row
  by 0156's flusher, and identity must not be truncatable);
  app/environment identity = store-implicit, pinned as
  `telemetry_meta.app_id`/`environment` at creation/rebind (the sibling
  store is per-app/per-environment by D1 construction), stamped into
  `telemetry.export` output at egress; the obs-02 shared fixtures check
  projection equality on the composed record (row + meta) against the
  C7 envelope's identity. obs-01 can close on this; obs-02 unblocks.
- **2026-08-02 — LLP 0154 local environment identity source — RESOLVED by
  Charlie Cheever.** The local telemetry store receives an explicit,
  authoritative environment identity threaded from
  `TargetDescriptor.environment_id`; the lower-level store-identity seam
  carries `app_id` and `environment_id` together. Telemetry must not derive
  environment identity from the database path, process environment,
  `target_profile`, or a universal `"local"` sentinel. A descriptor-owned
  environment identifier may itself be `"local"`, but telemetry treats it as
  opaque caller-supplied identity rather than inventing it. Store creation and
  rebind pin that explicit identity in `telemetry_meta`; the exact Rust API
  spelling and compatibility plumbing remain implementation details. This
  resolves the production binding needed to close obs-01 and releases obs-02
  once obs-01's code and proof land.

## Rulings appended after the sitting (2026-08-02, evening)

- **LLP 0154 telemetry export carrier — agent-first, so the MCP/host-ops
  projection ships, bounded and continuable.** Charlie's direction verbatim:
  "I think the main way people are going to use this is actually via AI
  agent clients, so we should prioritize that." Translation into contract
  (recorded by the session; correct here if wrong): the control-MCP and
  host-ops projections of `telemetry.export` are NOT deferred — they ship
  in v1 as a bounded, snapshot-bounded page with a declared row/byte bound,
  an explicit truncation/continuation fact, and a continuation token, so an
  agent pages through the full export in finite chunks. The routes/CLI
  streaming export stays as specified. Lands as a dated LLP 0154 amendment
  with the obs-03 implementation.
- **LLP 0090 mixed-route successor — direction accepted, sequenced after
  LLP 0157.** The versioned mixed profile (per-child registered-live vs
  read-only under one pinned snapshot) is the endorsed successor shape;
  design/implementation waits for LLP 0157's acceptance so Move-1 route
  semantics don't churn it. Record as a dated author note on the 0090
  proposal entry when convenient; the register cliff stays honestly gated
  meanwhile.
- **LLP 0143 installation identity carrier:** explanation requested;
  ruling pending (see below when appended).
- **LLP 0143 installation identity — RESOLVED (2026-08-02, conventional
  default recorded by the session under Charlie's delegation; veto open
  until push-01 lands it):** device-scoped installation identity in a
  dedicated small store. Logout keeps the identity and unbinds the
  principal (deliveries stop until someone signs in); account switch keeps
  it and rebinds; app-data reset and reinstall mint a fresh identity.
  User-visible contract: push "just works" across logins on the same
  phone; a wiped or reinstalled app is a new device. Matches Expo's own
  installation-identity behavior. Lands as the 0143 OQ2 dated note with
  push-01's send-lane slice.

## Ratification — 2026-08-02 late evening (Charlie Cheever)

Charlie reviewed every ruling in this packet end to end (full option
walkthrough with a recommendation per item, presented by Claude Fable 5)
and ratified all of them. Deltas and additions from the review:

- **Ruling 1 (npm parallel gate) — confirmed, plus standing release-cadence
  guidance:** pre-release, aggressive, rapid, repeated releasing is the
  intent — "if something breaks at this stage, we can find it and fix it by
  using it. later on, we'll want to be more careful." Operate the LLP 0134
  bar as the honesty gate on *claims*, not as a brake on release frequency,
  until Charlie tightens this.
- **Ruling 8 (0140 D-1, keep TypeScript) — confirmed for now; explicitly
  watch-listed** ("let's keep an eye on this though"). When Program E
  unparks, re-price D-1a (Snapback-owned binding resolver + frozen
  TypeScript-oracle harness) rather than treating D-1b as permanent.
- **Ruling 10 (0149 slice-0, served-envelope ownership) — confirmed, with a
  recorded design input, not a ruling:** some consumption contexts "might
  want some kind of domain identity verification" — i.e. a consumer being
  able to verify the descriptor/journal is served by the claimed app or
  domain. Feed into 0149's public-vs-authenticated field and
  disclosure-class work.
- **Ruling 3d (0150 OQ2 exclusive credential kind) — confirmed on
  recommendation.** Charlie notes he does not fully internalize the
  rationale; when 0150 lands, keep the rationale documented at the contract
  (supersession retires the weaker credential; one-act unambiguous
  revocation; audit maps each act to exactly one credential kind).
- **LLP 0143 installation identity — veto window closed.** Charlie states
  no opinion; the delegated device-scoped-store default above stands as
  ruled. Push-01 lands it as specified.
- Rulings 2, 3a, 3b, 3c, 9, 11 and the Tier-2 acceptances (4–7): confirmed
  as recorded, no deltas. Appended rulings (export carrier, telemetry
  identity representation, environment identity source, 0090-after-0157
  sequencing): confirmed as recorded.
- Ruling 11 execution: the LLP 0157 authoring session is being kicked off
  following this ratification (tracker:
  `issues/20260802-0155-move1-composition-spec-commission.md`).

## Questions appended during LLP 0135 Part 2 implementation

- **2026-08-02 — snapshot-batch heterogeneous tuple result contract.**
  Accepted LLP 0135 §2.3 requires the visible sealed row's `nodes` member to
  be the declaration-ordered tuple of each bounded-child node's own distinct
  cursor-free page contract. LLP 0108's current `ResultValueContract` can
  express only homogeneous arrays; neither LLP 0135 nor Draft LLP 0157 pins
  the public tuple-contract node/member spelling. Accepting `Json`, a
  homogeneous array, or a union would weaken per-position validation and
  make a malformed direct artifact admissible. Author ruling requested: pin
  the closed heterogeneous tuple contract carrier (including its manifest
  member spelling and hashing/canonicalization behavior). The static Rust
  carrier checkpoint remains unpublished and whole-manifest admission stays
  fail-closed until that ruling lands.
- **2026-08-02 — `ParentAuthorizationKeyV1` canonical record encoding.**
  LLP 0135 §2.2 fully determines semantic equality — parent table, typed
  parent-id argument binding, and the complete visibility declaration with
  policy/version identity — and requires RFC 8785 canonical bytes plus
  cross-language golden vectors. It does not pin the closed key record's
  member names/encoding, and LLP 0157 only says those future canonical bytes
  enter the plan-hash preimage. Author ruling requested: pin the exact closed
  record encoding. The checkpoint derives the specified equivalence classes
  internally from typed Rust values, but exposes no canonical bytes and makes
  no `PlanHashV1` or cross-language identity claim.

## Questions appended after ratification

- **2026-08-02 — LLP 0156 multiple-unhandled-rejection fingerprint
  authority.** One invocation terminal can carry several unhandled promise
  rejections in the Ibex queue's stable drain order, but LLP 0156 E1.1 defines
  one fingerprint branch per eligible failure record and does not say whether
  that terminal represents one issue or several. Author ruling requested:
  should emission (a) fingerprint only the first ordered rejection, (b) emit
  one eligible failure record per ordered rejection, or (c) fingerprint one
  aggregate using a newly pinned ordered-carrier grammar? E0 preserves every
  bounded carrier in queue order and deliberately chooses no fingerprint
  winner until this is resolved; the public diagnostic remains the existing
  single terminal with its ordered `rejections` summary.

## Follow-on ratifications — 2026-08-03 (Charlie Cheever)

- **First npm `latest` promotion — trigger pulled.** With ruling 1's
  parallel gate ratified, the LLP 0134 maturity machinery landed, and main
  green (local-proof run 30786381634), Charlie authorized executing the
  first real promotion of the locally-provable nine-package surface.
  Sequenced as the wave capstone after the remaining feature landings and
  the closing greening pass. Tracker:
  `issues/20260803-first-npm-latest-promotion.md`.
- **LLP 0150 OQ7 — ratified: keep both acquisition flows.** Approval link
  as the ergonomic default; pairing inversion retained (headless-human
  case; structural immunity to unsolicited requests); one converged
  request/approval/digest/poll contract with the closed
  `userSeeded`/`agentRequested` discriminator. Dated answer recorded in
  LLP 0150.
- Not included in this ratification: the LLP 0063 Step-6 semantics
  ratification for Draft LLPs 0068–0072
  (`issues/20260726-step6-ratification-and-independent-review.md`) remains
  open — it needs its own pass when Step 6 work resumes.

- **2026-08-03 — 0160 rulings + EAS enablement (Charlie Cheever).**
  (1) 0160 OQ6: tombstone-and-re-entry blessed as normative for
  incompatible-client offline-mutation settlement; dated LLP 0081
  amendment landed at its three sites; G4′b cleared to a conformance
  audit. (2) 0160 OQ3: the compatibility-verdict ownership split blessed
  as proposed (presentation half in 0160/G4′a; protocol fact restated in
  LLP 0093, closing 0037 CC-8.7). (3) 0160 OQ7 (G9b rollback input):
  routing approved — the ruling arrives with the tranche-3 drift audit's
  evidence. (4) Workers for Platforms purchased on the ccheever@expo.io
  account; the dispatch-namespaces probe now succeeds (receipt
  `demos/eas-phase0/receipts/p0-access-wfp-enabled.json`); EAS Phase 0's
  WfP-bound spikes are unblocked.
