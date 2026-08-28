**Reviewer family:** Grok (xAI)
**Provider / runtime:** grok CLI 1.0.5, `grok-4.6` at xhigh reasoning effort, headless single-turn (`--prompt-file`), full terminal ban carried in the prompt and enforced with `--disallowed-tools bash,shell,terminal,execute`; built-in file reads only.
**Date:** 2026-08-27
**Redacted:** no
**Method:** cli-runner (detached background dispatch, orchestrator polled)

# Snapback simplification batch — Cluster B review artifact — Grok (xAI) family

Lockstep cluster: LLP 0322 (primary) + 0314.001 + 0324. This file is the single verbatim
preservation for the cluster in this family; per-target verdicts are
inside the review body. The non-primary targets carry
`.cluster-pointer.md` files pointing here.

## Round 1

- Revision under review: working tree at repository HEAD
  `d49ae32b50fcc1506fe79aee3680cae76eb5c12d`; per-target sha256 recorded
  in [`0318-one-authoring-profile.run.md`](./0318-one-authoring-profile.run.md).
- Capsule: live checkout, read in place. **Structural blindness** with
  respect to this batch — no review artifact for any of the eight targets
  existed anywhere in the tree at launch or during the run. The
  instruction ban on reading `llp/reviews/` is additionally
  **SELF-ATTESTED**, since both runners can read the whole checkout.
- Instruction brief sha256 (common body)
  `1848df190861b08b1d8a041b7131888fe706042de89f0aed861539a11e9e1a82`,
  plus the cluster target list and a runner-specific constraints block.
- Independence: separate process, fresh session, different model family
  from the second reviewer, and different from the orchestrating reviser
  (Claude) which authored the targets and cast no verdict.
- Runtime: dispatched concurrently with the other three round-1 runs; returned at the orchestrator's poll tick.
- Result: **0322 NOT READY (3 MATERIAL), 0314.001 NOT READY (2), 0324 NOT READY (1), SET NOT READY.**

### Verbatim review body

I'll review the three Cluster B RFCs as independent sketches, starting by reading each target in full and the cited parent/sibling LLPs before verifying counts against the shipped surfaces.The three sketches are in. Next I’ll verify their counts and quoted LLP claims against the registries, parent docs, and build packing path.Counts on the diagnostics registry match. Next I’ll check the content-hash/flat packing contract and the cited LLP positions, which is where a sketch-level decision can actually break.The counts that matter in this cluster are mostly right. The defects are elsewhere: 0322 misstates LLP 0193 and the HTTP-classified signal; 0314.001 misstates the guide identity hash and what the flats actually are; 0324 misidentifies LLP 0259’s first-read packet. Those are decision-quality errors, not polish.

---

## Overall

These three sketches are aimed at the right problems: a code space with implementation cardinality, a 20 MB guide blob that is mostly derived, and a 1,100-line root document that the overlay was invented to avoid. I verified the load-bearing inventories against this checkout. The diagnostics `counts` block, the 14 section flats, the whole-flat / section-flat byte pair, the 56-module registry, `build.rs`’s section-flat assertion, foundation’s 12 entries, 0000’s 162-entry `Related:` line, and the 0200 / 0312 overlay deviations are all real. The sketches go wrong when they convert those numbers into a partition rule, an identity story, or a citation of prior LLP positions.

I found no sequencing or cost contradiction among the three. 0314.001 correctly defers registry shrinking to 0322; 0322’s 2.5 MB / 755 KB figures match 0314.001; 0324 is independent of the size program.

---

## LLP 0322 — Tiered diagnostic codes

### Strengths

- The `counts` block is exact: `guide/reference/diagnostics-registry.json` lines 10–20 are `{ codes: 3575, sourceFiles: 631, emittingSites: 9597, receivedSites: 378, reservedSites: 11, httpClassified: 1702, guideAnchored: 452, environmentVariables: 188, environmentSites: 367 }`. 12.6% and 47.6% follow.
- The diagnosis is right: 3,575 names are a lookup table, not a vocabulary. LLP 0010 already has the open question “Which diagnostic codes are stable enough for v1?” This RFC is the first document that tries to answer it.
- “What this does not do” correctly keeps emitting-site cardinality. 9,597 sites are not the problem.
- OQ2 (50–150 vs 400+) and OQ3 (do it before there are users) are the right shape of uncertainty.

### Concerns

**MATERIAL — §3 “It does not weaken LLP 0193”; also §2 public-tier definition.**

The document treats 0193 as “failures should be self-documenting,” then claims a public code plus a `detail` field is *more* self-documenting than 3,575 sparsely anchored codes. That is not what 0193 says.

LLP 0193’s bar, quoting 0186 W3, is: **every `SNAPBACK_*` refusal an authoring agent can trigger names the violated rule and either the fix or a resolving guide anchor** (`llp/0193-errors-as-docs-completeness.plan.md:53-56`). Codes that are genuinely internal — **never agent-triggerable** — are marked in the ledger rather than polished. **Later reclassification of an agent-triggerable code to internal is refused mechanically by the drift gate**, same bar as a grade regression (`:113-116`, exit criterion 3 at `:319-321`). Exit criterion 2 requires every agent-triggerable ledger entry to be grade A.

Demoting the HTTP/generate population toward 50–150 public codes, with internal identifiers that have “no stability promise, no guide anchor required, not in the published registry” (§2), is mass reclassification of agent-triggerable refusals. That *is* an amendment to 0193, and a weakening unless every `detail` value still carries a grade-A remediation. The RFC never says it amends 0193, so the partition is drawn as if 0193 were already satisfied by family-level prose.

