# LLP 0297 review artifact — grok family

One dated section per round. Bodies are persisted verbatim on receipt and
never edited. Provenance per LLP 0005.

## Round 1 — 2026-08-24

- Reviewer: `grok-4.6` @ xhigh, headless (`grok -p … -m grok-4.6
  --reasoning-effort xhigh --output-format plain --disable-web-search
  --permission-mode auto --max-turns 200`), cwd =
  `scratchpad/0297-loop/capsule-r1/`, full terminal ban in the prompt.
- Target revision (r1, sha256):
  `1071a9e61b92eeab6bba045c38f9cd7a3122ee0445cc2a2c3f68fd7a272fc131`
- Capsule hash:
  `d40352a7ca34ffdfb31992ab710e3b3552ec38bd0ab07570b983d8008076c4a1`
- Instruction hash (`CAPSULE.md`):
  `265c97d0cf15307b845577dd9179c3c0363329b4e069a7f59a3470118f34ba31`
- Blindness: structural (capsule contains no review artifacts, journal, or
  orchestrator notes); sealed from the codex review until both landed.
- Received 2026-08-24, exit code 0; persisted verbatim below (the first
  paragraph is the runner's own progress narration, part of the received
  stdout).
- Verdict: **NOT READY** (M1–M3, m1–m5).

### Verbatim body

I'll read `CAPSULE.md` with the file tool and follow its review instructions exactly.I'll load the target research document and every listed context file so the review is based on the capsule sources only.LLP 0114 was truncated before the identity-grammar and offline-receipt sections; I’ll keep reading those parts plus 0179’s budget text.# Review of LLP 0297 — Client canonicalization budgets

Reviewed as Research (Status: Review) against the capsule sources only. I treat the author’s uncertainty about Option C as the assignment: this is a stress test of the recommendation, not a polish pass.

## What the document gets right

Finding 1 is sound. LLP 0114’s finite identity grammar (`0114-first-class-react-and-query-groups.spec.md` §“One finite canonical identity grammar”, lines 1158–1168; §“Exact identity bytes and limits”, lines 1312–1342) and `canonical-client-value.mjs` (lines 9–16, 103–208) really do specify a restricted JSON-shaped, getter-free, cycle-detecting, byte-stable argument/store-key contract. The 4,096-node figure is a conservative design constant, not a measured cliff. Nothing in 0114, 0179, or the canonicalizer derives 4,096 from a device budget or failure formula.

Finding 2 is the load-bearing in-repo incident, and the document reports it faithfully. The open ticket, the checked-in run record, and Diary 0106 all agree: adding M3 queries grew `app.api.queries` to about 6,251 nodes; Expo boot refused with `SNAPBACK_REACT_ARGS_INVALID`; recovery was deleting unused queries and folding pagination `before` into optional args (`20260822-guide-gap-generated-app-canonical-node-ceiling.md` lines 17–26; `2026-08-22-clique-local-main-grok-record.md` lines 69–74; `0106-grok-clique-explicit-local-main.diary.md` lines 56–61, 79–80). LLP 0114 already recognized the category error for whole-manifest digesting on 2026-08-01 and defined a separate generated-artifact profile (depth 64, 65,536 nodes, 1,024 fields, 4,096 array entries, 4 MiB strings, 16 MiB canonical bytes) without raising the public argument limit (`0114` §“Offline binding receipt”, lines 1483–1491). Clique hit a remaining path that still walks a generated `app` export under the argument profile. That is evidence for finishing a split 0114 already started, not for treating catalogs as “large arguments.”

The diagnostic-vocabulary point does not depend on Finding 3. `canonicalizeClientValueV1` always throws `SNAPBACK_REACT_ARGS_INVALID` with the prefix “React query arguments are not a CanonicalClientValueV1” (`canonical-client-value.mjs` lines 34–39, 113). Any non-args call site inherits the wrong product sentence. Finding 2 already proves that.

Options A–D are characterized fairly on implementation cost, public-grammar risk, and compatibility of C with D. The evidence program’s first item (inventory and classify every production call site) is the right gate for an RFC. The document correctly refuses to pick a final numeric result limit.

Those strengths do not make the preliminary recommendation READY.

---

## M1 — Findings 1–5 underdetermine Option C; the result-profile half is an overclaim

