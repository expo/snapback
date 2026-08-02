# LLP 0145 client bundle architecture review — Fable family


## Round 1 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, read-only review of the working
tree; mutually blind — no `llp/reviews/` artifact read, no `super-refine` path
read, blind to this document's codex artifact. SHA-pinned target and
instruction capsule.
**Instruction capsule SHA-256:** `f8183404ac97a0e72f629258bd05946bd9b2539f679fe9727b56c130f5b165b0`
**Target:** `llp/0145-client-bundle-architecture.research.md` (842 lines, Draft,
uncommitted working tree)
**Target SHA-256:** `46ca3bb01d12ac7b31929549fd99bb23316097185c162fe2d98c503931bce912`
**Repo revision at review start:** `0c0040ff` on `main`
**Tool uses:** 76
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

# LLP 0145 review — round 1 (independent reviewer, Claude/Fable family)

Target: `llp/0145-client-bundle-architecture.research.md`, working tree, SHA-256 `46ca3bb01d12ac7b31929549fd99bb23316097185c162fe2d98c503931bce912` (verified; 842 lines). All paths below are relative to `/Users/ccheever/projects/snapback` unless written absolute. Blindness rules honored: nothing under `llp/reviews/` and no `super-refine` path was read.

## Overall assessment

This is a strong research document sitting on unusually honest measurements. I did not take the numbers on faith: I rebuilt the fixtures myself and reproduced the headline Snapback closure (my 251,013 B min / 70,175 B gzip / 60,166 B brotli vs the doc's 250.9/70.1/60.2), the entire F2 attribution table row-for-row from a fresh esbuild metafile, all three F3 counterfactuals to within 0.1 kB, both F4 search-parser numbers to within ~15 bytes, all four Signal Desk generated-artifact figures exactly (54.8/20.3/5.7/5.2), the Signal Desk Snapback adapter exactly (384.3/98.5/81.1), the two incident-room app bundles byte-exactly from their committed `dist/` artifacts, and the Zero and Replicache competitor rows to within 0.1 kB from the zero-bakeoff's installed packages. The F4/F6/Gate-2 premise that server handler source crosses into the browser today is not rhetoric: `demos/signal-desk/snapback/generated/functions.manifest.json` literally embeds `__snapbackHandlers = { "addComment": (async (ctx, args) => {...` handler bodies, and that manifest contributes 54.8 kB minified to the measured browser bundle. The diagnosis is right, the options are fairly argued, the hypothesis/finding line is consistently drawn, and the "measure by executing, not weighing" lesson from LLP 0063 is correctly carried into Phase A.

Two things keep it from READY. First, evidential closure: the comparative benchmark's fixtures exist nowhere in the repository, the application-corroboration table records no package versions, and one of its five rows — the Signal Desk Supabase adapter at 218.8 kB / 57.5 kB gzip — cannot be produced from the committed fixture, which pins `@supabase/supabase-js` 2.57.4 exactly and bundles to 127.5 kB / 34.9 kB gzip. The number was evidently taken at ≈2.111.0 (it sits 4.2 kB above the SDK table's full-client figure) without recording that the fixture's dependency state was changed. In a document whose entire authority is "anyone can re-measure this," that is a real defect even though it biases against the doc's own thesis rather than for it.