Fix: either (a) state that this RFC amends 0193 (and 0010) to change the granularity of the promised vocabulary, and that the one-time demotion is an explicit override of the reclassification-refusal; or (b) keep every agent-triggerable `SNAPBACK_*` as a public `code` and use the internal tier only for the “never agent-triggerable” set 0193 already named. (a) is the sketch the rest of the document wants; (b) will not yield 50–150.

**MATERIAL — §1 “1,702 of 3,575 are HTTP-classified. The rest never cross a wire boundary to a client at all”; §4 OQ1.**

`httpClassified` is not an observation of the wire. `scripts/generate-diagnostics-registry.mjs:471-491` (`parseHttpStatuses`) reads **the reviewed HTTP status table in `crates/snapback-server/src/server/tests.rs`**. A code is HTTP-classified iff that test table assigns it a `StatusCode`. Codes missing from the table can still be returned over HTTP, MCP, CLI, or `snapback generate`. Codes in the table include 5xx internals that cross the wire and are not “actionable by an app author.”

OQ1 then uses 1,702 as “an upper bound before further pruning” for a mechanical public-tier rule. That bound is neither an upper nor a lower bound on author-facing refusals. The 452 already-anchored codes are a better existing “worth documenting” set, and the RFC never considers them as the seed.

Fix: drop the “never cross a wire” sentence. Define the mechanical rule in terms of 0193’s agent-triggerable predicate (or a CI-checkable published-surface reachability set), and treat `httpClassified` as one heuristic input, not the population.

**MATERIAL — §2 wire shape `{ code, detail }`; §4 OQ4; §5 “the wire-shape change is small.”**

The proposed field does not survive contact with the current diagnostic contract:

1. The wire type is already `{ code, severity, subsystem, message, details }` with `details` a JSON **object**. Remediations attach *into* `details` (`crates/snapback-types/src/diagnostic.rs:25-31, 108-118`). A sibling `detail` string collides with that object; stuffing a demoted code slug into `details` needs a named key that does not smash 0146/0193 remediations.
2. `PublicDiagnostic` already exists (`:37-41`) as `{ code, severity, subsystem }` — a different public/internal axis (unauthenticated inspection vs operator context). This RFC’s tier names collide with that type and never distinguish the two axes.
3. `@expo/snapback-client` publishes `SnapbackDiagnosticCode` as a union of **all 3,575 codes** (`packages/snapback-client/diagnostic-codes.d.mts:3-3578`, re-exported from `index.d.mts`). The generator’s `@ref` is `LLP 0193#program — the client diagnostic vocabulary is source-complete and drift-checked`. OQ4 only mentions acceptance-test assertions. The published TypeScript union *is* the client contract. Shrinking `code` to 50–150 without a migration story for that union is a lost capability the document claims it is merely “promising” less of.

Fix: specify composition with `details` / remediation-set / `PublicDiagnostic`; add the generated client union to OQ4; decide whether internal identifiers remain `SNAPBACK_*` strings (reserved per LLP 0010:861, “Retired diagnostic codes remain reserved”) or become slugs.

**minor — §2 / §3 drift-gate win.** CLAUDE.md’s pain is a **committed, site-keyed** `diagnostics-registry.json`. “Does not ship” is not “is not committed.” If the internal uniqueness inventory remains a checked-in site-keyed artifact, line-number motion still regenerates it and still dirties landings. The claimed “mostly stops” win only holds if the committed consumer-facing file keys on codes, not sites. Say that explicitly. (This also interacts with 0314.001: `contentHash` includes the diagnostics JSON bytes, so site lines in the shipped registry restamp guide identity.)

**minor — §1 “no prose in the guide.”** `guideAnchored: 452` means no matching heading slug. A code can be discussed in guide prose without a heading that the scraper recognizes. The 87% figure is “no registry anchor,” not “no prose.”

### Missing objections 0322 does not anticipate

- LLP 0010 already asks which codes are stable enough for v1, and requires retired names to stay reserved for historical records. The RFC cites 0010 in Related and never uses either sentence.
- `snapback guide <CODE>` on a demoted identifier: if the agent copies `detail` (or a log line still printing the source `SNAPBACK_*`) into `snapback guide`, does lookup fail closed, alias, or search the internal inventory?
- Environment variables (OQ5) are the right split-out; the same file also carries `received` and `reserved` site kinds, which are a third taxonomy.

### Verdict on 0322

The two-tier idea is not misconceived. The claim that it leaves 0193 untouched, the use of `httpClassified` as a wire-boundary census, and the invented `{ code, detail }` shape are defective. Not ready.

---

## LLP 0314.001 — Stop shipping derived guide bytes

### Strengths

- Parent/sibling relationship is correctly drawn. LLP 0314 F4 is the ~20 MB embed; LLP 0314.000 Phase 2 relocates the corpus and says so (“Phase 2 relocates the Guide, it does not delete it”). This RFC is the complementary “what is in the corpus” move. That is not a duplicate of 0314.000.
- Whole-flat and section-flat bytes match `guide/guide-manifest.generated.json` `flatProjections` exactly: 4,084,811 and 4,086,223 (difference 1,412). Fourteen section flats exist. `build.rs:138-141` does assert a section-flat path before packing. `GET /_snapback/guide/flat.md` and the per-section `servedPath`s are the URLs the manifest already publishes.
- 56 modules in `registry.json` is exact (`"subpath"` appears 56 times). ~3.5 KB/symbol is the right arithmetic if 1,461 is right; I did not independently finish counting symbols (the file is too large for the search cap) but nothing in the module table contradicts it.
- Confidence split (0.85 flats / 0.5 registries) is honest. §2c’s deferral to 0322/0323 is the right sequencing, not a third size theory.
- “Does not conflict with Phase 2” is right on the assembly modes, pack-time refusal, and sidecar-carries-fewer-bytes point.

