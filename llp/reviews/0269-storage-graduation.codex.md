# Review artifact: LLP 0269 — codex family

Target: `llp/0269-storage-graduation.plan.md`

## Round 1 — 2026-08-16

- **Reviewer:** Codex gpt-5.6-sol, model_reasoning_effort=xhigh, read-only
  sandbox, fresh non-interactive session, blind to the other family's review.
- **Revision under review (v0.1):** sha256
  `718350775234c41f2ee92894ff1a9a14d4d5540c4bcb59e20ca1ae4d10f435d5`
  (authoring-worktree bytes, pre-commit).
- **Verdict:** NOT READY.

1. SEVERITY: MATERIAL — llp/0269-storage-graduation.plan.md:61 (§0.1 The implementation seam that exists today) — The commit description overstates shipped behavior by saying the ordinary path records settlement/envelope state. `src/storage/mutation_writes.rs:4-11` invokes the ordinary commit with `identity: None`; `src/storage.rs:4030-4041` and `4808-4819` record that state only under `if let Some(identity)`. The statement must be limited to identity-bearing covered lanes.

2. SEVERITY: MATERIAL — llp/0269-storage-graduation.plan.md:106 (§1.1 Extract the authority-store port without changing SQLite) — Phase 1 omits the current process-wide mutation serialization that must change before Postgres can provide the promised concurrent-writer authority. `src/server.rs:162` defines `SharedSnapback = Arc<Mutex<LocalSnapback>>`; `src/server/writer_gate.rs:20-37` says every server path reaching Hermes or rusqlite passes through that mutex; `src/bench.rs:105-108` explicitly says every mutation serializes on it. Extracting an async storage port and adding a Postgres commit fence does not itself remove this upper serialization point, yet no work item or concurrency-specific exit proof addresses it.

3. SEVERITY: MATERIAL — llp/0269-storage-graduation.plan.md:175 (§2 Phase 2 — Declared locality roots and cell partitioning) — Phase 2 is feasibility-gated, not demand-gated. Its entry requires only a stable candidate root and a high single-root share; it does not require evidence that the qualified Phase-1 single authority still misses a workload, availability, or economic envelope. The commission at `issues/20260815-storage-graduation-plan-commission.md:15-20` makes execution demand-gated, while this criterion permits building cells even when Postgres fully resolves the triggering ceiling.

4. SEVERITY: MATERIAL — llp/0269-storage-graduation.plan.md:208 (§2.2 Make the cell the complete authority domain) — The Plan introduces multiple streams inside one logical app without declaring the required amendment to LLP 0007. LLP 0007 lines 202-206 normatively scope one stream per logical app, and lines 292-298 say intra-app sharding may use distinct streams only after revisiting that note and may not ship otherwise. This Plan supplies much of the new design, but neither its work items nor exit criteria require reconciling the governing portability contract before Phase 2 support.

5. SEVERITY: MATERIAL — llp/0269-storage-graduation.plan.md:144 (§1.3 Qualify support and measure the graduation claim) — The A/B requires an “admission” clock and may trigger on concurrent-writer admission, but the cited LLP 0265 §§2–4 define exact clocks only for optimistic paint, commit acknowledgement, settlement, and observer convergence; admission appears only as something that does not qualify as settlement. No admission event boundary or record field is defined here, so an admission-bound graduation envelope cannot be gated reproducibly.

6. SEVERITY: MATERIAL — llp/0269-storage-graduation.plan.md:332 (§3 Phase 3 exit criteria) — The claimed class-by-class exit is internally contradictory. Every class is required to cover coordinator restart, every step crash cut, retry exhaustion, and compensation failure, although §3.1’s bounded fanout read, multi-cell live view, and global projection have no workflow coordinator, steps, retries, or compensation. This makes those classes depend on the durable-workflow implementation despite lines 332 and 348 saying support exits independently.

7. SEVERITY: MINOR — llp/0269-storage-graduation.plan.md:90 (§0.2 Terms and invariants) — The LLP 0209 citation is too narrow. Its §2 defines graph bounds, identities, and per-node dependencies, but authorization classification is in §3. Cite LLP 0209 §§2–3.

8. SEVERITY: MINOR — llp/0269-storage-graduation.plan.md:13 (§0 Charter and position) — I could not verify the claim that the author commissioned this Plan on 2026-08-16. The charter ticket records a 2026-08-15 ruling and a conditional future request; neither the repository nor this prompt records a separate 2026-08-16 author commission.
## Round 2 (delta) — 2026-08-16

- **Reviewer:** fresh Codex gpt-5.6-sol xhigh read-only session; delta review
  of v0.2 against both round-1 reviews.
- **Revision under review (v0.2):** sha256
  `f8d18fc61b609cdedf3bc39ef406e01b7c89dcf6abecb64094f66bb5a6533e46`.
- **Verdict:** NOT READY on a single residual item, adjudicated by the
  orchestrator (see run journal): round-1 finding 8's commission-provenance
  concern — the 2026-08-16 authoring commission is the author's session
  request of 2026-08-16; the repository record is the resolution note in
  `issues/closed/20260815-storage-graduation-plan-commission.md`, landed with
  this artifact. All other round-1 findings verified fixed; no new defects
  reported in the delta.


NOT-FIXED: Review A #8 — `llp/0269-storage-graduation.plan.md:6,13-16` merely asserts a separate 2026-08-16 commission. The only independent repository record remains `issues/20260815-storage-graduation-plan-commission.md:15-20`, which says to author the Plan when a demand trigger fires; neither that ticket nor the supplied prompt records the claimed superseding request to author it ahead of the trigger.