**Evidence:** `0297` Summary lines 27–60 and 51–60; Options lines 324–400; Likely hand-off lines 464–478; Findings 1–5 lines 140–262; Open question 1 lines 445–447.

Option C as written is three decisions glued together:

1. Keep the 4,096-node argument/store-key profile.
2. Route complete generated artifacts through the existing 65,536-node artifact profile, counted at generate/verify.
3. Define a new result/snapshot profile (nodes/bytes/rows, typed refusal, high-water inspection) and have LLP 0114 name it.

The in-repo evidence supports (1) and (2). It does not support treating (3) as part of the same next design direction.

| Finding | What it actually supports |
| --- | --- |
| 1 | Do not raise the global argument constant without a cross-device derivation. Keep caller-authored identity finite. Does not choose C over B for catalogs, and does not create a result profile. |
| 2 | Finish the 2026-08-01 category split: a generated `app` / API catalog is not query args. Supports generate-time counting (already the ticket’s acceptance bar) and stopping `SNAPBACK_REACT_ARGS_INVALID` for that path. Does not imply a live-result contract. |
| 3 | If taken at face value, shows a third producer class can hit the same ceiling. It is not in this repository; Method lines 117–122 say so; Open question 1 still does not know *which call site* or *why* `viewerState` was canonicalized. |
| 4 | Users reason in rows, bytes, work, and pagination. That is a vocabulary argument against using maxNodes as the sole *product* sentence for results. It does not show Snapback currently canonicalizes whole snapshots, and it does not pick C over D. |
| 5 | Desktop Node traversal of synthetic shapes is roughly linear and 6,251 nodes is not a V8 cliff. Explicitly not a Hermes/live-update/GC result. Weakly against “4,096 is a performance necessity”; silent on semantic class. |

The Summary’s “Clique exposed … two structurally different values” (lines 27–33) blends a checked-in catalog failure with an out-of-repo result failure. The checked-in Clique lane exposed only the catalog (`record.md` finding 2; diary M3). The result incident is a later published-0.1.25 path the document itself flags as unimported.

Then the preliminary recommendation (lines 370–400) and the hand-off (lines 468–469) still tell a future RFC to *name a separate result profile in LLP 0114* if the evidence program “corroborates” C. That inverts the dependency: Open question 1 is a blocker for (3), not a follow-up after choosing C. Until the inventory exists, “results/snapshots” may be egress validation, immutable cloning, React snapshot identity, or a mistaken args walk. Those four jobs do not share a budget, an owner, or a diagnostic.

This is the overclaim the review standard treats as MATERIAL. A Research document may hypothesize three classes. It may not present Option C, including a result contract shape and an 0114 amendment to name that profile, as the evidence-backed next direction.

---

## M2 — The §Confidence “High” ratings are not earned

**Evidence:** `0297` §Confidence lines 427–431; Method lines 117–122; Open question 1 lines 445–447; Finding 5 lines 249–262 and Confidence line 435; `2026-08-22-clique-local-main-grok-record.md` lines 1–3; `canonical-client-value.mjs` lines 34–39.

Three High labels are under review. Only one survives.

**High: catalog and `viewerState` are different classes that currently converge on 4,096 and `SNAPBACK_REACT_ARGS_INVALID`.**  
The class table (lines 98–104) is a reasonable a-priori split. The *empirical conjunction* is not. Catalog → argument profile is in-repo. `viewerState` is retained only at `/home/ccheever/clique-published-0125-sol-high-20260823` and cannot be checked here. The document still does not know the call site (Q1). Convergence on `SNAPBACK_REACT_ARGS_INVALID` is true of *every* `canonicalizeClientValueV1` refusal by construction, so it is not independent evidence of two product incidents. Rating the conjunction High is a confidence error. High is defensible only for: generated catalogs currently ride the argument profile and the args diagnostic.

**High: LLP 0114 already established a generated-artifact profile.**  
This one is earned (`0114` lines 1483–1491). It supports completing that split, not a third profile.

**High: competitors emphasize bytes/rows/work/pagination.**  
Dated first-party reading is fine for Research. It is not High evidence that Snapback should add a result node budget. Absence of a documented client-tree cap is not proof of the right Snapback contract. Medium, as a literature snapshot, is the honest ceiling.

The Medium on 8,192–16,384 being “affordable on representative clients” (line 435) also overreaches the same section that calls the desktop numbers “insufficient” because Hermes, low-end devices, allocation/GC, live cadence, clone/store/render, and network are unmeasured (lines 249–258). That rating should be Low until the evidence program’s device matrix exists.