### Concerns

**MATERIAL — §2a “headers are unchanged — the digest is over content the server already has”; §4 OQ3 “It currently covers the packed set including the flats.”**

OQ3’s description of `contentHash` is false, and it is the same falsehood LLP 0314.000 r5 spent a review cycle correcting.

The hash domain is the **whole-corpus flat bytes + labeled `registry.json` + labeled `diagnostics-registry.json`**:

```1271:1281:scripts/guide-lib.mjs
  manifest.contentHash = createHash('sha256')
    .update(wholeFlat)
    .update('\0guide-resource\0')
    .update(SYMBOL_REGISTRY_PATH)
    ...
    .update(diagnosticsBytes)
```

Same construction in `crates/snapback-server/src/guide.rs:174-196`. The test at `crates/snapback/tests/served_guide_v1.rs:165-167` even comments: “contentHash now binds both the flat Markdown and non-Markdown registry bytes, so it intentionally is not the flat SHA.”

LLP 0314.000 Phase 2, Load validation (`:358-361`), states the sibling fact explicitly: **the compiled-in manifest `contentHash` does not bind every record (LLP 0284 §3.7 — pages, section flats, non-`contentHash` manifest bytes)**, which is why Phase 2 compiles in a whole-artifact `artifactSha256`.

Consequences the RFC gets backwards:

- Removing the 14 **section** flats does **not** change `contentHash`. They are packed, not hashed.
- Removing `guide-flat.generated.md` **does**, unless the server still produces those exact bytes as the hash input.
- Pages are **not** in the hash. “The digest is over content the server already has” is true only after you recompute the whole flat with the generator’s function. Hashing the page set would *change the meaning* of `x-snapback-guide-content-sha256`, which 0194 and the served-guide tests treat as stable domain.

Reconciling with 0314.000 r5 from this false “packed set including the flats” premise will design the wrong identity. Fix: restate the current domain (whole flat + two JSON registries); say section-flat removal is hash-neutral; say whole-flat removal requires either keeping `renderFlatGuide` as a pure function on embedded pages (bit-identical, including the `<!-- Generated ... -->` header) or an explicit 0194/0061 identity amendment. Point OQ3 at that choice, not at a packed-set hash that does not exist.

**MATERIAL — Summary “byte-for-byte concatenation of the 4.09 MB of section flats”; §1 “They are the same content twice”; §2a “Concatenation is a pure function of the manifest plus the pages”; §3 “It does not change any Guide URL or response body.”**

The whole-corpus flat is **not** a concatenation of the 14 section files. `scripts/guide-lib.mjs:1286-1291`:

> Build the one-request projection in manifest nav order. The capability index is deliberately first even though it also participates in the nav; every remaining page appears exactly once.

That is the 0061 §4a bulk projection. Section flats are a partition with their own headers. The 1,412-byte gap is not “separator framing” of `cat`ing 14 files; it is two different projections over the same pages. The summary’s “byte-for-byte concatenation” is internally contradicted by the 1,412-byte row in the same document.

The response-body invariant therefore is: on-demand output must be bit-identical to `renderFlatGuide` / `buildSectionFlatGuides`, because `served_guide_v1.rs:130-133` and `:158-161` `include_bytes!` the committed whole flat and assert the HTTP body equals it. A naive join of pages, or a join of section flats, will fail those tests and change the hashed whole-flat bytes.

OQ2 asks whether anything consumes flats from disk rather than HTTP, then guesses MCP. The first disk consumers are those `include_bytes!` tests. MCP is second.

Fix: drop “byte-for-byte concatenation of the section flats.” Name `renderFlatGuide` as the function that must be reused. Add the served-guide tests to OQ2. If the files leave `guide/`, the tests cannot `include_bytes!` them — generate-at-test-time or assert against the live handler.

**minor — Summary “The largest single file in the corpus is a 4.08 MB whole-corpus flat.”** The same table lists `registry.json` at 5,162,043 bytes. Largest file is the symbol registry. Does not change the redundancy argument.

**minor — §1 “176 `.md`, all sections” as hand-written source.** A directory listing of `guide/**/*.md` excluding flats is ~157 files plus 19 under `eval-runs/`. `build.rs:240` skips `eval-runs/` when packing. If 176 includes eval-runs, those bytes are not in the ~20 MB embed. The ~2.3 MB row should be the packed non-generated pages, not a glob that includes retrieval-eval evidence.

**minor — §3 “It does not amend LLP 0061 §4a.”** Carriage (embedded vs sidecar) is indeed not what this RFC changes, and that distinction is the valuable one. But 0061 §4a’s packed-set bullet names “every generated flat below” as part of what `build.rs` embeds (`llp/0061-agent-first-snapback-guide.rfc.md:547-549`), and the 2026-08-09 tiered-projection amendment requires the generator to emit and check those flats. This is a one-sentence packed-set amendment, not a carriage amendment. Say that; do not claim §4a is untouched.

**minor — §2a “sizes become computed rather than `stat`ed.”** `/llms.txt` is a compiled-in static (`crates/snapback-server/src/server.rs:10490-10492`). Manifest `flatProjections.bytes` are already computed at generate time, not `stat`ed at serve time.

### Missing objections 0314.001 does not anticipate