Second, the document misses the corpus's best existing evidence and one governing constraint, in ways the standing bar ("thought through as much as we can without writing code") squarely covers. The Confidence table's basis for the protocol-rewrite row — "current protocol has not yet been tested with a thin implementation" — is contradicted by the tree: `clients/swift` holds the LLP 0093 D4 clean-room proving client (~3,650 core Swift lines, fixture-passing, guide-exposed, "landed" per LLP 0093), which is precisely a thin implementation of the unchanged protocol and the strongest prior for OQ2 and Option 3's sizing. And LLP 0077 already answers OQ8 as written — sender constraint is **required** on hosted targets with **no bearer-only fallback** — which means the Online profile as drafted, and the entire Phase C/D program, which never touches a hosted target, can graduate a client that cannot authenticate against the hosted product. Alongside these: the gates never invoke the existing LLP 0095 conformance fixture corpus, the reconnect-cost risk is measured but not gated, Option 1's `@snapback/react` naming ignores the ratified `@expo/snapback-*` terminal scope (LLP 0130 SD-6) and the already-published `@expo/snapback-react`, and the "low-risk" React extraction is actually an LLP 0114 public-seam amendment (`client.prepareReactBinding` is a spec'd class method).

Is this a good idea and a good plan? Yes — the two-profile direction is the right shape, the "conservative, not unsound" F7 framing is exactly the correct posture, the sequencing (ratchet → low-risk splits → one generated microclient spike) is the right order, and rejecting mangling and WASM on recorded evidence is correct. Nothing here is wrongheaded. The revision needed is a corpus-integration and gate-hardening pass, not a rethink.

**NOT READY**

## Strengths

- **Reproducibility of the core measurements is exceptional.** Verified true by independent re-measurement (esbuild 0.28.1, the exact version in `node_modules/.bin/esbuild`; gzip -9; brotli -q 11):
  - Headless `SnapbackClient` closure (§Method table, F2, F3 baseline): doc 250.9 kB / 70.1 / 60.2; my repro 251,013 / 70,175 / 60,166 from the published `@expo/snapback-client@0.1.8` installed at `demos/pocketbase-snapback-bakeoff/snapback-incident-room/node_modules/@expo/snapback-client` (resolved from registry.npmjs.org per `package-lock.json`).
  - The full F2 attribution table matches a fresh metafile: index.mjs 156.9, react-binding 18.8, query-authorization 17.9, auth-invalidation 11.7, result-contract-validator 8.6, rqs-store-file 7.8, RQS core+stores 16.4–16.5, sender-proof 4.0, canonical+outbox 6.8.
  - F3 counterfactuals: baseline 70.16, no-React 61.46 (−8.7), no-file-store 67.99 (−2.2), both 59.24 (−10.9) — all match.
  - F4: root search import 6,804/3,127 vs subpath 3,166/1,467 (doc: 6.79/3.10 and 3.15/1.45).
  - Application table: PocketBase incident-room `dist/assets/index-Do1aha8Y.js` = 231,589 B, gzip 70,270, brotli 60,960; Snapback incident-room `index-SNTwOyDL.js` = 456,211 B, gzip 131,204, brotli 111,817 — byte-exact against §Application-level corroboration. Signal Desk Snapback adapter reproduces exactly (384,255 / 98,458 / 81,087); Convex adapter reproduces at 79,077/21,524/19,100 with the tree's convex 1.42.3 (doc used 1.43.0 — consistent).
  - Competitor rows spot-checked: Zero 1.8.0 → 304,177/95,258/82,842 and Replicache 15.3.0 → 115,143/35,665/31,709 (both installed under `demos/zero-bakeoff/node_modules`), PocketBase (tree's 0.27.0) → 37,830/10,624/9,506 — all match the table to displayed precision.
- **As-built accuracy of F2/F4/F5 confirmed.** `packages/snapback-client/index.mjs` is 10,832 lines ("approximately 10,800" ✓); the root imports the React binding (index.mjs:43–45,67), sender proof (:36–42), RQS stores including the Node file store (:95), memory store (:96), preload, outbox-shared — the whole claimed dependency list. `/online` re-exports `SnapbackClient` from the root (`packages/snapback-client/online.mjs:8–12`) and I measured its closure byte-identical (251,013/70,163). `package.json` declares no `sideEffects` (checked, absent). `browser-closure.test.mjs:16–39` does exactly and only what F5 says: one root-entry esbuild build, non-empty assertion, Node-builtin regex — no size budget, no per-export fixtures, no metafile. (`bundle.test.mjs` is `fetchBundle` behavior, not size, so F5's characterization of the size gate stands.) `@expo/snapback-react/index.mjs:23–25` imports through the client root, confirming F4's "React code often imports through the root."
- **The handler-source claim is real, not a strawman.** `demos/signal-desk/snapback/generated/functions.manifest.json` embeds complete `async (ctx, args) => {...}` handler bodies under `__snapbackHandlers`, and that file contributes 54.8 kB minified to the measured browser closure. Gate 2's "contains no server handler source" gates an actual present condition. Verified.
- **Corpus fidelity where I checked it.** The LLP 0063 citation is exact: header line 9 and §"2026-07-26 gateway bundle optimizer rejection" (llp/0063:1841–1862) record property mangling passing the byte thresholds (208.3/65.5 vs 213.5/67.2 limits) while failing live boot identity and routed RSVP — "two of three production behavior checks" ✓ — and Terser multi-pass barely moving bytes, matching Option 7's "little leverage." "Online"/"Parity" are the guide's real claim classes (`guide/capabilities.md` rows 59–60, 85). The Supabase modularity analysis (F1) is architecturally correct (postgrest-js as a generic request builder; auth/realtime/storage as separate libraries re-imported by full `supabase-js`), and the slice table sums coherently to the full-client figure.
- **Hypothesis discipline.** Every Options "Expected size," the matrix header, the Summary's "plausible research target, not a finding," and §"What this research did not measure" keep proposed bytes cleanly separated from measured bytes. Matrix verdicts match every per-option Assessment (checked all ten). The 59.5-of-60.9 (~98%) arithmetic and the Confidence table's "within about 1.4 kB" agree with the tables.
- **The F5 lesson is applied to the program.** Phase A's "Every byte receipt must run behavioral acceptance" and gates 5–10 make the proposed ratchet execute the program, not just weigh it.

## Findings

**1. MATERIAL — The benchmark has no repository artifact, and one application-table row does not reproduce from the committed fixture.** (§Method and limits, §Application-level corroboration.) No bench fixtures, scripts, or lockfiles for the ~12-client SDK table exist anywhere in the tree (searched `scripts/`, `demos/`, receipts). The application table records no package versions, and its Supabase row is demonstrably not the committed fixture's number: `demos/signal-desk/package.json:35` and `bun.lock` pin `@supabase/supabase-js` **2.57.4 exactly**, and bundling `src/backends/supabase.ts` (React external, doc's own settings) yields **127,461 B min / 34,892 B gzip**, not the claimed 218.8 kB / 57.5 kB. The claimed number is consistent with supabase-js ≈2.111.0 (SDK table full client 214.6 + ~4 kB adapter), i.e., the measurement was taken with the fixture's dependency state changed and unrecorded. The doc presents these as "Two independent application measurements … from a real bundler" without disclosing that. Why it matters: the document's authority is reproducibility; a reader re-running the committed fixture gets a 23 kB-gzip-smaller Supabase figure, and the remaining competitor versions (PocketBase 0.27.1, Convex 1.43.0, Supabase 2.111.0, SpacetimeDB 2.7.1, Appwrite 26.2.0, Firebase 12.17.0, InstantDB 1.0.57, Electric 1.5.24) are unverifiable offline — I could confirm only Zero 1.8.0 and Replicache 15.3.0 in-tree, PocketBase at 0.27.0 (which matches the "0.27.1" row at displayed precision — the doc may in fact have measured 0.27.0), and Convex at 1.42.3 (≈). Resolve by: committing the fixture sources plus a rerunnable script (Phase A's own deliverable) or an appendix listing each fixture's import/exercise code verbatim; adding per-row versions to the application table; and re-measuring or annotating the Supabase adapter row against the version the fixture pins.

**2. MATERIAL — The Confidence table asserts an as-built fact the tree contradicts, and the document misses its own best feasibility evidence.** (§Confidence, §Research question, Option 3, OQ2.) The basis "current protocol has not yet been tested with a thin implementation" is false: `clients/swift/SnapbackClient/Sources/SnapbackClient/` is the LLP 0093 D4 first-party clean-room proving client (~3,650 core lines: SnapbackClient.swift 1,138, StateMachine.swift 1,450, WireTypes.swift 803, JSONValue 117, TransportTiming 141), built from the spec, fixture-passing, and recorded "landed" with guide pages (llp/0093:48, 513, 591–593, 637–640). It is a thin, non-JS implementation of the unchanged wire protocol — the closest existing answer to OQ2 ("can the current wire protocol support a 10–25 kB implementation cleanly") and a concrete prior for the Minimal runtime contract's real size (what a clean-room implementation actually needed: the 0095 state machine, wire types, transport timing). The document mentions Swift once, generically (line 489). Why it matters: a Research doc's job is to assemble the evidence that exists before proposing spikes; this evidence materially de-risks Option 3 and should reshape OQ2 from "unknown" to "partially answered, browser-byte question remains." Resolve by citing the Swift client (and Diary 0020) in F6/Option 3/OQ2 and correcting the Confidence basis.

**3. MATERIAL — The Online profile plus the Phase C/D program can graduate a client that cannot authenticate to the hosted product, and OQ8 poses as open a question LLP 0077 already answers.** (§Online profile, Option 3, §Phase C, §Phase D, OQ8.) LLP 0077 §Issuance: the `senderConstraint` member "is **required** on a hosted target and **absent** on a local bearer-v1 exchange; a hosted request without it … is refused at the route boundary" (llp/0077:866–872), and "there is no bearer-only fallback" (:918) — implemented and matrix-verified 43/43 against a served origin per the Revised header. The Online profile excludes sender proof ("no … sender-proof … claim"), the spike uses an external bearer seam, Phase C targets the (local) incident-room arm, and none of the ten gates touches a hosted target. So all ten gates can pass while the resulting client is dev-only by construction. The doc's only acknowledgments are Option 3's "not a complete first-party auth experience" con and OQ8's "which parts … are mandatory" — but per 0077 as written the answer is "the whole issuance/proof lane." Why it matters: this is exactly the capsule's pass-while-unshippable failure; also sender-proof is only ~4.0 kB minified in the current closure (verified), so the honest fix is cheap and should be stated rather than deferred. Resolve by: stating plainly that per LLP 0077 an Online client without the sender lane cannot serve hosted deployments, and either scoping Online v1 explicitly as local/external-auth-only or putting the sender module inside the first productized profile; adding a hosted-target leg (or an explicit scope disclaimer) to Phase D.

**4. MATERIAL — The graduation gates are weaker than the corpus already allows.** (§Recommended evidence program.) Three holes: (a) no gate runs the existing LLP 0095 conformance fixture corpus (llp/0095 §2, including seeded negative fixtures for negotiation/wire-version refusal) or a ratified Online-profile subset of it — the spike's acceptance is bespoke, re-deriving behavior tests the corpus already owns, and drift between "spike acceptance" and the conformance contract is precisely how two clients diverge semantically (the doc's own §Two clients can drift risk); (b) §Risks says "The spike must measure reconnect network bytes and time beside bundle bytes," but Phase D's "worth productizing only if" list contains no operational criterion, so a spike with pathological resnapshot amplification still graduates; (c) gate 1's byte envelope ("20 kB runtime / 25 kB with generated entry") never states whether the React hook layer the reimplemented incident-room app necessarily uses is inside or outside the envelope (gate 2 forbids "React binding" in the runtime, so the hooks live outside — unmeasured), and no gate ties back to the whole-app metric that motivated the research (131.2 vs 70.3 kB gzip). A spike could clear every gate while the actual incident-room page payload barely moves. Resolve by adding: a conformance-corpus gate (or a named Online conformance class to be minted under 0095), a bounded reconnect-cost gate or an explicit author decision that it is measure-only, and a whole-app byte line for the reimplemented arm.

**5. MATERIAL — Option 1's React extraction is misdescribed in both name and risk class.** (Option 1, §Phase B.) "Move React binding to `@snapback/react`": the ratified terminal scope is `@expo/snapback-*` (LLP 0130 SD-6, llp/0130:79–80), and `@expo/snapback-react` already exists as a published package (`packages/snapback-react/package.json`; installed at 0.1.8 in the incident-room fixture) — the doc never mentions it, and §Online profile's "React hooks … from a separate package" reads as proposing a package that is already shipped. More substantively, the extraction is not mere packaging: `prepareReactBinding` is a spec'd public method **on `SnapbackClient`** (llp/0114:1130–1145 "the public seam is one asynchronous admission step: `await client.prepareReactBinding(...)`"; implemented at `packages/snapback-client/index.mjs:4280–4281`), and `@expo/snapback-react` imports the admission functions from the client root (index.mjs:23–25 of that package). Removing react-binding from the root closure therefore requires amending LLP 0114's public seam (e.g., to a free function owned by the react package) plus a coordinated two-package change — while F3/Option 1/Phase B classify it as the exemplar "clearly misplaced," "low semantic risk" move. The direction is still right; the risk label and the naming are not. Resolve by naming the real packages, citing 0114's seam, and noting the required amendment in Option 1's cons/Phase B.

**6. MATERIAL — The Minimal runtime contract is presented as sufficient but omits wire-mandatory invalidation semantics.** (§Minimal runtime contract, F7, OQ3.) LLP 0053 applies its client fence machinery to "**every** auth-scoped live materialization — Live-only queries keep it in memory" (llp/0053:1512–1607), invalidation is "an obligation, not a message" with per-scope dispositions and ACK tokens ("A `Subscription` token is ACKed only after that owning live boundary applies the transition"), and the doc pins the wire protocol as unchanged. A client built to the eight-item list — which contains only "authority-change notification" (#2) and "abort-and-blank" (#7) — has no seam for receiving, applying, and acknowledging obligation frames, so the first spike would be designed without the very frames the fixed protocol will deliver on revocation. Over-reacting (blank everything on any obligation) is a legitimate conservative implementation, but the obligation/ACK seam must be *in the contract* for that to be a design rather than an accident; OQ3 gestures at sharing but the list's framing is "a credible first microclient still needs [these eight]." Resolve by adding an item for obligation receipt/acknowledgment (and stating that the Online client requests no leases, which is what makes LLP 0053's lease machinery genuinely omissible).

**7. MATERIAL — The interaction with LLP 0129 Phase 0's Accepted default is never named.** (§Migration and compatibility, §The smallest client may not be the best default everywhere.) LLP 0129 (Accepted) Phase 0 is "Option A cache hardening on the first arm … client cache **by default** via the shipped `rqsStore` seam" on the JS/React browser arm (llp/0129:405–409; guide/capabilities.md row 60 records the shipped default-persisted-cache behavior) — which is exactly why `rqs-store-default/file/memory` sit in today's root closure. 0143's migration path contemplates Online becoming "the default generated profile" after evidence, and its Status disclaims authorizing that — good — but the document never states that today's default browser persistence behavior is owned by an Accepted plan whose Phase 0 just landed it, so a reader cannot tell that flipping the generated default is a 0129 amendment, not a rollout knob. Resolve with one paragraph naming 0129 Phase 0 as the standing owner and routing any default change through it (and through whatever authority the two-profile RFC gets).

**8. DETAIL — Option 5's byte range is internally inconsistent.** Body: "could plausibly be 5–15 kB gzip" (line 507); matrix: "5–20 kB data-only" (line 635). Pick one.

**9. DETAIL — Diary 0050's figures for the same artifacts differ without reconciliation.** Diary 0050 (Related) records "231.6 kB JS (71.2 kB gzip)" and "456.2 kB JS (132.8 kB gzip)" (diaries/0050:33, 100); 0143 says 70.3 and 131.2. Both are correct at different gzip levels (I verified level 9 gives 0143's numbers), but the corpus now holds two gzip figures for one artifact with no note. A parenthetical in §Application-level corroboration would close it.

**10. DETAIL — Related-list and program-citation gaps.** LLP 0130 (standing decisions — the naming SD the doc's Option 1 trips over) and LLP 0139 (upload bakeoff — the assets capability Phase C excludes, and the incident-room contract includes upload) are absent from Related. LLP 0137 item 7 already mandates "Measured footprint budgets … before choosing an optimization" and states "**LLP 0122 owns the packaging analysis**" (llp/0137:547–553); F5/Phase A propose the same ratchet without citing that mandate or stating 0143's ownership relationship to 0122. Alignment exists; the citations don't.

**11. DETAIL — Phase C's spike is a strict subset of the incident-room arm and the text could say so more plainly.** The arm's product contract includes file upload/delivery and first-party sessions auth (Diary 0050 §Contract; the a1 sessions issue in `issues/`), both excluded from the spike (assets legitimately so — verified they are already a separate subpath absent from the root closure; sessions via finding 3). The exclusion list is explicit, but the byte result will invite comparison against the 70.3/131.2 full-app numbers, which the spike's scope does not match. One sentence bounding the comparability would prevent misuse.

## Suggestions

- Land Phase A's fixture harness *with this document* (even a 100-line `scripts/bench-bundle.mjs` plus fixture strings). It converts the whole Method section from "trust me" to "run me," and my reproduction shows the numbers will survive it.
- Use the Swift client as a sizing prior in Option 3: ~3.6k clean-room lines for core+lane behavior is the best available estimate of what the Minimal runtime contract costs before TypeScript/bundling, and its StateMachine/WireTypes split is nearly the module boundary Option 2 proposes.
- Consider adding (or explicitly rejecting) an eleventh option: a shared, immutable, versioned runtime chunk served CDN-cached across applications with a per-app generated entry — the natural composition of Options 4 and 9; "CDN caching across applications" currently appears only in the not-measured list.
- Name the Online profile's conformance story in LLP 0095 terms (a profile class with an arm × lane subset), so the "two clients can drift" counterweight has a mechanism on day one.
- In the application table, add a version column and a one-line provenance note per row (which lockfile, which install date). The SDK table already does this well.
- State in F4 that the generic-runtime tax coexists with working tree-shaking for leaf symbols (my root search import pulled 6.8 kB, not 251 kB) — it sharpens rather than weakens the finding, and preempts a "but esbuild shakes fine" objection.
- Phase B could name `@expo/snapback-vite` as the enforcement point for narrow imports/budgets in app builds; the package exists and is already in the fixture dependency set.

## Open questions

1. Which document will own the two-profile decision when the spike graduates — a new RFC as §Status implies, an LLP 0122 extension (0137 says 0122 owns packaging analysis), or both — and does 0143 then go Active or feed a successor?
2. Is Online v1 permitted to ship as a local/external-auth-only profile given LLP 0077's hosted mandate, or must the sender lane be in the first productized Online closure? (0077's answer today: no bearer fallback on hosted.)
3. What conformance class does LLP 0095 mint for the Online profile, and which of its seeded negative fixtures apply verbatim?
4. Does the obligation/ACK seam (LLP 0053) ship in the Online runtime as blank-everything-and-ACK, or does the server tolerate a non-ACKing client by escalating to connection termination — and is that tolerance a contract anyone has written down?
5. Will the benchmark fixtures land in-tree, and who re-runs them at the next client release (the ratchet's owner)?
6. Is the Signal Desk Supabase adapter number to be re-pinned at 2.57.4 (reproducible today) or re-measured at the current supabase-js with the fixture bumped — and which version does the doc then claim?
7. For gate 1, is the React hook layer of the reimplemented incident-room app inside the byte envelope, and what is the whole-app target that would declare victory against the motivating 131.2-vs-70.3 gap?

## Verdict

NOT READY


## Round 2 — 2026-08-01 (delta-scoped)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, delta-scoped. Permitted to read
exactly one prior artifact — its own family's round-1 section above — and no
other file under `llp/reviews/`; no `super-refine` path; blind to this
document's codex artifact, which was reviewing the same revision concurrently.
SHA-pinned target and instruction capsule.
**Instruction capsule SHA-256:** `da56b121fe8905af7574071f4087506d0b3cb9e63e9ed925b821e578b4ae0b4a`
**Target:** `llp/0145-client-bundle-architecture.research.md` (v0.2, 1,282
lines, Draft, uncommitted working tree)
**Target SHA-256:** `41b9391b608f7d2d0173cd8d7ac283302ef4daac9b613cff19053422a5cab94c`
**Repo revision at review start:** `0c0040ff` on `main`
**Tool uses:** 65
**Status:** completed
**Verdict:** READY

## Verbatim review

# LLP 0145 review — round 2 (delta-scoped, independent reviewer, Claude/Fable family)

Target: `llp/0145-client-bundle-architecture.research.md`, working tree, SHA-256 `41b9391b608f7d2d0173cd8d7ac283302ef4daac9b613cff19053422a5cab94c` (verified against the capsule; 1,282 lines). Repo at `0c0040ff` on `main`. Blindness rules honored: the only file read under `llp/reviews/` was `0145-client-bundle-architecture.fable.md`; no `super-refine` path and no codex artifact was read. All paths relative to `/Users/ccheever/projects/snapback` unless absolute. Every disposition below was re-verified against the tree, not taken from the author's Revised header.

## Overall assessment

The v0.2 revision is what a round-1 response should be: every one of the seven MATERIAL findings was fixed at the point of the defect *and* propagated into the surrounding structure (Summary, evaluation criteria, matrix, gates, Confidence, Status), and — decisively for a document whose authority is checkability — every new factual claim I tested against the tree held. I re-verified rather than trusted:

- **The corrected Supabase row is real.** `demos/signal-desk/package.json:35` and `bun.lock:16,262` pin `@supabase/supabase-js` 2.57.4 exactly; bundling `src/backends/supabase.ts` against a fresh 2.57.4 install (esbuild 0.28.1, React external, browser/ES2022, gzip -9, brotli -q 11) gives 127,339 / 34,854 / 30,420 B against the doc's 127.5 / 34.9 / 30.4 kB (the ≤0.2 kB drift is npm-vs-bun transitive resolution; round 1 measured 127,461 / 34,892). The correction paragraph's arithmetic (22.6 kB gzip smaller; gap widens) checks out, and the "cuts against the thesis" framing is honest.
- **The Snapback rows reproduce a third time.** Baseline headless closure 250,952 / 70,120 / 60,201 B; counterfactuals 220,258 / 61,426 (−8,694 gzip), 243,154 / 67,956 (−2,164), 212,460 / 59,220 (−10,900) — matching F3 to displayed precision, from the registry-installed `@expo/snapback-client@0.1.8` and the fixture's own esbuild 0.28.1.
- **F8 is exact.** `clients/swift/SnapbackClient/Sources/SnapbackClient/`: SnapbackClient.swift 1,138, StateMachine.swift 1,450, WireTypes.swift 803, TransportTiming.swift 141, JSONValue.swift 117 — sum 3,649, "roughly 3,650" ✓ (FixtureHarness.swift 922 legitimately excluded as non-core). LLP 0093 records D4 as clean-room, built from the document, fixture-passing, "Status (2026-07-26): landed" with guide pages (llp/0093:513, 591–593, 637–640, 688).
- **Every ratified-constraint citation is accurate.** LLP 0077:869–872 ("**required** on a hosted target and **absent** on a local bearer-v1 exchange… refused at the route boundary") and :918 ("no bearer-only fallback"); LLP 0096:685–690 (§7 decision, Charlie, 2026-07-25, floor verbatim as quoted); LLP 0060:480–482 ("no public bearer-v1 compatibility posture, hidden flag, or operator waiver"); LLP 0053:122, 281–282, 869 (persistent level-triggered obligation, discharged only on acknowledge); LLP 0095:255–300 (scope/revision/witness matching, quarantine, re-ACK, terminal-delete fencing at :87, foreign-obligation refusal incl. the `auth.live.foreign_obligation_never_acknowledged` fixture class); LLP 0059:1679–1685 (the fence enumeration and "success, failure, timeout, abort, and terminal auth error are equally fenced" — item 9 and gate 12 paraphrase it correctly); LLP 0114:1132–1138 (the `prepareReactBinding` seam quote) and :256 ("runtime egress is validated before a typed result is published"); LLP 0012:582–584 and LLP 0043:55–56 (Parity definition and rule, verbatim); LLP 0130 SD-6; LLP 0129 Phase 0 ("persist the client cache by default via the shipped `rqsStore` seam", JS/React browser arm, graduation path; Status Accepted); LLP 0063:1749–1787 (Workstream 8 heading, the "tree-shake by operation and capability" sentence — it wraps across lines 1753–1754, which is why a naive grep misses it — and the freezing discipline verbatim); LLP 0137:547–553 (item 7 + "LLP 0122 owns the packaging analysis"); LLP 0122 Option 6 (all four admin shapes exactly as Phase B lists them); LLP 0094:21, 973 ("no expected-operation wire" — Option 4's disclaimer is right).
- **Gate 11's instrument exists as described.** `schemas/live.wire-fixtures.v1.json` has `"formatVersion": 3`, 49 fixtures, each carrying `lane` and `tuples` routing fields plus seeded negatives — the "every routed fixture… for that tuple" mechanism is real, not aspirational.
- **The corrected package/naming facts hold.** `packages/snapback-react/package.json` is `@expo/snapback-react`; `packages/snapback-client/react-binding.mjs` imports zero React and is admission/validation/prepared-group machinery carrying an LLP 0114 @ref; `@expo/snapback-react/index.mjs:11–24` imports the admission functions from the client root; the workspace client is file-identical to the published 0.1.8 for index.mjs, react-binding.mjs, rqs-store-file.mjs, and sender-proof.mjs, so the Signal Desk adapter row's "0.1.8" label is sound. Registry spot-check: pocketbase 0.27.1, convex 1.43.0, supabase-js 2.111.0 are the current versions today, corroborating the SDK table's method statement.
- **Diary 0050** says 71.2 and 132.8 kB gzip (lines 34, 100-area) and records the dev-`userId` provider refusal and raw-client fallback (lines 136–138) exactly as Phase C now states.

What remains is small: four DETAIL residues (one-word naming leftovers the doc's own correction disavows, a 0.1 kB figure that disagrees with the doc's own table, the Convex adapter row carrying the same measured-at-bumped-version provenance the revision corrected for Supabase, and one loose citation in the auth-posture table), plus one provenance sentence I structurally cannot verify under blindness ("by two reviewers working separately" — the Fable half is accurate, and I have now reproduced the substance a third time; the codex half is the orchestrator's to confirm). None of these misleads a decision-maker; none touches the thesis, the option ranking, the gates, or the recommended sequence. The fixtures remain uncommitted, but the document now says so plainly, downgrades its own Confidence row to Low on receipt-ness, and names committing them as Phase A's first deliverable — which is exactly what "as much as we can without writing code" permits a Draft Research document to do.

**READY**

## Disposition table

| # | Round-1 finding | Disposition | Justification |
| --- | --- | --- | --- |
| 1 | MATERIAL — no benchmark artifact; Supabase app row not reproducible from the committed fixture | **PARTIALLY RESOLVED** (remainder non-blocking) | False row corrected and disclosed in full (both rows kept, 2.57.4 row re-verified by me at 127,339/34,854/30,420 B; correction direction honestly stated); versions added; reproducibility downgraded to "independently reconstructed… not a committed receipt" with Confidence "Low"; fixtures still uncommitted but explicitly Phase A's first deliverable — a stated limitation, not a misstatement. Residue: the Convex row has the same measured-vs-pinned mismatch, filed as N2. |
| 2 | MATERIAL — Confidence asserted "protocol never tested thin"; Swift client missed | **RESOLVED** | F8 added with exact line counts (wc -l verified: 1,138/1,450/803/141/117); LLP 0093 record accurate (clean-room, fixture-passing, landed 2026-07-26 with guide pages); Confidence basis corrected; OQ2 reframed to the JavaScript-byte question; §Questions-the-corpus-already-answers closes the old framing. |
| 3 | MATERIAL — Online profile + Phase C/D could graduate a hosted-unshippable client; OQ8 posed as open what 0077 answers | **RESOLVED** | Mandate now stated as decided in Summary, §Online profile (three-posture table; "by construction ineligible for hosted deployment… must say so in its name and documentation"), criterion 10, Phase C's mandatory posture declaration, and §Questions-the-corpus-already-answers; backing cites verified (llp/0077:869–872, :918; llp/0096:687–690; llp/0060:480–482). The finding's offered alternative (explicit scope disclaimer) was taken. |
| 4 | MATERIAL — gates weaker than the corpus allows (no 0095 corpus gate; no operational gate; no whole-app line) | **RESOLVED** | Gates 11 (corpus verified real and tuple-routed at `schemas/live.wire-fixtures.v1.json`, formatVersion 3; narrower class minted in 0095, not the spike), 13 (pre-registered thresholds with an explicit measure-only author-decision escape), 14 (whole-app beside 70.3/131.2 with the React-hooks/auth-lanes envelope statement) added, plus gate 12 beyond what was asked; OQ6/OQ11 wire them to open decisions. |
| 5 | MATERIAL — Option 1 React extraction misnamed and misclassified | **RESOLVED** | Option 1/F2/F3/Phase B rewritten: `@expo/snapback-react` named as published (verified), LLP 0130 SD-6 cited (verified), extraction reclassified as an LLP 0114 public-seam amendment (seam quote verified at llp/0114:1132–1138) with coordinated two-package landing; matrix risk column updated. One-word naming residue filed as N1. |
| 6 | MATERIAL — minimal contract omitted wire-mandatory invalidation semantics | **RESOLVED** | Items 9 and 10 added (obligation receipt/apply/ACK with 0095's mechanics — all six verified in llp/0095 — and the 0059 fence); the no-leases nonclaim stated as a claim the profile must make; F7 rewritten on the policy/mechanism axis consistent with llp/0053:122/281–282/869. |
| 7 | MATERIAL — LLP 0129 Phase 0 ownership unnamed | **RESOLVED** | §Migration names Phase 0 of 0129 (Accepted) as owner of the shipped `rqsStore` browser default and routes any default flip through a 0129 amendment; §Status adds it to the not-authorized list. Verified against llp/0129:404–415 and Status. |
| 8 | DETAIL — Option 5 range inconsistent (5–15 vs 5–20) | **RESOLVED** | Body and matrix both read 5–15 kB data-only. |
| 9 | DETAIL — Diary 0050 gzip figures unreconciled | **RESOLVED** | Reconciliation paragraph added (default-level vs level-9, gap stable 60.9/61.6); diary figures verified in `diaries/0050` ("231.6 kB JS (71.2 kB gzip)", "456.2 kB JS (132.8 kB gzip)"). |
| 10 | DETAIL — Related/citation gaps (0130, 0139, 0137-item-7/0122) | **RESOLVED** | Related now carries 0122/0126/0129/0130/0137/0138/0139 + Diary 0050; Phase A states the WS8/0122 relationship (quotes verified at llp/0063:1753–1754, 1775–1787; llp/0137:547–553); Phase B defers admin shape to 0122's live option set (all four shapes verified). |
| 11 | DETAIL — Phase C spike comparability to the incident-room arm | **RESOLVED** | Explicit "strict subset" paragraph (upload + sessions excluded, never quote beside 70.3/131.2 unqualified) plus the auth-posture declaration requirement. |

## New findings

No BLOCKING or MATERIAL findings. Four DETAILs and one blindness-bounded verification note:

**N1. DETAIL — The disavowed "React binding" name survives in two spots the correction did not reach.** (§Summary, §F2.) Line 41–42: the import "closes over most of the client platform: online requests, streaming, React bindings, …" and line 255: "Its dependency graph includes the React binding, …" — while line 288 states "**`react-binding.mjs` is not the React binding.** It imports no React at all," and F3/gates/tables all say "React admission (path)". A Summary-only reader takes away that the headless closure ships React bindings, which the doc itself now says is false in both name and substance. Resolve: "React admission path" in both places.

**N2. DETAIL — The Convex application row carries the exact provenance defect the revision corrected for Supabase, unannotated.** (§Application-level corroboration.) The row states "convex 1.43.0 | 79.9 | 21.7 | 19.3". I reproduced it exactly at 1.43.0 (79,902 / 21,746 / 19,286 B) — but the committed fixture pins convex **1.42.3** (`demos/signal-desk/package.json:36`, `bun.lock:17,300`), which measures 79,015 / 21,507 / 19,062. The doc's new standard — "with the fixture's dependency state changed and unrecorded" is a defect worth a paragraph, and "only the 2.57.4 row is reproducible from this repository today" — is applied to one adapter and not its neighbor. Magnitude is 0.24 kB gzip (~1%), immaterial to any conclusion, which is why this is DETAIL and not MATERIAL. Resolve: one clause marking the row as measured at the then-current 1.43.0 rather than the pinned 1.42.3 (or add a pinned-version row as was done for Supabase).

**N3. DETAIL — "30.8 kB" disagrees with the doc's own table and with re-measurement.** (§F2.) "Stubbing `react-binding.mjs` removes 30.8 kB minified" — the F3 table's own rows give 250.9 − 220.2 = 30.7, and my exact rebuild gives 250,952 − 220,258 = 30,694 B = 30.7 kB. (The paired claim verifies perfectly: file-store removal is 7,798 B = "7.8 kB attributed, 7.8 kB removed".) The 0.1 kB is within fixture-wording noise, but the sentence exists to teach a precise attributed-vs-exclusive distinction and should match its own table. Resolve: 30.7, or "≈30.7".

**N4. DETAIL — The auth-posture table's middle row cites the wrong half of LLP 0096.** (§Online profile.) "Sessions, local target … ratified, LLP 0096 §7" — §7's decision is explicitly scoped to "a production client on a **hosted** deployment" (llp/0096:699–701). The row's substance is correct and enforced: the `auth/rr`/`auth/live` refusals are shipped sessions-mode behavior on any target (llp/0096 §2.1:169–204, §2.2:206+; §7 itself notes they are "current sessions-mode behavior"). Resolve: cite §2.1/§2.2 (shipped refusals) for the local row; keep §7 for the hosted row.

**N5. DETAIL (verification note) — one provenance clause is structurally unverifiable under blindness.** (§Method, Reproducibility status.) "independent re-measurement during round-1 review, by two reviewers working separately, reproduced…" — the Fable half is accurate against my family's round-1 artifact, and the substantive claim (the Snapback rows reproduce from the stated method) is now confirmed a third time by this review's independent rebuild. The codex half I am forbidden to check; the orchestrator, who holds both artifacts, should confirm the "two reviewers… every row… all four… both" scope before this sentence is treated as fully receipted. Not a defect unless the codex artifact says otherwise.

## Surviving-text judgement

The surviving unchanged text is clean, and I would stop here. Concretely: the unchanged measured claims were reproduced in round 1 (F2 attribution row-for-row from a metafile, F4 both figures, the application rows byte-exact from committed `dist/` artifacts, Zero/Replicache/PocketBase spot-checks, the LLP 0063 mangling record, the `__snapbackHandlers` handler-source fact), and this round independently re-reproduced the baseline and all three counterfactuals and spot-verified the three registry-current comparator versions — so the evidence base has now survived two blind reviewers and three measurement passes. The unchanged options (0, 2, 6–9), the matrix-vs-assessment agreement, and the hypothesis/finding discipline were checked in round 1 and re-read now without new hits. Everything a further round would find is either already named by the document as open (uncommitted fixtures, unmeasured byte hypotheses, the fifteen OQs) or is in the DETAIL list above. I do not believe another reading round finds real defects; the next real information comes from Phase A's committed harness and the Phase C spike, not from review.

## Open questions

1. N2's author decision: does the Convex adapter row get the Supabase treatment (annotate as measured at 1.43.0, or add a 1.42.3 re-pinned row), and more generally does the application table adopt "version stated = version the committed fixture pins" as its rule?
2. The orchestrator-only check from N5: does the codex round-1 artifact in fact reproduce the full scope the reproducibility paragraph claims for "two reviewers working separately"?
3. Gate 13: measure-only for the first spike, or gating with pre-registered thresholds? The doc correctly flags this as a decision to state (and OQ6 asks for the threshold) — it should be made, not carried, when Phase C is commissioned.
4. OQ14 (ownership at graduation — successor RFC vs LLP 0122 extension vs both, and 0143's terminal status) is the one structural question the author must answer before the spike's results have a home.

## Verdict

READY

## Orchestrator verification and disposition (outside the verbatim body)

All four DETAILs verified against the tree and applied in v0.3:

- **N1** — confirmed at lines 41–42 and 255; both now read "React admission
  path". The correction at line 288 had not propagated to the Summary.
- **N2** — confirmed: `demos/signal-desk/package.json:36` pins convex 1.42.3.
  The row is annotated and the Convex/Supabase asymmetry is now stated in the
  correction paragraph rather than applied to one adapter only.
- **N3** — confirmed: the document's own F3 table gives 250.9 − 220.2 = 30.7.
  Corrected. (The orchestrator's own round-1 reproduction reported 30.8 from a
  251.0 baseline; Fable's 30,694 B and the document's table agree on 30.7.)
- **N4** — confirmed: LLP 0096 §7 is scoped to "a production client on a hosted
  deployment". The local-sessions row now cites §2.1–§2.2; the hosted row keeps
  §7.

**N5 is resolved in the document's favour.** Fable could not check the codex
half under blindness. The orchestrator holds both artifacts, and the round-1
codex review states: "I independently rebuilt plausible root and `/online`
fixtures and reproduced 250.9 kB raw / 70.1 kB gzip to displayed precision, the
F2 attribution rows, all F3 counterfactual values, and the root-versus-subpath
search result." The "two reviewers working separately" clause is accurate at
the scope claimed, and is in fact conservative — a third independent
reproduction was run by the orchestrator before either review landed.


## Round 3 — 2026-08-01 (delta-confined)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, delta-confined. Permitted to
read exactly one prior artifact — its own family's sections above — and no
other file under `llp/reviews/`; no `super-refine` path; blind to this
document's codex artifact, which was reviewing the same revision concurrently.
SHA-pinned target and instruction capsule. The reviewer was instructed to press
harder on text it had not personally re-read, because its family had declared
the surviving text clean in round 2 and a defect was nonetheless found in it.
**Instruction capsule SHA-256:** `1ebb43a85771dda05584da56526cfafdb4a7a5a0df6f725c7f9fba9e7ece5a1b`
**Target:** `llp/0145-client-bundle-architecture.research.md` (v0.4, 1,413
lines, Draft, uncommitted working tree)
**Target SHA-256:** `cb3a0bad234b1dd963614d995a36ce799e8ab4b81d0619226ebde6c07e952b42`
**Repo revision at review start:** `0c0040ff` on `main`
**Tool uses:** 61
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

# LLP 0145 review — round 3 (delta-confined, independent reviewer, Claude/Fable family)

Target: `llp/0145-client-bundle-architecture.research.md`, working tree, SHA-256 `cb3a0bad234b1dd963614d995a36ce799e8ab4b81d0619226ebde6c07e952b42` (verified against the capsule; 1,413 lines). Repo at `0c0040ff` on `main`. Blindness rules honored: the only file read under `llp/reviews/` was `0145-client-bundle-architecture.fable.md`; no `super-refine` path and no codex artifact was read. All paths relative to `/Users/ccheever/projects/snapback` unless absolute. Every disposition and every v0.4 delta claim below was re-verified against the tree, not taken from the Revised header — and, heeding this round's instruction, I re-read the entire document and personally re-verified the load-bearing citations my family had previously accepted, rather than trusting my own prior rounds.

## Overall assessment

The v0.4 delta is mostly excellent verification-grade work, and I checked it the hard way. The `terminalDelete` split is now correct nearly verbatim against the spec: LLP 0095 requires exactly what item 10 and F7 now say — "carries no snapshot (wire omission and JSON `null` are equivalent)" is a word-for-word quote (`llp/0095-client-lifecycle-and-conformance.spec.md:275-276`), the destroy → fence → `TERMINAL_DELETED` → then-ACK ordering is 0095:276–279, and no-resurrection plus the fresh never-reused `queryInstanceId` is the 0095:87 state row. The three new minimal-contract items are real wire obligations, not invented ones: the open-time `authInvalidationProtocol: 1` body offer and the `x-snapback-auth-invalidation-protocol: 1` header on every subscribe **and** unsubscribe are LLP 0096 §2.2's two mandatory carrier stages (`llp/0096-auth-profiles-for-protocol-clients.spec.md:209-231`), the `authorizationNamespace` allocation/retention lifecycle is 0096:253–276, and "conformance obligation, not etiquette" plus "establishing live owner" are 0095's own words (0095:130–135). Both corpus gaps that motivate gates 11a/11b/12a are real: I parsed `schemas/live.wire-fixtures.v1.json` (formatVersion 3, 49 fixtures) and found no unsubscribe/release/teardown/demand fixture id, and its coverage string ends "auth/sender deliberately deferred per LLP 0096 §5" — corroborated by 0096:839–841. Gate 11b's anchor is exact ("LLP 0064's per-OS evidence rule applies unchanged", 0095:449). Gate 12a's seven legs all map onto LLP 0077's Acceptance section (0077:1237–1267). The withdrawn cost claim's new tree fact is true: the shipped hosted facade is `packages/snapback-client/hosted-browser.mjs`, published as `./hosted-browser` (`package.json:57-59`), and line 10 imports the entire client root. The subpath correction is true: `./online` is in the published export map and `online.mjs:8-12` re-exports the full `SnapbackClient`. Phase B's reroute quotes LLP 0122 accurately — "research input… evidence consolidation and option analysis, no decisions," LLP 0115 CV-1 as external-install execution owner, LLP 0041 as lead packaging owner (`llp/0122-installed-product-coherence-and-packaging.research.md:740-742`) — and 0122 Option 6's four admin shapes are exactly the four Phase B lists (0122:412–448). I also ran a fourth independent reproduction of the baseline headless closure: 250,971 B minified / 70,143 gzip / 60,213 brotli against the doc's 250.9/70.1/60.2 kB, from the registry-installed `@expo/snapback-client@0.1.8` and the fixture's esbuild 0.28.1.

One piece of the v0.4 delta is wrong, and it is the kind of wrong this document's own bar names — misdescribing a governing LLP and the current tree. The new hosted-availability paragraph (lines 980–991) reads LLP 0096 §2.6's Cloudflare-arm cells and concludes "there is at present no hosted deployment to satisfy [the floor] against" and "the first spike cannot claim the hosted posture no matter how it is built, because the target does not exist yet." But §2.6's own closing sentence defines that inference away: "'Hosted production' in §7 therefore means the Rust server operated as a hosted deployment (LLP 0060's posture), **not the Cloudflare arm**" (0096:492–494) — and the tree records that exactly such a target existed and was exercised: the LLP 0077 acceptance matrix ran against `https://snapback-drill.fly.dev` with "sessions staged under hosted admission" on 2026-07-27 and passes 43/43 (0077:15–18, 31–32). The same paragraph's "records every auth profile as 'not negotiable'" also over-reaches the matrix, whose `auth/sender` row reads "not applicable," not "not negotiable" (0096:475–479). This contradicts the document's own gate 12a — which treats the hosted-browser posture as claimable by running precisely that served-origin matrix — and quietly pre-answers OQ19. That is one MATERIAL finding in roughly 130 added lines; everything else I checked in the delta held, and the surviving text held under a deliberately more aggressive re-read than my family gave it last round. But the bar does not grade on ratio.

**NOT READY**

## Disposition table

Round-2 findings (my family's N1–N5), each re-verified against the tree:

| # | Round-2 finding | Disposition | Justification |
| --- | --- | --- | --- |
| N1 | DETAIL — disavowed "React binding" name survived in Summary and F2 | **RESOLVED** | Both sites now read "the React admission path" (target lines 53–56, 280); F2's corrective paragraph (line 313) and gate 2's wording are consistent with it. |
| N2 | DETAIL — Convex adapter row carried the measured-at-bumped-version provenance defect unannotated | **RESOLVED** | Row now states "convex 1.43.0, fixture pins 1.42.3" (line 184); the correction paragraph covers both adapter rows with the benign/not-benign split and the right numbers — 79.0/21.5 at 1.42.3 vs 79.9/21.7 at 1.43.0 is the 0.24 kB gzip delta my round-2 measurement gave (lines 190–196). A propagation residue in §Confidence is filed as new finding 3, not charged to this fix. |
| N3 | DETAIL — "30.8 kB" disagreed with the doc's own F3 table | **RESOLVED** | Line 306 reads "removes 30.7 kB minified," matching the table (250.9 − 220.2) and both prior measurements. |
| N4 | DETAIL — auth-posture middle row cited LLP 0096 §7 for local sessions | **RESOLVED** | Line 969 now cites "shipped sessions-mode refusals, LLP 0096 §2.1–§2.2"; §2.1/§2.2 are the shipped refusal contracts, and the hosted row keeps §7 (line 970). |
| N5 | Verification note — "two reviewers working separately" unverifiable under blindness | **RESOLVED** | The orchestrator's disposition note in my family's artifact confirms the codex half at the claimed scope and records a third orchestrator reproduction; my fourth independent rebuild this round (250,971/70,143/60,213 B) further corroborates the substance. |

Round-1 findings, checked for persistence through the v0.4 rewrite of the sections that carry them: F1 (Supabase row correction + reproducibility downgrade) intact at lines 141–152, 198–207, 1404; F2 (Swift/F8, Confidence basis) intact at 471–494, 1402; F3 (hosted mandate stated as decided) intact and extended at 85–102, 962–978, 1187+ — the extension carries the new MATERIAL below; F4 (corpus/operational/whole-app gates) intact and strengthened as gates 11–14; F5 (naming/seam reclassification) intact in Option 1, F2, F3, Phase B; F6 (obligation seam) intact and extended as items 9–12; F7 (LLP 0129 Phase 0 ownership) intact at 1274–1281 — and I confirmed 0129's 2026-08-01 v0.7 re-scope touches its delta-resume row (0129:733–745), not Phase 0 (0129:405–410), so the ownership claim still stands; F8–F11 DETAILs all still resolved.

## New findings

**1. MATERIAL — The hosted-availability paragraph misreads LLP 0096 §2.6, contradicts the tree's served-origin record, and collides with the document's own gate 12a.** (§Online profile, lines 980–991.) Three defects in one paragraph, all introduced by v0.4. (a) "LLP 0096 §2.6's verified arm matrix records every auth profile as 'not negotiable' on the hosted Cloudflare arm" — four profiles are "not negotiable"; the `auth/sender` row reads "**not applicable**" (0096:475–479). (b) The inference "so… there is at present no hosted deployment to satisfy it against" attaches a true Cloudflare-arm fact to the wrong referent: §2.6 closes by stating "'Hosted production' in §7 therefore means the Rust server operated as a hosted deployment (LLP 0060's posture), not the Cloudflare arm" (0096:492–494), and on that referent the floor's lanes are served today — §2.6's local column marks `auth/sender` "served under hosted admission posture (§2.5)" (0096:479). (c) "The first spike cannot claim the hosted posture no matter how it is built, because the target does not exist yet" is contradicted by LLP 0077's Revised header: the first true served-origin run of the acceptance matrix executed against `https://snapback-drill.fly.dev` ("D-1-fixed binary, sessions staged under hosted admission") on 2026-07-27, surfaced and fixed D-2, and the matrix now passes 43/43 (0077:15–18, 31–32) — i.e., the target has been built, the recipe is recorded, and gate 12a (line 1223) names exactly that matrix as the instrument a hosted-posture spike would run. As written, the paragraph makes gate 12a dead text and pre-answers OQ19 by fiat. Why it matters: this is the capsule's named failure class — misdescribing a governing LLP and the current code — on the load-bearing posture question, and it would mislead a reader into believing hosted-posture validation is impossible rather than expensive-and-drill-shaped. What would resolve it: re-scope the unavailability claim to the Cloudflare product arm (where "no sessions surface at all," 0096:166–167, is true and worth saying); state §7's actual referent per §2.6's closing note; replace "cannot claim… no matter how it is built" with the true statement that a hosted-posture claim requires standing up a served-origin deployment the way the 0077 matrix run did; and reconcile OQ19's framing (Cloudflare sessions landing vs 0060-posture drill validation are different questions).

**2. DETAIL — "Four more gates close it" now introduces seven gates.** (§Phase D, line 1185.) The v0.2 sentence counted 11–14; v0.4 inserted 11a, 11b, and 12a as peer entries (lines 1208, 1213, 1223) — gate 11's own text calls them "Gates 11a and 11b" — without updating the count. Renumbering damage, exactly the class the delta review is told to look for. Resolve: "Seven more gates" or "Four more gate families."

**3. DETAIL — The Confidence table still says "one application row was measured against an unrecorded dependency upgrade."** (§Confidence, line 1404.) Since the v0.3 N2 fix, the corroboration section states that **two** adapter rows were measured against newer-than-pinned providers ("Two adapter rows were measured against a newer provider than the committed fixture pins," line 191) — Supabase materially, Convex benignly. The Confidence basis was written when only the Supabase mismatch was known and was never propagated. Resolve: "two application rows (one materially)."

**4. DETAIL — Related list omits LLP 0041 and LLP 0115, which v0.4 made load-bearing.** (Header, lines 33–38.) Phase B now routes the admin decision "to LLP 0041/0115 or a named successor" (lines 1119–1120) and OQ18 names both as candidate owners, but neither appears in Related. Same class as round-1 finding 10, reintroduced by the revision's own reroute. Resolve: add both.

**5. DETAIL — Three small anchoring imprecisions in new text, none load-bearing.** (a) Gate 11a's "last-demand-wins assertions" (line 1209) is a coinage with no corpus anchor: 0095's demand model is arming "recomputed on subscribe, unsubscribe, socket close, and connection purge; there is no linger window" (0095:122–124) plus T-REAP's crash-backstop rule — name the assertion in those terms. (b) Item 12's "A client that simply drops the socket leaks server demand" (line 1037) is arm-dependently overstated: on the hosted arm "demand release is the socket close/error teardown," and on the local arm the leak is bounded by the 120 s idle-TTL reap (0095:159–165); the conformance point (T-UNSUB is an obligation; reaping is "the crash backstop only") survives and is the better justification. (c) F1 still says "Phase A should add a Firestore Lite row" (line 271) while the comparative table now carries the placeholder row (line 163) — "measure" it, not "add" it.

## Surviving-text judgement

The explicit stopping-rule answer: **the surviving unchanged text is clean to a fourth-pass depth, and the residual risk has migrated into the text each revision adds — which is where this round's one MATERIAL sits.** Taking seriously the warning that my family declared the surviving text clean last round and defects were nonetheless found in it, I did not re-skim: I re-read all 1,413 lines and re-verified, personally and against the current working tree, the citations my family had previously accepted on its own prior authority — 0095's T-UNSUB/T-REAP/RESYNC/terminal-delete mechanics, 0096 §2.1/§2.2/§2.5/§2.6/§7/§8.4, 0077's Acceptance section and served-origin header record, 0122's ownership language and Option 6, 0129 Phase 0 (including confirming today's v0.7 re-scope does not touch it), 0063 Workstream 8 (1749, 1753–1754, 1775–1787 — the wrap-around grep trap is real), 0137 item 7 (547–553, surviving today's working-tree revisions to that file), 0064's per-OS receipts, 0114's seam and egress-validation lines, 0053/0059 anchors, Diary 0050's figures and dev-`userId` record, plus the tree facts (index.mjs at 10,832 lines; `sideEffects` absent; `./online` and `./hosted-browser` in the export map; `__snapbackHandlers` in the Signal Desk manifest; the Swift client at 1,138/1,450/803/141/117 = 3,649 lines) and a fourth baseline reproduction. The only defect found in surviving text this round is finding 3 — a propagation residue of my own family's N2 fix, DETAIL-grade. The unchanged options, matrix, findings, risks, and migration sections re-read consistent, and every internal cross-total I recomputed (60.9/59.5/~98%, 30.7, 0.24, 5–15 body-vs-matrix, matrix-vs-assessment agreement for all eleven options) checks. I do not believe a further reading round finds real defects in the pre-v0.4 text. Where a further round must look is narrow and concrete: the v0.5 rewrite of the hosted-availability paragraph and its propagation into OQ19 and gate 12a. One more delta-confined pass over that paragraph should close the loop.

## Open questions

1. From finding 1: which referent does the hosted-availability paragraph intend — the Cloudflare product arm (sessions genuinely absent, 0096:166–167) or LLP 0060's hosted posture (served today; drill-validated 43/43 per 0077) — and does OQ19 get reframed to distinguish "Cloudflare sessions must land" from "a 0060-posture served-origin drill can validate the hosted-browser posture now, at drill cost"?
2. Carried from round 2, still the structural ones: gate 13's threshold values must be pre-registered when Phase C is commissioned (OQ6), and OQ14's graduation-ownership decision (successor RFC vs LLP 0122 extension vs both) is the one the spike's results cannot land without.
3. Does the application table's provenance rule ("version stated = version the committed fixture pins, deviations annotated") get written into §Method as a standing rule, so the next added row cannot regress it? The Confidence-row residue (finding 3) shows the rule currently lives only in the corroboration prose.

## Verdict

NOT READY

## Orchestrator verification and disposition (outside the verbatim body)

The MATERIAL and all four DETAILs verified against the tree and applied — the
DETAILs in v0.5, the MATERIAL in v0.5 and then rebuilt in v0.6 once the codex
family's independent version of the same finding supplied LLP 0098.

- **Finding 1** — confirmed on every limb. LLP 0096 §2.6's `auth/sender` row
  reads "**not applicable**" for Cloudflare and "served under hosted admission
  posture (§2.5)" for the local arm; §2.6 closes "'Hosted production' in §7
  therefore means the Rust server operated as a hosted deployment (LLP 0060's
  posture), not the Cloudflare arm"; LLP 0077's Revised header records the
  served-origin run against `https://snapback-drill.fly.dev` at 43/43. The
  defect was introduced by the orchestrator in v0.4 while applying the codex
  family's round-2 finding — a genuine over-correction, caught because the two
  families read the same section independently.
- **Findings 2–5** — all confirmed and applied: the gate count, the Confidence
  row's "one application row" after the Convex fix made it two, `last-demand-wins`
  re-anchored in LLP 0095's actual demand-model language, the socket-drop claim
  narrowed to the crash-backstop framing, the Firestore Lite row now a
  placeholder to measure rather than to add, and LLP 0041/0115 added to Related.

**Method note worth preserving.** This reviewer was told its family had
declared the surviving text clean in round 2 while a defect was nonetheless
found in it, and was asked to press harder on text it had not personally
re-read. It responded by re-reading all 1,413 lines and re-verifying citations
its own family had previously accepted on its own authority, rather than
re-affirming them — and produced a materially more precise stopping-rule
answer as a result. The instruction is worth repeating in later loops.


## Round 4 — 2026-08-01 (delta-confined)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, delta-confined. Permitted to
read exactly one prior artifact — its own family's sections above — and no
other file under `llp/reviews/`; no `super-refine` path; blind to this
document's codex artifact, which was reviewing the same revision concurrently.
SHA-pinned target and instruction capsule. Instructed to verify the
twice-rewritten passages from scratch rather than against its own prior
findings, and to reapply the round-3 skepticism about surviving text.
**Instruction capsule SHA-256:** `4951921442367e2c95fdc8dfc4e31744aca983d75c1e50daa629dcf61eedaea3`
**Target:** `llp/0145-client-bundle-architecture.research.md` (v0.6, 1,567
lines, Draft, uncommitted working tree)
**Target SHA-256:** `19bb6e74f99746346dd97b5caac6fcb6c1ec405dc2df7d815f86fd52fcb17ab5`
**Repo revision at review start:** `0c0040ff` on `main`
**Tool uses:** 48
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

# LLP 0145 review — round 4 (delta-confined, independent reviewer, Claude/Fable family)

Target: `llp/0145-client-bundle-architecture.research.md`, working tree, SHA-256 `19bb6e74f99746346dd97b5caac6fcb6c1ec405dc2df7d815f86fd52fcb17ab5` (verified against the capsule; 1,567 lines). Repo at `0c0040ff` on `main`. Blindness rules honored: the only file read under `llp/reviews/` was `0145-client-bundle-architecture.fable.md`; no `super-refine` path and no codex artifact was read. Approximately 34 tool uses. All paths relative to `/Users/ccheever/projects/snapback` unless absolute. Per this round's instruction, I did not check the twice-rewritten passages against my prior findings — I verified their current state from scratch, limb by limb, against the governing documents and the tree.

## Overall assessment

The v0.5+v0.6 delta is the strongest revision this document has received, and the rebuilt hosted-availability passage — the text that has now been wrong in two different directions across two revisions — is this time correct on every limb I could check. I verified it from scratch rather than against my family's round-3 complaint: LLP 0096 §2.6 does record the four profiles "not negotiable" and `auth/sender` "not applicable" on the Cloudflare arm (`llp/0096-auth-profiles-for-protocol-clients.spec.md:475–479`); the arm's manifest really declares `supportedAuthModes: ["dev"]` (`cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json:8–10`, and 0096:480–485 adds the no-`/auth/*`-route fact verbatim); "local-arm-only today" and the named-gap-subordinate-to-0060 clause are 0096's own words (:486–488); §2.6's closing sentence fixes §7's referent exactly as quoted (:491–494); the 43/43 served-origin run against `https://snapback-drill.fly.dev` with sessions staged under hosted admission, surfacing D-2 (a second `/auth/exchange` over an already-bound key — "bound-key re-exchange" is a fair gloss; the pinned fixture is `issuance/a-second-exchange-with-a-bound-key-refuses-coded`), is the record in `llp/0077-sender-constrained-browser-auth.spec.md:15–32` and `llp/0098-hosted-edge-adapter.spec.md:858–895`; LLP 0098 defines `loopback-terminated-single-instance.v1` (0098:44), is Draft with "No capability is claimed by this document" (0098:4, 958), and records the window expiry ("The serving window then expired as designed," 0098:895); and LLP 0060's Status contains "There is no hosted auth deployment in this implementation. A future hosted target must implement and prove every conjunctive edge fact above" (`llp/0060-hosted-auth-security.rfc.md:1136–1137`). The passage now agrees with gate 12a and with the reframed OQ19. "Expensive rather than impossible" is the true statement of the situation.

The other high-risk edits verify too. The minimal-contract scoping table's dev-mode basis is exact: 0096:535 ("In settled dev mode all four axes report available with **null** minima") and 0096:570–571 ("claims no profile; the axes are open there without negotiation" — verbatim), and §2.2 makes the per-subscribe carrier a *sessions-mode* requirement with "any other or absent value opens a legacy connection" (0096:206–231), so a local-dev thin client omitting items 10/11 is wire-legal, exactly as the table says. The `auth/live` upgrade restatement item 11 adds is real and is a distinct carrier stage: 0096's gate-timing table shows "kit stream upgrade (subprotocol list) | the four axis tokens + bearer token + sender proof | all, as upgrade-time restatement" (0096:500–501). The named admission mechanism that replaced the withdrawn "server rejects operation-identity mismatches" claim is true in all four tree facts: generated references carry `appId`/`id`/`implementationHash`/`argsContractHash`/`resultContractHash` (`demos/signal-desk/snapback/generated/api.mjs:40–62`), invocation reduces them to `ref.name` (`packages/snapback-client/index.mjs:10608–10609`), the server dispatches by path name (`src/server.rs:7826`, `:9027`), and client-side admission compares the exact identity tuple (`packages/snapback-client/react-binding.mjs:133–139`, `exactDeploymentFunction` joining id/kind/implementation/args/result hashes). LLP 0108 §B says precisely what the document now attributes to it — `ExpectedOperationV1` "removed from this implementation slice… must not advertise `expected_operation_v1`, add wire members for it" (`llp/0108-inline-handlers-and-result-contracts.spec.md:701–709`) — and I confirmed the apparent counter-hit at 0108:629 is the client-side/sibling-lane acceptance criterion, not a wire carrier. Gate 5's action facts hold (`/action/${name}` distinct route, index.mjs:5068; "the action tier is nondeterministic and never auto-replayed," `llp/0133-local-settlement.spec.md:697`); gate 11b's quote is verbatim LLP 0064 (`llp/0064-native-client-surfaces.rfc.md:33–34`) and OQ22's receipt facts are 0064:138–139; Phase B's reroute is accurate (decision 4, 2026-07-30: "the admin surface **folds into the CLI** — command-shaped, outside app graphs — and the served path remains the documented external-tooling fallback," `llp/0115-convex-parity-course-corrections.plan.md:485–487`; `packages/snapback-admin-client` is `@expo/snapback-admin-client`); the withdrawn cross-tab nonclaim's anchors are exact (Web Locks preferred mutex and "an in-memory capture alone cannot justify a write," `llp/0059-session-projection-and-client-barrier.spec.md:1906–1908`; custody reload after acquisition, :1879; two-context delayed-race acceptance, :2558–2559; "Multiple tabs coordinate custody generation and nonce replacement," 0077:1033). I re-parsed the fixture corpus (formatVersion 3, 49 fixtures, zero unsubscribe/release/teardown/demand ids, coverage ending "auth/sender deliberately deferred per LLP 0096 §5") and re-verified 0095's demand model and T-REAP crash-backstop language (0095:123–124, 131–133, 159–165). I also ran a fifth independent baseline reproduction: 251,058 B minified / 70,197 gzip / 60,253 brotli against the doc's 250.9/70.1/60.2 kB.

What keeps it from READY is one propagation miss of exactly the kind this loop's capsule predicts. The v0.6 scoping change — items 10 and 11 conditional on posture, "not applicable" for local dev, with a preamble stating the earlier universal framing "contradicts this document's own local-dev posture and overstates the local-dev byte floor" (lines 1111–1124) — was applied in the contract section and not propagated to the two other places that state the same constraint. The Summary still says, under "both are already ratified rather than open": "an Online client that subscribes to auth-scoped live data inherits LLP 0053's invalidation obligations… Both must sit inside the contract rather than outside the budget" (lines 106–109), and §Questions-the-corpus-already-answers still says the obligation seam "must be shared" between profiles without the posture condition (lines 1462–1466). A local-dev client subscribing to auth-scoped live data — the Phase C spike's most likely configuration, since its fixture is exactly that — inherits nothing of LLP 0053's obligation machinery on a legacy connection, per the same 0096 text the scoping table cites. The document currently gives a reader two different minimal contracts for its own first spike depending on which section they trust. That is one MATERIAL defect in ~150 added-or-touched lines, everything else verified, and all five of my family's round-3 findings are genuinely resolved — but the bar does not grade on ratio.

**NOT READY**

## Disposition table

Round-3 findings (my family's 1–5), each re-verified against the tree, not the Revised header:

| # | Round-3 finding | Disposition | Justification |
| --- | --- | --- | --- |
| 1 | MATERIAL — hosted-availability paragraph misread LLP 0096 §2.6, contradicted the served-origin record, collided with gate 12a | **RESOLVED** | Rebuilt passage (target lines 1019–1058) verified limb by limb from scratch: "not applicable" now correctly attributed (0096:479); both referents separated with §2.6's closing sentence quoted accurately (0096:491–494); the served-origin 43/43 record and D-2 stated per 0077:15–32 and 0098:858–895; the impossibility claim replaced by "expensive rather than impossible" with three true caveats (0098 Draft/no-capability at 0098:4/958, window expiry at 0098:895, 0060 Status at 0060:1136–1137); gate 12a and OQ19 now consistent with it. |
| 2 | DETAIL — "Four more gates" introduced seven | **RESOLVED** | Line 1302–1303 reads "Four more gate families — eight entries, 11 through 14 with 11a, 11b, 11c, and 12a" — and the count absorbed v0.6's new gate 11c correctly: entries 11/11a/11b/11c/12/12a/13/14 = eight; families 11–14 = four. Gate 11's internal "Gate 11a closes the first and gate 12a the second" mapping still correct. |
| 3 | DETAIL — Confidence said "one application row" after the Convex fix made it two | **RESOLVED** | Line 1558: "two application rows were measured against a newer provider than the fixture pins — one materially." Matches the corroboration prose at lines 204–209. |
| 4 | DETAIL — Related omitted LLP 0041 and LLP 0115 | **RESOLVED** | Both present (lines 45, 49) and both load-bearing in Phase B/OQ18. The *class* recurred in v0.6 with different numbers — filed as new finding 2, not charged against this fix. |
| 5 | DETAIL — three anchoring imprecisions (11a's "last-demand-wins" coinage; item 12's socket-drop overstatement; F1 "add" vs placeholder) | **RESOLVED** | (a) Gate 11a now speaks 0095's own demand-model words — "recomputed on subscribe, unsubscribe, socket close, and connection purge with no linger window… idle-TTL reaping as the crash backstop only" (verified 0095:123–124, 159–165). (b) Item 12 narrowed to the crash-backstop framing with the local arm's idle-TTL reap named and "even though it bounds the leak" added (lines 1104–1109; verified 0095:131–133, 159–165). (c) F1 line 285: "Phase A should measure the Firestore Lite row this table now carries as a placeholder." |

Persistence check of rounds 1–2 through the v0.5/v0.6 rewrites: the Supabase correction and both-rows provenance (lines 195–225), F8 (499–523), the hosted-mandate statement (97–105, criterion 10, Phase C posture declaration), gates 11–14, Option 1's naming/seam reclassification, contract items 9–12, LLP 0129 Phase 0 ownership (1409–1415), Option 5's 5–15 in body and matrix, the Diary 0050 gzip reconciliation (227–230), "React admission path" in Summary and F2, 30.7, and the N4 §2.1–§2.2 citation (line 1008) are all intact. I independently re-verified this round, rather than trusting my family's prior rounds: index.mjs at 10,832 lines, `online.mjs:8–12` re-export, `sideEffects` absent from `packages/snapback-client/package.json`, the 0114 seam quote (llp/0114:1135–1138), the 0012:582–584/0043:55 Parity rule, 0095:275's verbatim `terminalDelete` quote, 0053:122/282 level-triggered-until-acknowledge, the 0063:1841–1855 mangling record, `hosted-browser.mjs:10`'s root import, and the baseline bundle (fifth reproduction, above).

## New findings

**1. MATERIAL — The Summary and the answered-questions section still assert the universal obligation-inheritance that the v0.6 scoping table withdrew.** (§Summary lines 106–109; §Questions the corpus already answers lines 1462–1466; §Minimal runtime contract lines 1111–1124.) The scoping table makes item 10 (the LLP 0053 obligation seam) and item 11 (the `auth/live` carrier) "not applicable — no profile is claimed or negotiated" for the local-dev posture, on correct grounds: 0096:570–571 ("claims no profile; the axes are open there without negotiation"), 0096:535 (dev mode: all four axes available, null minima), and 0096 §2.2, which scopes the per-subscribe carrier requirement to sessions mode and lets an absent open-time offer open a legacy connection (0096:206–231). Its preamble says the earlier universal framing "contradicts this document's own local-dev posture and overstates the local-dev byte floor" (lines 1112–1115). But the Summary still carries that universal framing, presented as ratified: "an Online client that subscribes to auth-scoped live data inherits LLP 0053's invalidation obligations and LLP 0059's authority fence; those are wire semantics… Both must sit inside the contract rather than outside the budget" — no posture condition, in a paragraph opening "both are already ratified rather than open." And the corpus-answers bullet states the obligation seam "must be shared" between profiles, again unconditioned (its "shared verbatim *when present*" reading is rescuable, but it is exactly the ambiguity the v0.6 preamble names). A local-dev client subscribing to auth-scoped live data — which Diary 0050's arm did and the Phase C spike will do ("one authorized live collection") — receives no obligation frames on a legacy connection; the 0059 half of the Summary sentence stays true (item 9 is required in every posture), the 0053 half does not. Why it matters: the Summary is the document's top-level statement of what bounds the thin profile "before any code is written," and it now contradicts the document's own corrected contract on the most likely configuration of the document's own first spike; the byte floor, OQ2's plausibility, and OQ4's framing move depending on which passage a reader trusts. This is the capsule's named commonest failure mode — a fix applied in one place and missed in another. What would resolve it: condition the Summary's second constraint on the posture (e.g., "under the sessions and hosted postures — see the items-10/11 scoping in §Minimal runtime contract; the local-dev posture claims no profile and takes neither item"), align the corpus-answers bullet ("must be shared verbatim wherever the declared posture selects them"), and give F7 bullet 1's "it must still receive and acknowledge" (lines ~458–461) the same one-clause scoping.

**2. DETAIL — Related-list drift recurred in v0.6: LLP 0108 is cited but absent; LLP 0107 and LLP 0112 are listed but never cited.** (Header lines 45–51; body line 1136.) The admission-mechanism paragraph made LLP 0108 load-bearing — it is half the "deliberately add no expected-operation wire carrier" authority, and the claim verifies against 0108:701–709 — but 0108 does not appear in Related. Meanwhile `LLP 0107` and `LLP 0112` were added to Related and appear nowhere else in the document (sole occurrence: line 47). Given 0107 sits exactly where 0108 would slot numerically, this is plausibly a typo. Same class as round-3 finding 4. Resolve: add LLP 0108; cite or drop 0107 and 0112 (0107 react-presence and 0112 generated-query-group-bundle are defensible as context, but then the body should say where they bear).

**3. DETAIL — The "externally-owned-credential" posture appears in the nonclaim rules but in neither posture table, and its lane obligations are stated nowhere.** (§F7 last bullet, §Online profile nonclaim bullet lines 993–996, Option 3 lines 671–677, auth-posture table lines 1005–1009, scoping table lines 1120–1124.) The document splits the profile "three ways on authentication" (local dev / sessions local / hosted browser) but F7, the Online-profile bullet, and Option 3 operate a fourth term — the externally-owned-credential posture — which no table places. The placement matters: an externally supplied bearer establishes sessions authority at open time (0096:500), so on auth-scoped live subscribes the sessions-mode carrier refusals apply regardless of who acquired the token — for items-10/11 purposes an external-bearer client takes the sessions row, gaining only the custody nonclaim. Because "sessions" elsewhere in the profile means the first-party acquisition *module* ("external token/provider seam initially, sessions as a separate module"), an Option 3 reader can plausibly conclude the scoping table's middle row does not apply to them and omit the carrier. The consequence is fail-closed (the server refuses the subscribe, 0096 §2.2), so this is a clarity gap rather than a soundness gap. Resolve: one clause in the scoping table or Option 3 placing external-bearer clients in the sessions row for lane purposes.

## Surviving-text judgement

The explicit stopping-rule answer: **the pre-v0.5 text is clean to a fifth-pass depth as pre-existing text, but this round demonstrates that "surviving" text does not stay clean passively — a revision can make old text stale, and that is where this round's MATERIAL sits.** Concretely: I re-read all 1,567 lines; personally re-verified (not re-affirmed from my family's rounds) the tree facts and corpus anchors listed in the disposition section, including a fifth independent reproduction of the baseline closure; and re-verified every citation the v0.5/v0.6 delta touches, finding all of them accurate — the delta's error rate has fallen each round (R2: one MATERIAL class across many sites; R3: one MATERIAL, four DETAILs; R4: zero false citations, one unpropagated interaction, two DETAILs). The one defect found this round lives at the *seam* between new and surviving text — the v0.6 scoping change invalidated a v0.2-era Summary sentence — which is the failure mode the capsule predicts, not evidence of an undiscovered vein of defects in untouched sections. Where a further round must look is narrow and concrete: the three reconciled passages of finding 1 (Summary constraint, corpus-answers bullet 2, F7 bullet 1), plus the two DETAIL touch-ups. I do not believe a further full reading round finds real defects elsewhere; after the finding-1 reconciliation, one delta-confined look at those passages should close the loop, and the next real information is empirical — Phase A's committed harness and the Phase C spike.

## Open questions

1. From finding 1, the substantive residue once reconciled: does the Phase C spike declare the local-dev posture (halving the contract per the scoping table) or the sessions posture (taking items 10/11 in full)? The document requires the declaration but names no default, and the byte-floor hypothesis it reports will differ materially between them — worth stating the intended first posture rather than leaving it to the spike's author.
2. Carried, still the structural ones: gate 13's thresholds must be pre-registered when Phase C is commissioned (OQ6), and OQ14's graduation-ownership decision (successor RFC vs LLP 0122 extension vs both) is the one the spike's results cannot land without.
3. Does the Related list adopt the rule "cited in body ⇒ listed, listed ⇒ cited or annotated"? Finding 2 is the second recurrence of this class in three rounds; a standing rule would stop it regressing.
4. OQ12 remains genuinely open and now interacts with the scoping table: for the sessions posture, is server tolerance of a never-ACKing client written down anywhere, and does the answer change whether item 10's "blank, resnapshot, ACK" fast path is enough for the first sessions-posture client?

## Verdict

NOT READY

## Orchestrator verification and disposition (outside the verbatim body)

All three findings verified and applied in v0.7.

- **Finding 1** — confirmed. LLP 0096 §2.2 does say an absent carrier value
  "opens a legacy connection," so a local-dev client is wire-legal without
  items 10/11 and the Summary's unconditioned inheritance claim was stale after
  v0.6. Fixed in all three places the finding names: the Summary constraint now
  separates the fence (every posture) from the obligation seam (sessions and
  hosted), the corpus-answers bullet reads "shared verbatim wherever the
  declared posture selects them," and F7 bullet 1 gained the same scoping.
- **Finding 2** — confirmed: LLP 0108 was cited in the body without appearing
  in Related, while LLP 0107 and LLP 0112 had sat in Related since v0.1 without
  ever being cited. 0108 added; 0107 and 0112 now cited where they bear
  (optimistic lifecycle in the nonclaim rules; generated query-group bundles as
  the existing precedent for Option 4).
- **Finding 3** — confirmed and applied as a paragraph placing external-bearer
  clients in the sessions row, with the two senses of "sessions" — the
  acquisition module versus the server mode — distinguished explicitly, since
  conflating them is what makes the omission tempting.


## Round 5 — 2026-08-01 (delta-confined)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, delta-confined; own-family
artifact only; no `super-refine` path; blind to the codex artifact. Asked, in
addition to the standard scope, to judge on the merits whether further review
rounds remained the right instrument.
**Instruction capsule SHA-256:** `d457e7b1e2d3c442cfc7cfe480605060b4c42d29818afe75a08e1b2628684873`
**Target:** v0.8, 1,729 lines, Draft, uncommitted working tree
**Target SHA-256:** `6a913c7cce376e0229f07e49c2584947f6ce3b675f8ad551d013427eaeb479ca`
**Repo revision at review start:** `0c0040ff` on `main`
**Tool uses:** 42
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

# LLP 0145 review — round 5 (delta-confined, independent reviewer, Claude/Fable family)

Target: `llp/0145-client-bundle-architecture.research.md`, working tree, SHA-256 `6a913c7cce376e0229f07e49c2584947f6ce3b675f8ad551d013427eaeb479ca` (verified against the capsule; the file is 1,729 lines — the capsule's "1567 lines (v0.6)" note is stale text from the prior round's capsule, and the SHA, which matches, governs; I reviewed the pinned file). Repo at `0c0040ff` on `main`. Blindness rules honored: the only file read under `llp/reviews/` was `0145-client-bundle-architecture.fable.md`; no `super-refine` path and no codex artifact was read. Approximately 34 tool uses. All paths relative to `/Users/ccheever/projects/snapback` unless absolute. Every disposition and every v0.7/v0.8 delta claim below was re-verified against the tree, not taken from the Revised header. I re-read the entire 1,729-line revision, not just the delta.

## Overall assessment

The v0.7+v0.8 consolidation is almost entirely correct, and its hardest new tree claims are exact. I verified the ones that carry weight, from scratch. Gate 12a's new instrument characterization is precisely true: the LLP 0077 matrix runner is `demos/competitive-checkpoint/tests/acceptance/hosted-sender-matrix.mjs`, a standalone Node harness importing only Node builtins plus the local `_kit/harness.mjs`, which generates its own P-256 key (`crypto.subtle.generateKey`, line 197), signs its own proofs (`signCompact`/`resourceProof`, lines 216–273), and keeps "The single mutable nonce cell" (lines 320–326) — so running it unchanged proves the server, not the client, exactly as the gate now says. Gate 11b's unsatisfiability claim is exact against LLP 0064: the seven-fact Expo `Online` receipt (llp/0064:128–137) includes fact 3 "optimistic pending followed by confirmed or rejected settlement" and fact 6 "offline retention and reconnect to authoritative rows" — both disclaimed by this profile — and 0064's only "browser" occurrence (line 123) is about stream close semantics, so "LLP 0064 defines no browser receipt at all" is true. The profile artifact's three new fields are the corpus's own receipt demands nearly verbatim ("immutable profile ID…, capability class, source/artifact digests," 0064:139–141). Gate 11d's mechanics are LLP 0059's: Web Locks preferred mutex with post-acquisition durable reload and "an in-memory capture alone cannot justify a write" (0059:1906–1908), and `compareAndCommit`'s reacquire-reload-compare-commit custody discipline (0059:1875–1885) is a fair referent for "fenced compare-and-set." OQ23's two premises both check: LLP 0053 is Accepted (llp/0053-authorization-invalidation.rfc.md:4) with "Undeclared means auth-scoped" (0053:313), and the shipped code really does gate obligation delivery on sessions mode — `authorization_invalidation_negotiated = active_mode == AuthMode::Sessions && connection_act.authorization_invalidation.is_some()` (src/server.rs:19825–19826), feeding `reproject_authorization` at :19899 and :20233. The Signal Desk relabel is honest and accurate (`demos/signal-desk/package.json:28` pins the client as `file:../../packages/snapback-client`, so the measured bytes are indeed an unrecoverable workspace state), the incident-room contrast holds (registry-pinned 0.1.8 in `demos/pocketbase-snapback-bakeoff/snapback-incident-room/package.json:18` and its lockfile), Option 2's struck-through admin rests on a true tree fact (`SnapbackClient` still carries `adminToken`, `#adminReq`, `loadSchema`, `loadFunctions` — index.mjs:1580, 4222–4223, 4689–4700), the 0115 decision-4 substance and date are right (llp/0115:484–487, 534–535), the "98%" weakening propagated to all three sites with no true content lost (60.9 vs 59.5, within 1.4 — arithmetic intact), and the v0.7 citations added for my family's round-4 finding 2 are apt: LLP 0107 is literally "React presence and optimistic lifecycle" and LLP 0112 is "Generated query-group bundle adoption."

One piece of the rebuilt per-axis text is wrong, and it is the load-bearing kind. Item 11's second bullet — "`auth/live` is owed only when the profile subscribes to **auth-scoped** live functions" — and the scoping table's matching row condition the carrier on a predicate LLP 0096 says a client cannot evaluate. §2.2's rule is that the per-subscribe/per-unsubscribe header is required on *every* sessions-mode live subscribe and unsubscribe, because "Authority independence is a compiled server fact not projected to protocol clients, so clients cannot safely branch on it; **always offering is the conformant rule**" — the server alone "may omit the requirement only for a target it proves authority-independent" (llp/0096:223–231). The document quotes §2.2's machinery in detail and dropped exactly the sentence that makes the conditioning wrong. That matters because the scoping table is the section the Summary now designates as "the authority on which items each posture takes," it is the contract the Phase C spike will be built from, and the document's own standard (stated three paragraphs later, about the external-bearer case) is that carrier omissions must be discoverable "at design time" rather than integration time. Everything else this round found is propagation residue: the gate-count sentence was not updated when v0.8 added gate 11d (it still says "eight entries… with 11a, 11b, 11c, and 12a"; the list has nine), the rebuilt hosted row's item-12 cell doesn't track the operation set the way the row's own inheritance sentence does, "LLP 0115 decision 4" is 0115's record of what that file itself attributes as "0127 decision 4," LLP 0041 became an orphaned Related entry when v0.6 removed its citation, and Option 4's pros list picked up a doubled "; and" from the v0.7 insertion. One MATERIAL in roughly 160 added-or-touched lines, everything else verified — but the bar does not grade on ratio, and this one sits in the spike's contract.

**NOT READY**

## Disposition table

Round-4 findings (my family's 1–3), each re-verified against the tree, not the Revised header:

| # | Round-4 finding | Disposition | Justification |
| --- | --- | --- | --- |
| 1 | MATERIAL — Summary and answered-questions section still asserted the universal obligation-inheritance the v0.6 scoping table withdrew (three sites) | **RESOLVED** | All three sites now posture-scoped and mutually consistent: the Summary separates the fence ("**every** posture") from the obligation seam ("under the sessions and hosted postures"), adds the load-bearing qualifier paragraph, and names the scoping table as the authority (target lines 116–131); the corpus-answers bullet reads "shared verbatim wherever the declared posture selects them — the fence in every posture, the obligation seam under sessions and hosted" (1615–1621); F7 bullet 1 reads "wherever its posture negotiates the lane at all, it must still receive and acknowledge" (497–499). The underlying dev-mode basis re-verified from scratch: 0096:535–541, 0096:570–572, and the shipped sessions gate at src/server.rs:19825–19826/:19899/:20233. |
| 2 | DETAIL — Related-list drift: LLP 0108 cited but absent; 0107/0112 listed but never cited | **RESOLVED** | 0108 now in Related (line 63) and load-bearing at 1243; 0107 cited at 470–472 for optimistic lifecycle — and LLP 0107's actual title is "React presence and optimistic lifecycle", so the citation is apt; 0112 cited at 779–781 as Option 4's precedent. The *class* recurred again in this revision with LLP 0041 — filed as new finding N5. |
| 3 | DETAIL — externally-owned-credential posture in the nonclaim rules but placed in no table | **RESOLVED** | New paragraph (1221–1231) places external-bearer clients in the sessions row, explicitly distinguishing the acquisition-module sense of "sessions" from the server-mode sense, retaining only the custody nonclaim, and stating the fail-closed direction plus the design-time-vs-integration-time rationale. Substantively correct per 0096:500. |

Persistence check of rounds 1–3 fixes through the v0.7/v0.8 rewrites: the Supabase/Convex provenance corrections and both-rows rule, F8 with the Swift counts (`wc -l` re-run: 1,138/1,450/803/141/117 = 3,649 ✓), the hosted two-referent passage, gates 11–14's round-2/3 content, Option 1's naming/seam reclassification, contract items 9–12's mechanics, LLP 0129 Phase 0 ownership, the `/micro`-not-`/online` migration correction, the Diary 0050 gzip reconciliation, and the reproducibility downgrade with Confidence "Low" are all intact. Spot re-verified fresh this round: `sideEffects` absent; `./online` and `./hosted-browser` in the export map; `online.mjs:8–12`; `hosted-browser.mjs:10`; `__snapbackHandlers` (×6); index.mjs at 10,832 lines; the fixture corpus at formatVersion 3 with 49 fixtures and zero unsubscribe ids; `exactDeploymentFunction` joining id/kind/implementationHash/**argsContractHash**/resultContractHash (react-binding.mjs:132–139); LLP 0098 Draft with "No capability is claimed by this document". I did not re-run the bundle builds: no measured number changed in v0.7/v0.8, and the tables match values independently reproduced five times across rounds 1–4.

## New findings

**1. MATERIAL — Item 11 and the scoping table condition `auth/live` on a fact LLP 0096 says clients cannot observe, and the table has no row for the tuple that misreading produces.** (§Minimal runtime contract, item 11 bullet 2, lines 1169–1172; scoping table rows at 1199–1204; echoed in the §Online profile posture table, lines 1062–1063, and the profile-artifact sentence at 1122–1124.) The bullet says "`auth/live` is owed only when the profile subscribes to **auth-scoped** live functions, and then in full," and the table's live row is named "Sessions, with auth-scoped live." But LLP 0096 §2.2 requires `x-snapback-auth-invalidation-protocol: 1` on *every* `POST /live/{name}/subscribe` and `/unsubscribe` in sessions mode, and states the governing rule the document dropped: "Authority independence is a compiled server fact not projected to protocol clients, so clients cannot safely branch on it; **always offering is the conformant rule**. The server may omit the requirement only for a target it proves authority-independent" (llp/0096:223–231, enforced by `session_live_protocol_refusal`). The same logic covers the open-time half: an offerless open is a legacy connection "ineligible for session-mode auth-scoped live work" (0096:503–505), and the client cannot know at open time that none of its future subscriptions is auth-scoped. So the correct client contract is: a sessions-mode profile that subscribes to *any* live function takes item 11's live axis; "auth-scoped" is the right conditioning only in LLP 0096 §7's *deployment-floor* context, where the server — which does know — decides whom to refuse. The document has imported the §7 floor phrase into the client-contract section, where it reverses into an instruction a reader can act on wrongly: an author whose live functions are all believed non-auth-scoped omits the carrier and namespace machinery, and has every subscribe refused with `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED` at integration time — the outcome the document's own external-bearer paragraph calls "the wrong end of the program." The failure direction is closed, so no unsoundness ships, but this is a real overstatement in the section the Summary designates as the authority. Resolve: recondition the bullet and row on "any live subscription in sessions mode," citing 0096:227–231's always-offer rule; note that the server-side omission is not a client-exercisable exemption; and either extend the same rule to generated clients or explicitly design a generation-time exception — `authorityIndependent` is a declared schema fact (0053:401), so codegen plausibly *could* know it, but that is a design decision to state, not a default to imply.

**2. DETAIL — The gate-count sentence was not updated for gate 11d.** (§Phase D, lines 1413–1414.) "Four more gate families — eight entries, 11 through 14 with 11a, 11b, 11c, and 12a — close it," but the list that follows has nine entries: 11, 11a, 11b, 11c, **11d**, 12, 12a, 13, 14. Third recurrence of the renumbering class. "Families" is still four.

**3. DETAIL — The hosted row's item-12 cell contradicts the row's own inheritance rule.** (Scoping table, lines 1199–1207.) The sessions request/response row correctly marks item 12 "n/a — no subscriptions," and the follow-on sentence says the hosted row "inherits whichever sessions row matches its operation set" — but the hosted row's item-12 cell reads a flat "required." Vacuous rather than false, but the table was rebuilt in v0.8 precisely to be per-axis-exact.

**4. DETAIL — "LLP 0115 decision 4" is 0115's *record* of what that document itself attributes as "0127 decision 4."** (Option 2 line 672; Option 6 line 842; §Phase B line 1326; OQ18 line 1677.) LLP 0115 reads "Resolved (**0127 decision 4**, 2026-07-30)" (llp/0115:484–487). The substance, date, and quotation in 0143 are all correct, but amendment authority matters for OQ18.

**5. DETAIL — Related-list drift recurred a third time: LLP 0041 is now listed but cited nowhere.** The citation inventory shows exactly one occurrence — the Related list itself. It was added by my family's round-3 finding 4 because Phase B then routed the admin decision "to LLP 0041/0115"; v0.6's reroute removed that citation and stranded the entry.

**6. DETAIL — Two mechanical nits from the v0.7 insertions.** (a) Option 4's pros list has consecutive "; and" items (lines 777–781). (b) In Related, LLP 0133 sits between 0112 and 0114, out of numeric order.

**7. DETAIL — OQ23's "carves out no mode" premise should cite the one place LLP 0053 does acknowledge dev paths.** 0053:1169–1171 states that the `clear_retained` boolean is "a versioned compatibility projection for **dev/authority-independent paths**, never a session-mode security carrier," which shows the Accepted text anticipated dev paths receiving a projection rather than the security machinery. That is evidence a resolver of OQ23 will want, and it leans toward the shipped sessions-gating being intended rather than drift.

## Surviving-text judgement

The explicit stopping-rule answer: **the pre-v0.7 text is clean to a sixth-pass depth, and for the third consecutive round the only real defect sits in text the latest revision itself rewrote.** I re-read all 1,729 lines; the sections v0.7/v0.8 did not touch re-read consistent, their measured rows match the values reproduced five times in prior rounds, and the fresh spot-verifications I ran this round on surviving anchors all held. I do not believe a further full reading round finds real defects in the untouched text.

The capsule asks for one judgement specifically, and here it is, on the merits. Yes — what review is still finding is dominated by propagation failure: findings 2–6 are exactly that class. The one MATERIAL is subtler but related: not a false claim about the tree, but a correct-context phrase (§7's floor conditioning) transplanted during a correctness rebuild into a context (the client carrier contract) where the governing document states the opposite rule — the "weakening can itself introduce error" failure the capsule names. The round-over-round trend is monotone: R2 one MATERIAL class across many sites; R3 one MATERIAL, four DETAILs; R4 one MATERIAL, two DETAILs; R5 one MATERIAL whose blast radius is a few lines, plus residue. Each MATERIAL since R3 has been introduced by the revision under review, not discovered in stable text.

My view on the instrument: **review has exhausted the stock of defects and is now working off the flow — it catches what each revision introduces, and nothing else, because there is nothing else left of the kind reading can find.** The residual first-order risks are all explicitly named and are empirically shaped: whether 10–25 kB gzip is reachable (only the Phase C spike answers it), the reconnect/operational cost and gate-13 thresholds (only measurement answers them), the comparative table's receipt status (only Phase A's committed harness retires it), the class-minting problem for gate 11b and the browser receipt facts (author/0064 work, correctly recorded as unsatisfiable-until-minted rather than papered over), and the OQ23 spec/code drift (a reconciliation decision, now with the finding-7 evidence pointer). Those cannot be retired by another reading, and pretending otherwise would be review theater. Therefore: fix finding 1 and the DETAILs, take **one delta-confined verification look at exactly those passages**, and then stop the loop and commission Phase A. I am not softening finding 1 to reach that signal: the scoping table is the contract the spike will be built from, and it must be right *before* the empirical program starts, precisely because that program is where the remaining risk now lives. But the fix is a few clauses, and after it, another full round would be re-reading clean text while the actual uncertainty sits in unrun code.

## Open questions

1. From finding 1, the design residue once the conditioning is fixed: may a *generated* client use build-time knowledge of declared `authorityIndependent` targets (0053:401) to omit the live carrier for them, given 0096 reserves the omission to targets the *server* proves independent (0096:229–231) — or do generated clients follow the always-offer rule like every other protocol client?
2. Carried and still structural: which posture the Phase C spike declares by default; gate 13's pre-registered thresholds at commissioning (OQ6); and OQ14's graduation-ownership decision.
3. Finding 4's authority question: is a change to decision 4 an amendment under the 0127 program's decision sequence or an 0115 execution detail?
4. Does the Related list adopt "listed ⇒ cited or annotated" as a standing rule? Finding 5 is the third recurrence in three revisions.
5. For OQ23: does the reconciliation go to LLP 0053 or to LLP 0096 — and does the answer arrive before or after the first spike fixes its local-dev byte floor?

## Verdict

NOT READY

## Orchestrator verification and disposition (outside the verbatim body)

The MATERIAL and all six DETAILs verified and applied in v0.9.

- **Finding 1** — confirmed verbatim at `llp/0096:223–231`: "Authority
  independence is a compiled server fact not projected to protocol clients, so
  clients cannot safely branch on it; always offering is the conformant rule.
  The server may omit the requirement only for a target it proves
  authority-independent." The orchestrator had imported §7's deployment-floor
  phrasing into the client contract while fixing the *previous* round's carrier
  finding — the third consecutive round in which the MATERIAL was introduced by
  the fix pass rather than found in stable text. Item 11, the scoping table,
  and the posture table are reconditioned on *any* live subscription, and OQ24
  now carries the codegen question this finding raised.
- **Findings 2–7** — all confirmed and applied: gate count corrected to nine
  entries, hosted release cell made inheriting, admin decision reattributed as
  "0127 decision 4, recorded in LLP 0115", LLP 0041 cited in Option 6 rather
  than orphaned, Related reordered, and the `clear_retained` dev-path
  projection added to the OQ23 caveat as evidence the shipped gating may be
  intended rather than drift.

**On the instrument judgement.** Recorded and acted on. The Codex family
reached the same conclusion independently in the same round, and additionally
found two defects it classified as *not* propagation failures — an
admission/invocation TOCTOU and a gate naming lifecycle coverage its instrument
lacks. Both verified; both fixed in v1.0. Round 6 is therefore scoped as the
single frozen consistency pass both families asked for, with the target held
immutable for its duration.


## Round 6 — 2026-08-01 (frozen consistency pass)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context; own-family artifact only; no
`super-refine` path; blind to the codex artifact, which was reviewing the same
frozen revision concurrently.
**Instruction capsule SHA-256:** `00df97af10636ebbce6c9afe939221ab88b3039115ab1589e47563f386d8f562`
**Target:** v1.0, 1,887 lines, pinned as `llp/0143-client-bundle-architecture.research.md`
**Target SHA-256:** `37592dcc882407a24d1a71c240587282048732bb83a5c56b4c12c5940b8b34fe`
**Repo revision at review start:** `0c0040ff` on `main`
**Tool uses:** 44
**Status:** completed
**Verdict:** READY

**Process event, and how this reviewer handled it.** The same concurrent
renumber that disrupted the codex run hit this one. Rather than abort or
hand-wave, the reviewer bounded the delta byte-exactly: reversing the title,
deleting the one inserted renumber `Revised` line, and reverting two
`reviews/0145-*` path strings reproduces the pinned hash. **The orchestrator
independently re-ran that reconstruction and it matches
`37592dcc…8b34fe` exactly.** Every substantive line reviewed is byte-identical
to what is committed as LLP 0145; the freeze broke in path and number only.
This review therefore applies verbatim to the 0145 file.

## Verbatim review

# LLP 0143 review — round 6 (frozen consistency pass, independent reviewer, Claude/Fable family)

Target: the revision pinned by the capsule as `llp/0143-client-bundle-architecture.research.md`, SHA-256 `37592dcc882407a24d1a71c240587282048732bb83a5c56b4c12c5940b8b34fe`, 1887 lines, verified at review start and read in full from that verified state. Repo at `0c0040ff` on `main`. Blindness rules honored: the only file read under `llp/reviews/` was my own family's artifact; no `super-refine` path and no codex artifact was read.

**Process event the capsule requires me to report: the pinned path no longer exists, and the end-of-review hash does not match — but the content freeze held.** During this review a concurrent session renumbered the document to `llp/0145-client-bundle-architecture.research.md` (now 1888 lines, SHA-256 `3cd1c3b444aac92cf3e5df506eb738491c7aaaae24e138581ec6203bcea67535`), because main had independently assigned LLP 0143 to the Expo push-notification seam RFC; both review artifacts were renamed and the root explainer's index was updated. I bounded the delta byte-exactly: reversing the title, deleting the one inserted renumber Revised line (line 8), and reverting the two `reviews/0145-*`→`reviews/0143-*` path strings reproduces the pinned hash exactly. Every substantive line of the revision under review is therefore byte-identical to what I reviewed; the freeze was broken in path and number only, not in content. This review applies verbatim to the 0145 file. Line numbers below are pinned-revision lines; for the current 0145 file add 1 to any line ≥ 8. The renumber leaves one stale self-reference inside the document, filed as N8.

## Overall assessment

The v0.9+v1.0 delta is the cleanest this document has received, and — for the first time since round 2 — the revision under review introduced no MATERIAL defect. I verified the hard new claims from scratch rather than from my family's prior authority.

The two round-5 mechanism corrections are accurate against the tree on every limb. The TOCTOU passage's premises all hold: generated references really carry the full identity tuple (`demos/signal-desk/snapback/generated/api.mjs:40-52`); invocation really reduces to the name alone (published 0.1.8 at `.../node_modules/@expo/snapback-client/index.mjs:10608-10609`); the server really dispatches by path name (`src/server.rs:10124-10128`); admission really is a client-side tuple comparison (`react-binding.mjs:132-139`); and LLP 0094:21 confirms "no expected-operation wire". The passage neither overclaims nor underclaims: it asserts no mechanism exists today, requires the successor RFC to pick one of three, keeps admission's present value, and gate 11c's mandated rollout-interleaving negatives would refuse even a wrongly-built implementation of the lease option. Gate 12a now describes its instrument exactly: the runner pins `EXPECTED_CHECKS = 43` (`demos/competitive-checkpoint/tests/acceptance/hosted-sender-matrix.mjs:130`) and contains zero refresh, logout, or key-loss checks, while LLP 0077's Acceptance separately requires precisely the four legs the gate now demands as extensions (0077:1247-1251).

The other v1.0 structural changes verify too. The three-predicate table says something true in every row: the always-offer inversion is verbatim LLP 0096 (0096:228-231, corroborated at :503); item 10's selective-delivery predicate is grounded (0053:312-313, :2259); `auth/rr` is per-request (0096:172); dev mode claims no profile (0096 §4.1). The two new artifact fields are corpus-grounded: `authProfileSet` matches LLP 0096's machine claim literally (0096:577, :114-119), and `custodyOwner`'s justification is tree-true — `createExternalSessionClient` is documented as "the explicit non-custodial protocol client seam" and throws when combined with `authCoordinator`/`agentAuthority`/`senderConstrained` (`packages/snapback-client/index.mjs:1497-1514`). The gate-11d custody rescoping is consistent with §F7 at every site I checked. The corrected browser default is code-exact (`rqs-store-default.mjs:61-65, 94-97`). The dev-obligation "as the code behaves today" qualifier is present in both categorical sites, and the decision-4 attribution is verbatim (llp/0115:484-485).

What this pass found is residue, all DETAIL-grade. None of these states a false load-bearing claim, changes a contract row, alters a gate's substance, or moves any decision the document recommends. They are a single close-out edit, not a review round.

**READY**

## Disposition table

| # | Round-5 finding | Disposition | Justification |
| --- | --- | --- | --- |
| 1 | MATERIAL — `auth/live` conditioned on "auth-scoped" (four sites) | **PARTIALLY RESOLVED** (residue DETAIL-grade) | Three of four sites fixed and verified: item 11 bullet 2 states the inverted rule with the governing quote (0096:228-231); the posture table reads "if it subscribes to any live function"; the scoping table is rebuilt on three predicates with the new all-authority-independent row still offering the carrier; OQ24 carries the codegen question. Residue: the profile-artifact sentence still teaches "an auth-scoped live subscription requires `auth/live`" — true as an implication, but the disavowed conditioning at the artifact's generation-time teaching surface. |
| 2 | DETAIL — gate-count not updated for 11d | **RESOLVED** | "nine entries, 11 through 14 with 11a, 11b, 11c, 11d, and 12a"; the list has exactly nine. |
| 3 | DETAIL — hosted row's item-12 cell contradicted its inheritance rule | **RESOLVED** | Reads "as its sessions row" in both cells, with "it is not automatically the live row". |
| 4 | DETAIL — "LLP 0115 decision 4" attribution (four sites) | **RESOLVED** | All four read "0127 decision 4, recorded in LLP 0115"; verified against llp/0115:484-485. |
| 5 | DETAIL — LLP 0041 orphaned in Related | **RESOLVED** | Cited load-bearing in Option 6 and OQ18. |
| 6 | DETAIL — two mechanical nits | **PARTIALLY RESOLVED** | Related is now numerically ordered; the Option 4 conjunction fix removed the wrong one. Cosmetic. |
| 7 | DETAIL — OQ23 should cite the `clear_retained` dev-path projection | **RESOLVED** | Quote and leans-toward-intended framing present; verified at llp/0053:1168-1170. |

## New findings

No BLOCKING or MATERIAL. Eight DETAILs and one verification note: an orphaned empty table header the v1.0 rebuild left above the new scoping table (N1); OQ22 still speaking the v0.8 framing gate 11b withdrew (N2); gate 12's "exactly the three" attribution imprecise for subscription establishment, which comes from the fence enumeration rather than the two-context acceptance (N3); the Revised header out of chronological order (N4); row 4's byte-saving claim stated unconditionally on knowledge OQ24 leaves open (N5); "all of which the corpus already requires" over-covering `custodyOwner`, which this document's gate 11d requires rather than the corpus (N6); OQ20 not updated to the three-mechanism menu (N7); OQ14's bare "0143" self-reference now pointing at the Expo push RFC after the renumber (N8); and a verification note that F2's line-count referent is rotting under the shared worktree — true of the published 0.1.8 artifact (10,832) but the workspace copy has grown to 11,174 under concurrent sessions (N9).

## Stopping judgement

The capsule's question: is this revision there? **Yes. READY, said plainly.**

Three grounds. First, the round-over-round trend completed: R2 through R5 each found one MATERIAL introduced by the revision under review; this round found none. Second, everything this pass found is DETAIL — none states a false load-bearing claim or changes what the document decides, gates, or recommends; all of it is a single close-out edit pass needing no further review round. Third, the remaining first-order uncertainty is exactly the kind that marks the loop's natural limit, and the document names each piece honestly: whether 10-25 kB gzip is reachable (Phase C), the gate-13 thresholds (measurement), the comparative table's receipt status (Phase A's harness), gate 11b's class-minting, the OQ23 dev-mode reconciliation, and the OQ24 codegen decision. Another reading round would re-read clean text while the actual risk sits in unrun code.

I am not softening anything to reach this signal: the R5-1 residue is the remnant of a MATERIAL and I checked hard whether it could re-create the original failure. It cannot on its own — one illustrative clause against three corrected normative sites, an explicit "a v0.8 draft got this backwards" warning, and OQ24 carrying the generation-time question — but it must be in the close-out edit. Recommendation: apply both families' round-6 DETAILs in one pass, without re-review, and commission Phase A.

## Open questions

1. Renumber follow-through: fix OQ14's "0143" self-reference (N8); confirm nothing else in the corpus still cites "LLP 0143" meaning this research.
2. Does the author accept the close-out shape — one edit pass applying both families' round-6 findings, no further review round — landing together with the Phase A commissioning?
3. Carried author decisions the spike cannot start without: the declared posture for Phase C; gate 13's pre-registered thresholds (OQ6); OQ14's graduation ownership; and OQ24's codegen-branching decision, which N5 makes slightly more pressing.
4. Does F2's line-count sentence get pinned to the published 0.1.8 artifact (N9)?

## Verdict

READY

## Orchestrator verification and disposition (outside the verbatim body)

The byte-exact renumber reconstruction was independently re-run by the
orchestrator and matches `37592dcc…8b34fe`. All eight DETAILs and the
verification note applied in v1.1, together with the codex family's findings.

- **N1, N4** — orphan table header deleted; Revised entries reordered
  chronologically with the renumber note last.
- **N2, N7** — the two open-question echoes. Both families found these
  independently in the same round; the codex family rated them MATERIAL. OQ22's
  spike-own-carrier exception deleted outright; OQ20 recast around the three
  atomic mechanisms with admission-alone explicitly excluded.
- **N3** — attribution corrected to "LLP 0059's fence enumeration and
  two-context acceptance," with a parenthetical noting subscription fencing
  comes from the enumeration. The codex family found the same imprecision.
- **N5** — row 4's closure omission now conditioned on OQ24, with the
  stale-declaration drift case and its OQ12 landing named.
- **N6** — softened to "four of which the corpus already requires… and the
  fifth of which this document's own gate 11d does."
- **N8** — repaired; the renumbering session had updated the title, artifact
  paths, and root explainer but missed this body self-reference.
- **N9** — F2 now pins its line count to the published 0.1.8 artifact and
  states explicitly that the workspace copy is not the referent. This is a
  durable fix for a shared-worktree hazard, not a one-off correction.
- **R5-1 residue** — the profile-artifact teaching example moved off the
  disavowed auth-scoped conditioning to the always-offer rule.

**Method note worth preserving.** Asked to report a broken freeze, this
reviewer neither aborted nor waved it through: it reconstructed the pinned
revision byte-exactly and proved the break was confined to path and number.
That is the right response to mid-review drift in a shared checkout, and it is
what made this round's verdict usable at all.