The Medium on removing whole-snapshot canonicalization without weakening store semantics (lines 437–438) contradicts Open question 1. If the call site is unknown, confidence that it can be removed is Low, not Medium.

§Confidence currently launders an unverified incident and an unanswered architecture question into High/Medium certainty that Option C (and D-feasibility) are already indicated. That is MATERIAL in a document whose author asked for a genuine stress test of the recommendation.

---

## M3 — Result-budget direction is not reconciled with LLP 0155 or LLP 0200

**Evidence:** `0297` Related lines 13–14; Options C/D lines 324–369; Open questions 2 and 8 lines 448–449, 461–462; Likely hand-off lines 466–473. Capsule summaries of LLP 0155 and LLP 0200.

The document lists LLP 0155 and LLP 0200 as related and then does not use them.

- LLP 0155 (Accepted) already keys retained result fragments by plan hash + canonical *args* + authority partition and **prescribes no result node budget**.
- LLP 0200 (Review) already gives server-produced live frames **version-stamped delivery** with coalescing bounds; its “max frames 4096” is a coalescer cap, unrelated to `maxNodes`.

Those two facts are first-class for Options C and D. If retained fragments are already args-keyed, a new client-side result `maxNodes` is not how identity works in 0155; it is a new admission quota that 0155 does not currently have, and that the query/result owners would have to accept or reject. If live frames are already version-stamped, Option D is not a green-field protocol idea — it is “use the version stamp / digest the server already has instead of RFC-8785-walking the snapshot in React.” Open question 8 asks 0114 vs 0179 vs “query/result-contract owners” and never names 0155 or 0200. The hand-off amends 0114, 0179, query/result contracts, and the Guide; it does not require a coherence pass against the two related LLPs that already decide result identity and live-frame identity.

This is not an implementation-detail request. Recommending a result/snapshot canonicalization profile without stating how it sits next to “no result node budget” and “version-stamped frames” is a defective RFC-feeding decision. It also leaves an obvious agent pitfall unflagged: two unrelated 4,096s (0114 `maxNodes` vs 0200 coalescer frames).

---

## Options on the merits (including one the document did not consider)

### Option A — raise the global constant

It would have unstuck the in-repo Clique catalog (6,251 < 8,192). Desktop cost in Finding 5 is low. That is all that can be said for it.

It changes a *versioned public identity grammar* for every call site, including hostile or accidental huge args, which is exactly the threat model 0114 wrote the bound for. It keeps `SNAPBACK_REACT_ARGS_INVALID` as the sentence for catalogs (and for results, if they really share the function). It does not give generate-time refusal, which is the ticket’s acceptance criterion (`20260822-guide-gap-generated-app-canonical-node-ceiling.md` lines 45–49). Finding 5 is not a mobile warrant. A later catalog or a growing live window still falls off the next cliff.

A is a tactical unstick, not a design. It should not be the RFC.

### Option B — keep 4,096 everywhere, improve diagnostics

Preserves the strongest argument-safety posture and makes no device bet. Better diagnostics are *necessary* in every serious option: the hardcoded args code is already a product bug on the catalog path.

B as the whole answer is still wrong. A three-milestone messenger’s generated `app.api.queries` at ~6,251 nodes is ordinary API growth, not an adversarial argument. 0114 already said so: “an admitted function catalog may legitimately exceed the argument-node budget” (`0114` lines 1488–1491). Keeping 4,096 on that path, even with a nicer error, forces the Clique workaround (delete queries, fold pagination variants) as standing product law. The open ticket’s *guide* half is B-shaped; its generate/verify half is already reaching toward a different class. B alone freezes the category error 0114 tried to close in August.

### Option C — split profiles by semantic class

The first two bullets are the right near-term classification for *args vs generated artifacts*. `canonicalizeClientValueV1` already accepts `options.limits` (`canonical-client-value.mjs` lines 103–107), and 0114 already defined the artifact numbers. Finding 2 is largely “a call site still uses the default profile,” not “the grammar lacks a second profile.”

The third bullet is the unsupported one (M1–M3). Even on its own terms C is underspecified in a way that matters:

- “Use the already-accepted 65,536-node artifact profile” for *complete AppDescriptor, API catalog, and binding-receipt digest* lumps three different trees. 0179’s portable descriptor is RFC-8785-digested under 0179’s own member/byte ceilings (`0179` lines 238–251, 638–650). 0114’s receipt digest is the artifact profile applied to a normalized generated manifest (`0114` lines 1467–1491). Clique failed on the hydrated `app` export at Expo provider construction (`ticket` lines 17–26). Routing all three through 65,536 *walks* is not the same design as “identity is the digest; do not walk the hydrated tree as a value.” 65,536 was a receipt-digest safety ceiling, not a measured product budget for booting `app.api.queries`. 0179 still has an open question on descriptor-byte and binding-depth budgets (`0179` lines 707–711).
- A result profile “with its own nodes/bytes/rows” reintroduces total nodes as a first-class result knob after Finding 4 said users do not think that way, and after Open question 6 asks whether nodes can be dropped. C assumes the answer is “keep nodes, add bytes and rows.”

C is the right *headline* only if it is rewritten as “finish the artifact/argument split; do not specify a result profile yet.”

### Option D — stop canonicalizing whole result snapshots

This is the option that actually follows from 0114’s store-key definition (provider + complete generated reference + *canonical args*, `0114` lines 1314–1325 and `canonical-client-value.mjs` lines 211–245), from 0155’s args-keyed fragments, and from 0200’s version-stamped frames. If whole results are being RFC-8785-walked to decide whether a visible snapshot changed, that work is on the wrong axis: identity is already supposed to be args/reference/authority (and, for live frames, a server version). D also scales with pagination and retained windows, which is what the 0.1.25 lane did as a product fix (twelve newest pushes plus active presence; `0297` lines 194–196) — that remedy is a projection change, not a higher maxNodes.

D is not free: stale/equal-revision publication, cross-carrier determinism, and some finite *admission* bound (bytes/rows, owned by query/result contracts) still have to exist. It is also not choosable until Q1 is answered. It is the correct *research priority for results*, not a near-term patch for Finding 2.

### Option E (not in the document) — narrow split, generate-time admission, defer results

Keep 4,096 for caller args and store keys. Treat generated `app` / descriptor / manifest as the existing artifact class: remaining argument-profile call sites move off that profile, **or** provider construction stops walking the hydrated tree and uses 0179’s `identity.descriptor` / the 0114 receipt digest. Codegen counts the client export and refuses before boot with a non-args diagnostic and the cheap recipes the ticket already names. Import or reproduce Finding 3 before designing a result budget. Investigate D for snapshots against 0155 and 0200. Do not amend 0114 to “name a result profile” in the same RFC that fixes the catalog path.

This is what Findings 1–2, the 2026-08-01 amendment, the open ticket’s acceptance criteria, and the unanswered Q1 jointly support. It is C’s first two bullets + B’s diagnostic repair + G below, without C’s third bullet.

### Option F/G (also not framed) — generation-owned catalog budget; maybe do not canonicalize `app` at all

The Clique object is a generated export. 0179 already owns descriptor identity and member ceilings; generation already refuses oversized surfaces. A generation-time node/byte count of the client export, owned by 0179/codegen, matches the ticket: “refused at generate/verify with a fix that does not require reading `canonical-client-value.mjs`.” That can be done *without* giving Expo a 65,536-node runtime walk of `app.api.queries`. The document’s C2 (“use the artifact profile”) still assumes the right move is a larger *canonicalizer* profile on that path. The 2026-08-01 fix’s spirit was the opposite: stop classifying this tree as the thing `CanonicalClientValueV1` is for.

---

## Reviewer’s option ranking

1. **E + F/G (near term).** Keep the argument profile. Finish the generated-artifact category split. Prefer digest/identity and generate-time counting over a bigger runtime walk. Repair the diagnostic. Close or split the guide-gap ticket on that basis.
2. **D for results, after inventory.** Default prior given 0114 keys, 0155, and 0200: do not RFC-8785 whole snapshots to decide identity. Finite admission, if any, should be bytes/rows (and authored `take`/windows) at the query/result owners.
3. **C as currently bundled.** Only if the call-site inventory shows results *must* be whole-value canonicalized and 0155/0200 cannot carry identity. Not supported today.
4. **B alone.** Diagnostics yes; 4,096 as the catalog product ceiling no.
5. **A.** Last. Smallest patch, worst design: public grammar change that preserves the conflation.