- Of the 4.09 MB of section flats, the **reference** section alone is 2,289,259 bytes. Most of the “8.2 MB of concatenations of pages already present” is concatenating *generated* `guide/reference/*.md`, not the ~2 MB of hand-authored prose. The redundancy argument still holds; the cheapest 8.2 MB is not “we packed the essays twice.”
- Check-guide / inventory freshness currently treats committed flats as the thing that must not drift. Deleting them is a generator/checker change, not just a packer change. That is implementation, but it is why the files exist — not because they were “sitting in the directory.”
- Landing conflict: open issues already record multi-lane fights over `guide-flat.generated.md` and `guide-flat.reference.generated.md`. Stopping committing those files is a hygiene win 0314.000 never named. Worth one sentence; it is a reason to do §2a even after Phase 2 relocates the blob.

### Verdict on 0314.001

§2a (stop packing flats, serve them as a pure function) is the right cheap cut, and it is not in 0314.000. The identity story is wrong in a way that will mis-reconcile with Phase 2 and 0194. Not ready.

---

## LLP 0324 — Compact the root document

### Strengths

- 0000 is 1,103 lines in this checkout (RFC says 1,102; off by one, irrelevant). `Related:` is 0001–0162 inclusive = 162 named LLPs. Foundation has 12 entries. The overlay observation is the right diagnosis: `foundation/` + `current/` exist to answer “where do I start,” and 0000 has not been put through that discipline.
- 0200 as a 58-byte path file (`../0200-live-evaluation-scheduling-and-settlement.spec.md`) and `current/llp-0312-origin-bound-asset-carriers.rfc.md` vs target `0312-origin-bound-asset-carriers.rfc.md` are both real. LLP 0315 is cited from 0310 and has no `llp/0315-*.md`; 0316 is unallocated. Recording those and leaving them to `llp-maintain` is the correct “what this does not do.”
- Moving the ratification ledger to `0000.000` preserves the citation shape “LLP 0000 ratification ledger.” OQ1 (sub-LLP vs `foundation/` membership) is the actual contested question. OQ4 (mechanical relocation vs rewriting the summary) is the right authority split.
- “Does not add a gate” / 0189+0232 is correct for editorial work.
- Pointing `Related:` at a generated `llp/index.md` rather than stuffing 323 names back into the header is the option that does not recreate the problem.

### Concerns

**MATERIAL — §1 contrast; §6 “LLP 0259 … first read should be small.”**

The RFC identifies “the whole hand-written `guide/start/` section” as “the LLP 0259 first-read packet,” measures it at **44 KB**, and says 0000 at 79 KB is “nearly twice” that budgeted surface.

That is not what 0259 says, and 44 KB is not what `start/` weighs.

- LLP 0259’s first read is a **template-specific start packet** with hard caps: mental-model ≤ 3 KiB, full packet ≤ 6 KiB, stub ≤ 1 KiB, steering ceiling **16 KiB** (`llp/0259-agent-first-read-budget.rfc.md:437-443`). `guide/start/index.md:18-21` repeats that: read your template’s packet, escalate one page at a time.
- The start **section flat** — the concatenation of those pages — is **21,502 bytes** (`guide/guide-manifest.generated.json:14093-14099`), not 44 KB. 44,677 bytes in 0259 is `guide/clients/react.md` (`:145`), a feature page 0259 cites as the *over-read* problem, not the start packet.
- Against the actual 0259 ceiling, 0000 at 79 KB is ~5× the steering budget, not “nearly twice.” The direction (compact 0000) gets stronger with the real numbers; the cited prior-art is still wrong. This is the same class of failure the brief flags (misattributed LLP position).

Fix: compare 0000 to 0259’s 16 KiB steering / 6 KiB packet caps, and/or to the 21.5 KB start-section flat. Do not call `guide/start/` “the 0259 first-read packet.” The packet is one transcluded file, digest-checked, per template.

**minor — §1 `llp/current/` entries = 13.** This checkout’s `llp/current/` has **21** entries. 13 is the working set *before* this batch was linked into `current/` (the eight sketches plus 0314.001). The overlay still exists; the standing “13-document working set” sentence is already stale in the document that is part of why it grew.

**minor — “first [`Revised:`] entry alone is several hundred words.”** Reverse-chronological first entry is the 2026-08-25 kernel note (`llp/0000-snapback.explainer.md:9-11`), ~40 words. The several-hundred-word blob is the oldest bundled `Revised:` line (`:22`). The header is still too long; the “first entry” claim is false.

**minor — status distribution 118/103/36/36/26/…** I could not fully recount under the search cap. Non-standard header statuses are real (`Implemented (local slice)`, `Superseded in part`, `Review — implements LLP 0292…`, `Tombstoned 2026-08-01 — absorbed…`). That is enough to keep the “ref-check parses, does not constrain vocabulary” observation. Do not treat the exact histogram as a finding this RFC will act on; it already says it will not.

### Missing objections 0324 does not anticipate

- After the split, agents will keep appending ratification lines to 0000 because that is the habit the corpus taught. 0000.000 needs a one-line “append here, not to 0000” rule, or the root grows again.
- A generated `Related:` of 323 names in the 0000 header recreates the 162-name problem. The body already prefers `llp/index.md`; make that the proposal, not an “or better.”
- 0000 is itself a `foundation/` member. Compacting it changes the kernel document. That is fine and reversible; it is still a foundation edit, not “just editorial in current/.”

### Verdict on 0324

The proposal is the smallest and safest item in the batch. The 0259 contrast is a misidentified object with a wrong byte count. That is one MATERIAL citation fix, not a reason to abandon the rewrite. Not ready until it is fixed.

