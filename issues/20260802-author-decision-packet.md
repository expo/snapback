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