C’s first two bullets and D are compatible, as the document says (lines 367–369). The error is promoting full C — including a result profile — to “the next design direction” before the inventory, before a checked-in Finding 3, and before the 0155/0200 coherence pass.

---

## Factual check against capsule sources

No MATERIAL misstatement of the in-repo numbers or of 0114/0179 ownership. Finding 2’s 6,251 / `SNAPBACK_REACT_ARGS_INVALID` / recovery path matches ticket, record, and diary. Artifact-profile numbers match `0114` lines 1485–1487. Public argument limits match `0114` lines 1166–1168 and `canonical-client-value.mjs` lines 9–16. Node definition (root plus each scalar/array/object; field names are not nodes) matches `0114` lines 1337–1339.

Caveats, not counted as independent MATERIAL:

- Finding 3 cannot be verified here. The document discloses that. It may not draw High or RFC-shaping conclusions from it (M1, M2).
- The 263-function fixture and “failed at node 4,097” (lines 164–165) are not in the capsule; the ticket only names the 2026-08-01 whole-manifest fix. Plausible, uncheckable.
- `sha256GeneratedManifest` is not in the provided `canonical-client-value.mjs`. 0114 specifies the receipt-digest profile; the function name is unverified.
- Quoted diagnostic `SNAPBACK_REACT_ARGS_INVALID: value exceeds node limit` (line 191) is a truncation of `SNAPBACK_REACT_ARGS_INVALID: React query arguments are not a CanonicalClientValueV1: value exceeds the node limit`.
- Method cites the checked-in 2026-08-22 run without restating that record’s own line: “CALIBRATION — unpublished current-source evidence, not claim-eligible.” Acceptable for a bug-incident Research cite; not acceptable if this were a capability claim.

---

## Decision quality, open questions, evidence program

As a basis for the RFC sketched in §Likely hand-off, this Research is **not** adequate until M1–M3 are resolved. The evidence program is well-aimed for *numbers and DX* (inventory, focused reproductions, Node/Hermes/web matrix, clone vs commit vs canonicalization, recovery recipes) and correctly sits “before an RFC amends LLP 0114.” The defect is that §Preliminary recommendation and §Likely hand-off do not wait for it: they already name Option C, a result contract shape, and an 0114 result-profile amendment.

Open questions 1, 2, 3, 6, and 8 are the right ones; **Q1 is currently a blocker**, not an RFC-phase detail. Missing questions the RFC will need:

- After inventory, is the hydrated `app` export still being canonicalized as a *value*, and should that walk exist at all given 0179’s descriptor digest and 0114’s receipt digest?
- How does a result admission budget interact with LLP 0155’s args-keyed fragments and “no result node budget”?
- How does snapshot identity interact with LLP 0200 version-stamped frames, and how do we keep those two 4,096s distinct?
- Is generate-time refusal of an oversized client export (ticket acceptance) sufficient for Finding 2 without a runtime artifact-profile walk?

The evidence program should add: classify the three generated trees separately; include 0155/0200 in the owner map; require a checked-in or otherwise capsule-visible Finding 3 (or drop it from High/hand-off) before result-profile design.

---

## Minor

- **m1.** Finding 2’s 263-function / node-4,097 fixture is not in the capsule sources. Keep or cite the closed ticket in-tree.
- **m2.** Diagnostic quote omits the args-prefix and “the” (`canonical-client-value.mjs` lines 34–39, 113 vs `0297` line 191).
- **m3.** Method does not repeat the checked-in run’s calibration / not-claim-eligible status (`record.md` lines 1–3).
- **m4.** Implementation already has per-call `options.limits`; C’s artifact bullet is call-site routing, which should be explicit so the RFC does not invent a second canonicalizer.
- **m5.** Finding 5’s inverted 4,096 p95 vs later warmed shapes is noted; do not let that row inform any number.

---

The document is strong as a map of a real category error (generated catalogs vs args) and as a warning not to globally bump 4,096. It is not yet a legitimate recommendation of Option C, because that option’s result half is underdetermined, High-rated on unverifiable evidence, and unreconciled with related result-identity LLPs. Narrow the recommendation to the artifact/argument split plus inventory-gated result work (Option E/F), drop or downgrade Finding 3’s role until it is importable, and rewrite §Confidence to match. Then this Research can feed an RFC.

VERDICT: NOT READY