---

## Cross-document

No cost or dependency contradiction among 0322, 0314.001, and 0324. Shared inventories that I could check agree. Two connections the set should state and does not:

1. `contentHash` includes `diagnostics-registry.json`. A site-keyed shipped registry means Rust line-number motion restamps **guide identity**, not only the CLAUDE.md inventory file. 0322’s “key the published file on codes, not sites” is therefore also a 0314 identity-churn cut. Neither document says so.
2. 0314.001 §2b (ship one of `diagnostics.md` / `diagnostics-registry.json`) and 0322 (public registry carries prose) converge: after 0322, the public file *is* the prose, and shipping both forms is even less defensible. Fine if 0322 is accepted; say the order.

---

## Suggested next step

Revise in place. Do not replace any of these with a different document. The three directions are sound; the MATERIAL items are false descriptions of current contracts (0193, `contentHash`/flats, 0259). After those three corrections, this cluster is a decision-quality sketch set.

```
LLP 0322: NOT READY (3 MATERIAL)
LLP 0314.001: NOT READY (2 MATERIAL)
LLP 0324: NOT READY (1 MATERIAL)
SET: NOT READY
```
The counts that matter in this cluster are mostly right. The defects are elsewhere: 0322 misstates LLP 0193 and the HTTP-classified signal; 0314.001 misstates the guide identity hash and what the flats actually are; 0324 misidentifies LLP 0259’s first-read packet. Those are decision-quality errors, not polish.

---

## Overall

These three sketches are aimed at the right problems: a code space with implementation cardinality, a 20 MB guide blob that is mostly derived, and a 1,100-line root document that the overlay was invented to avoid. I verified the load-bearing inventories against this checkout. The diagnostics `counts` block, the 14 section flats, the whole-flat / section-flat byte pair, the 56-module registry, `build.rs`’s section-flat assertion, foundation’s 12 entries, 0000’s 162-entry `Related:` line, and the 0200 / 0312 overlay deviations are all real. The sketches go wrong when they convert those numbers into a partition rule, an identity story, or a citation of prior LLP positions.

I found no sequencing or cost contradiction among the three. 0314.001 correctly defers registry shrinking to 0322; 0322’s 2.5 MB / 755 KB figures match 0314.001; 0324 is independent of the size program.

---

## LLP 0322 — Tiered diagnostic codes

### Strengths

- The `counts` block is exact: `guide/reference/diagnostics-registry.json` lines 10–20 are `{ codes: 3575, sourceFiles: 631, emittingSites: 9597, receivedSites: 378, reservedSites: 11, httpClassified: 1702, guideAnchored: 452, environmentVariables: 188, environmentSites: 367 }`. 12.6% and 47.6% follow.
- The diagnosis is right: 3,575 names are a lookup table, not a vocabulary. LLP 0010 already has the open question “Which diagnostic codes are stable enough for v1?” This RFC is the first document that tries to answer it.
- “What this does not do” correctly keeps emitting-site cardinality. 9,597 sites are not the problem.
- OQ2 (50–150 vs 400+) and OQ3 (do it before there are users) are the right shape of uncertainty.

### Concerns

**MATERIAL — §3 “It does not weaken LLP 0193”; also §2 public-tier definition.**

The document treats 0193 as “failures should be self-documenting,” then claims a public code plus a `detail` field is *more* self-documenting than 3,575 sparsely anchored codes. That is not what 0193 says.

LLP 0193’s bar, quoting 0186 W3, is: **every `SNAPBACK_*` refusal an authoring agent can trigger names the violated rule and either the fix or a resolving guide anchor** (`llp/0193-errors-as-docs-completeness.plan.md:53-56`). Codes that are genuinely internal — **never agent-triggerable** — are marked in the ledger rather than polished. **Later reclassification of an agent-triggerable code to internal is refused mechanically by the drift gate**, same bar as a grade regression (`:113-116`, exit criterion 3 at `:319-321`). Exit criterion 2 requires every agent-triggerable ledger entry to be grade A.

Demoting the HTTP/generate population toward 50–150 public codes, with internal identifiers that have “no stability promise, no guide anchor required, not in the published registry” (§2), is mass reclassification of agent-triggerable refusals. That *is* an amendment to 0193, and a weakening unless every `detail` value still carries a grade-A remediation. The RFC never says it amends 0193, so the partition is drawn as if 0193 were already satisfied by family-level prose.

Fix: either (a) state that this RFC amends 0193 (and 0010) to change the granularity of the promised vocabulary, and that the one-time demotion is an explicit override of the reclassification-refusal; or (b) keep every agent-triggerable `SNAPBACK_*` as a public `code` and use the internal tier only for the “never agent-triggerable” set 0193 already named. (a) is the sketch the rest of the document wants; (b) will not yield 50–150.

**MATERIAL — §1 “1,702 of 3,575 are HTTP-classified. The rest never cross a wire boundary to a client at all”; §4 OQ1.**

`httpClassified` is not an observation of the wire. `scripts/generate-diagnostics-registry.mjs:471-491` (`parseHttpStatuses`) reads **the reviewed HTTP status table in `crates/snapback-server/src/server/tests.rs`**. A code is HTTP-classified iff that test table assigns it a `StatusCode`. Codes missing from the table can still be returned over HTTP, MCP, CLI, or `snapback generate`. Codes in the table include 5xx internals that cross the wire and are not “actionable by an app author.”

OQ1 then uses 1,702 as “an upper bound before further pruning” for a mechanical public-tier rule. That bound is neither an upper nor a lower bound on author-facing refusals. The 452 already-anchored codes are a better existing “worth documenting” set, and the RFC never considers them as the seed.

Fix: drop the “never cross a wire” sentence. Define the mechanical rule in terms of 0193’s agent-triggerable predicate (or a CI-checkable published-surface reachability set), and treat `httpClassified` as one heuristic input, not the population.

**MATERIAL — §2 wire shape `{ code, detail }`; §4 OQ4; §5 “the wire-shape change is small.”**

The proposed field does not survive contact with the current diagnostic contract:

1. The wire type is already `{ code, severity, subsystem, message, details }` with `details` a JSON **object**. Remediations attach *into* `details` (`crates/snapback-types/src/diagnostic.rs:25-31, 108-118`). A sibling `detail` string collides with that object; stuffing a demoted code slug into `details` needs a named key that does not smash 0146/0193 remediations.
2. `PublicDiagnostic` already exists (`:37-41`) as `{ code, severity, subsystem }` — a different public/internal axis (unauthenticated inspection vs operator context). This RFC’s tier names collide with that type and never distinguish the two axes.
3. `@expo/snapback-client` publishes `SnapbackDiagnosticCode` as a union of **all 3,575 codes** (`packages/snapback-client/diagnostic-codes.d.mts:3-3578`, re-exported from `index.d.mts`). The generator’s `@ref` is `LLP 0193#program — the client diagnostic vocabulary is source-complete and drift-checked`. OQ4 only mentions acceptance-test assertions. The published TypeScript union *is* the client contract. Shrinking `code` to 50–150 without a migration story for that union is a lost capability the document claims it is merely “promising” less of.

Fix: specify composition with `details` / remediation-set / `PublicDiagnostic`; add the generated client union to OQ4; decide whether internal identifiers remain `SNAPBACK_*` strings (reserved per LLP 0010:861, “Retired diagnostic codes remain reserved”) or become slugs.

**minor — §2 / §3 drift-gate win.** CLAUDE.md’s pain is a **committed, site-keyed** `diagnostics-registry.json`. “Does not ship” is not “is not committed.” If the internal uniqueness inventory remains a checked-in site-keyed artifact, line-number motion still regenerates it and still dirties landings. The claimed “mostly stops” win only holds if the committed consumer-facing file keys on codes, not sites. Say that explicitly. (This also interacts with 0314.001: `contentHash` includes the diagnostics JSON bytes, so site lines in the shipped registry restamp guide identity.)

**minor — §1 “no prose in the guide.”** `guideAnchored: 452` means no matching heading slug. A code can be discussed in guide prose without a heading that the scraper recognizes. The 87% figure is “no registry anchor,” not “no prose.”

### Missing objections 0322 does not anticipate

- LLP 0010 already asks which codes are stable enough for v1, and requires retired names to stay reserved for historical records. The RFC cites 0010 in Related and never uses either sentence.
- `snapback guide <CODE>` on a demoted identifier: if the agent copies `detail` (or a log line still printing the source `SNAPBACK_*`) into `snapback guide`, does lookup fail closed, alias, or search the internal inventory?
- Environment variables (OQ5) are the right split-out; the same file also carries `received` and `reserved` site kinds, which are a third taxonomy.

### Verdict on 0322

The two-tier idea is not misconceived. The claim that it leaves 0193 untouched, the use of `httpClassified` as a wire-boundary census, and the invented `{ code, detail }` shape are defective. Not ready.

---

## LLP 0314.001 — Stop shipping derived guide bytes

### Strengths

- Parent/sibling relationship is correctly drawn. LLP 0314 F4 is the ~20 MB embed; LLP 0314.000 Phase 2 relocates the corpus and says so (“Phase 2 relocates the Guide, it does not delete it”). This RFC is the complementary “what is in the corpus” move. That is not a duplicate of 0314.000.
- Whole-flat and section-flat bytes match `guide/guide-manifest.generated.json` `flatProjections` exactly: 4,084,811 and 4,086,223 (difference 1,412). Fourteen section flats exist. `build.rs:138-141` does assert a section-flat path before packing. `GET /_snapback/guide/flat.md` and the per-section `servedPath`s are the URLs the manifest already publishes.
- 56 modules in `registry.json` is exact (`"subpath"` appears 56 times). ~3.5 KB/symbol is the right arithmetic if 1,461 is right; I did not independently finish counting symbols (the file is too large for the search cap) but nothing in the module table contradicts it.
- Confidence split (0.85 flats / 0.5 registries) is honest. §2c’s deferral to 0322/0323 is the right sequencing, not a third size theory.
- “Does not conflict with Phase 2” is right on the assembly modes, pack-time refusal, and sidecar-carries-fewer-bytes point.

### Concerns

**MATERIAL — §2a “headers are unchanged — the digest is over content the server already has”; §4 OQ3 “It currently covers the packed set including the flats.”**

OQ3’s description of `contentHash` is false, and it is the same falsehood LLP 0314.000 r5 spent a review cycle correcting.

The hash domain is the **whole-corpus flat bytes + labeled `registry.json` + labeled `diagnostics-registry.json`**:

```1271:1281:scripts/guide-lib.mjs
  manifest.contentHash = createHash('sha256')
    .update(wholeFlat)
    .update('\0guide-resource\0')
    .update(SYMBOL_REGISTRY_PATH)
    ...
    .update(diagnosticsBytes)
```

Same construction in `crates/snapback-server/src/guide.rs:174-196`. The test at `crates/snapback/tests/served_guide_v1.rs:165-167` even comments: “contentHash now binds both the flat Markdown and non-Markdown registry bytes, so it intentionally is not the flat SHA.”

LLP 0314.000 Phase 2, Load validation (`:358-361`), states the sibling fact explicitly: **the compiled-in manifest `contentHash` does not bind every record (LLP 0284 §3.7 — pages, section flats, non-`contentHash` manifest bytes)**, which is why Phase 2 compiles in a whole-artifact `artifactSha256`.

Consequences the RFC gets backwards:

- Removing the 14 **section** flats does **not** change `contentHash`. They are packed, not hashed.
- Removing `guide-flat.generated.md` **does**, unless the server still produces those exact bytes as the hash input.
- Pages are **not** in the hash. “The digest is over content the server already has” is true only after you recompute the whole flat with the generator’s function. Hashing the page set would *change the meaning* of `x-snapback-guide-content-sha256`, which 0194 and the served-guide tests treat as stable domain.

Reconciling with 0314.000 r5 from this false “packed set including the flats” premise will design the wrong identity. Fix: restate the current domain (whole flat + two JSON registries); say section-flat removal is hash-neutral; say whole-flat removal requires either keeping `renderFlatGuide` as a pure function on embedded pages (bit-identical, including the `<!-- Generated ... -->` header) or an explicit 0194/0061 identity amendment. Point OQ3 at that choice, not at a packed-set hash that does not exist.

**MATERIAL — Summary “byte-for-byte concatenation of the 4.09 MB of section flats”; §1 “They are the same content twice”; §2a “Concatenation is a pure function of the manifest plus the pages”; §3 “It does not change any Guide URL or response body.”**

The whole-corpus flat is **not** a concatenation of the 14 section files. `scripts/guide-lib.mjs:1286-1291`:

> Build the one-request projection in manifest nav order. The capability index is deliberately first even though it also participates in the nav; every remaining page appears exactly once.

That is the 0061 §4a bulk projection. Section flats are a partition with their own headers. The 1,412-byte gap is not “separator framing” of `cat`ing 14 files; it is two different projections over the same pages. The summary’s “byte-for-byte concatenation” is internally contradicted by the 1,412-byte row in the same document.

The response-body invariant therefore is: on-demand output must be bit-identical to `renderFlatGuide` / `buildSectionFlatGuides`, because `served_guide_v1.rs:130-133` and `:158-161` `include_bytes!` the committed whole flat and assert the HTTP body equals it. A naive join of pages, or a join of section flats, will fail those tests and change the hashed whole-flat bytes.

OQ2 asks whether anything consumes flats from disk rather than HTTP, then guesses MCP. The first disk consumers are those `include_bytes!` tests. MCP is second.

Fix: drop “byte-for-byte concatenation of the section flats.” Name `renderFlatGuide` as the function that must be reused. Add the served-guide tests to OQ2. If the files leave `guide/`, the tests cannot `include_bytes!` them — generate-at-test-time or assert against the live handler.

**minor — Summary “The largest single file in the corpus is a 4.08 MB whole-corpus flat.”** The same table lists `registry.json` at 5,162,043 bytes. Largest file is the symbol registry. Does not change the redundancy argument.

**minor — §1 “176 `.md`, all sections” as hand-written source.** A directory listing of `guide/**/*.md` excluding flats is ~157 files plus 19 under `eval-runs/`. `build.rs:240` skips `eval-runs/` when packing. If 176 includes eval-runs, those bytes are not in the ~20 MB embed. The ~2.3 MB row should be the packed non-generated pages, not a glob that includes retrieval-eval evidence.

**minor — §3 “It does not amend LLP 0061 §4a.”** Carriage (embedded vs sidecar) is indeed not what this RFC changes, and that distinction is the valuable one. But 0061 §4a’s packed-set bullet names “every generated flat below” as part of what `build.rs` embeds (`llp/0061-agent-first-snapback-guide.rfc.md:547-549`), and the 2026-08-09 tiered-projection amendment requires the generator to emit and check those flats. This is a one-sentence packed-set amendment, not a carriage amendment. Say that; do not claim §4a is untouched.

**minor — §2a “sizes become computed rather than `stat`ed.”** `/llms.txt` is a compiled-in static (`crates/snapback-server/src/server.rs:10490-10492`). Manifest `flatProjections.bytes` are already computed at generate time, not `stat`ed at serve time.

### Missing objections 0314.001 does not anticipate

- Of the 4.09 MB of section flats, the **reference** section alone is 2,289,259 bytes. Most of the “8.2 MB of concatenations of pages already present” is concatenating *generated* `guide/reference/*.md`, not the ~2 MB of hand-authored prose. The redundancy argument still holds; the cheapest 8.2 MB is not “we packed the essays twice.”
- Check-guide / inventory freshness currently treats committed flats as the thing that must not drift. Deleting them is a generator/checker change, not just a packer change. That is implementation, but it is why the files exist — not because they were “sitting in the directory.”
- Landing conflict: open issues already record multi-lane fights over `guide-flat.generated.md` and `guide-flat.reference.generated.md`. Stopping committing those files is a hygiene win 0314.000 never named. Worth one sentence; it is a reason to do §2a even after Phase 2 relocates the blob.

### Verdict on 0314.001

§2a (stop packing flats, serve them as a pure function) is the right cheap cut, and it is not in 0314.000. The identity story is wrong in a way that will mis-reconcile with Phase 2 and 0194. Not ready.

---

## LLP 0324 — Compact the root document

### Strengths

- 0000 is 1,103 lines in this checkout (RFC says 1,102; off by one, irrelevant). `Related:` is 0001–0162 inclusive = 162 named LLPs. Foundation has 12 entries. The overlay observation is the right diagnosis: `foundation/` + `current/` exist to answer “where do I start,” and 0000 has not been put through that discipline.
- 0200 as a 58-byte path file (`../0200-live-evaluation-scheduling-and-settlement.spec.md`) and `current/llp-0312-origin-bound-asset-carriers.rfc.md` vs target `0312-origin-bound-asset-carriers.rfc.md` are both real. LLP 0315 is cited from 0310 and has no `llp/0315-*.md`; 0316 is unallocated. Recording those and leaving them to `llp-maintain` is the correct “what this does not do.”
- Moving the ratification ledger to `0000.000` preserves the citation shape “LLP 0000 ratification ledger.” OQ1 (sub-LLP vs `foundation/` membership) is the actual contested question. OQ4 (mechanical relocation vs rewriting the summary) is the right authority split.
- “Does not add a gate” / 0189+0232 is correct for editorial work.
- Pointing `Related:` at a generated `llp/index.md` rather than stuffing 323 names back into the header is the option that does not recreate the problem.

### Concerns

**MATERIAL — §1 contrast; §6 “LLP 0259 … first read should be small.”**

The RFC identifies “the whole hand-written `guide/start/` section” as “the LLP 0259 first-read packet,” measures it at **44 KB**, and says 0000 at 79 KB is “nearly twice” that budgeted surface.

That is not what 0259 says, and 44 KB is not what `start/` weighs.

- LLP 0259’s first read is a **template-specific start packet** with hard caps: mental-model ≤ 3 KiB, full packet ≤ 6 KiB, stub ≤ 1 KiB, steering ceiling **16 KiB** (`llp/0259-agent-first-read-budget.rfc.md:437-443`). `guide/start/index.md:18-21` repeats that: read your template’s packet, escalate one page at a time.
- The start **section flat** — the concatenation of those pages — is **21,502 bytes** (`guide/guide-manifest.generated.json:14093-14099`), not 44 KB. 44,677 bytes in 0259 is `guide/clients/react.md` (`:145`), a feature page 0259 cites as the *over-read* problem, not the start packet.
- Against the actual 0259 ceiling, 0000 at 79 KB is ~5× the steering budget, not “nearly twice.” The direction (compact 0000) gets stronger with the real numbers; the cited prior-art is still wrong. This is the same class of failure the brief flags (misattributed LLP position).

Fix: compare 0000 to 0259’s 16 KiB steering / 6 KiB packet caps, and/or to the 21.5 KB start-section flat. Do not call `guide/start/` “the 0259 first-read packet.” The packet is one transcluded file, digest-checked, per template.

**minor — §1 `llp/current/` entries = 13.** This checkout’s `llp/current/` has **21** entries. 13 is the working set *before* this batch was linked into `current/` (the eight sketches plus 0314.001). The overlay still exists; the standing “13-document working set” sentence is already stale in the document that is part of why it grew.

**minor — “first [`Revised:`] entry alone is several hundred words.”** Reverse-chronological first entry is the 2026-08-25 kernel note (`llp/0000-snapback.explainer.md:9-11`), ~40 words. The several-hundred-word blob is the oldest bundled `Revised:` line (`:22`). The header is still too long; the “first entry” claim is false.

**minor — status distribution 118/103/36/36/26/…** I could not fully recount under the search cap. Non-standard header statuses are real (`Implemented (local slice)`, `Superseded in part`, `Review — implements LLP 0292…`, `Tombstoned 2026-08-01 — absorbed…`). That is enough to keep the “ref-check parses, does not constrain vocabulary” observation. Do not treat the exact histogram as a finding this RFC will act on; it already says it will not.

### Missing objections 0324 does not anticipate

- After the split, agents will keep appending ratification lines to 0000 because that is the habit the corpus taught. 0000.000 needs a one-line “append here, not to 0000” rule, or the root grows again.
- A generated `Related:` of 323 names in the 0000 header recreates the 162-name problem. The body already prefers `llp/index.md`; make that the proposal, not an “or better.”
- 0000 is itself a `foundation/` member. Compacting it changes the kernel document. That is fine and reversible; it is still a foundation edit, not “just editorial in current/.”

### Verdict on 0324

The proposal is the smallest and safest item in the batch. The 0259 contrast is a misidentified object with a wrong byte count. That is one MATERIAL citation fix, not a reason to abandon the rewrite. Not ready until it is fixed.

---

## Cross-document

No cost or dependency contradiction among 0322, 0314.001, and 0324. Shared inventories that I could check agree. Two connections the set should state and does not:

1. `contentHash` includes `diagnostics-registry.json`. A site-keyed shipped registry means Rust line-number motion restamps **guide identity**, not only the CLAUDE.md inventory file. 0322’s “key the published file on codes, not sites” is therefore also a 0314 identity-churn cut. Neither document says so.
2. 0314.001 §2b (ship one of `diagnostics.md` / `diagnostics-registry.json`) and 0322 (public registry carries prose) converge: after 0322, the public file *is* the prose, and shipping both forms is even less defensible. Fine if 0322 is accepted; say the order.

---

## Suggested next step

Revise in place. Do not replace any of these with a different document. The three directions are sound; the MATERIAL items are false descriptions of current contracts (0193, `contentHash`/flats, 0259). After those three corrections, this cluster is a decision-quality sketch set.

```
LLP 0322: NOT READY (3 MATERIAL)
LLP 0314.001: NOT READY (2 MATERIAL)
LLP 0324: NOT READY (1 MATERIAL)
SET: NOT READY
```
