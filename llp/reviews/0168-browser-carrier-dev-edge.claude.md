# LLP 0168 + 0169 cluster review — claude family

**Targets:** `llp/0168-browser-carrier-dev-edge.research.md`, `llp/0169-insecure-context-store-diagnostic.spec.md`
**Reviewed revisions:** 0168 `dc5d70a1…`, 0169 `ec5ae251…`
**Capsule sha256:** `a59f0999dbbd3954…`
**Runner:** claude -p --model claude-opus-5 (fresh process, cwd /tmp)
**Independence:** BLIND — did not author either document

---

## Round 1 (lockstep cluster) — 2026-08-04

## What I checked against

Beyond the pasted excerpts, I verified claims against a live checkout at `/private/tmp/snapback-ship-trackb-20260804-integration` (`packages/snapback-client/rqs-store-default.mjs`, `packages/snapback-client/index.mjs`, `src/server.rs`). Facts (a)–(d) all hold: `NavigatorLocks` is `[SecureContext]`; the browser arm is gated on `hasIndexedDb && hasWebLocks`; `resolve_profile` matches the pasted source exactly (bind-derived default, exact `dev|demo|test|prod`, any other non-empty value → `Prod`); `local_dev_cors` reflects loopback origins plus a leased console-reachability origin, matching the receipt's CORS rows. 0169's S2 secure-random ordering is also **correct** — `memoryFallback` catches `SNAPBACK_RQS_STORE_RANDOM_UNAVAILABLE` and returns `unavailableFallback('secure-random-unavailable')` — so acceptance item 8 is testable as written.

## What is good

- The two-axis framing (cross-origin admission vs. secure context) is the correct decomposition, and the receipt is a genuinely controlled comparison — one variable, same moment. Its honest caveats (one browser, one machine; the binding-mismatch note explained rather than hidden) are the right shape.
- 0168's residue analysis is the strongest part: distinguishing a bare-bundler tunnel from a tunnel fronting a route-composing relay kills the "just subtract a tunnel" move, and the DNS-01 row makes the certificate inventory complete without paving a path.
- The "bind is not exposure" chain, and the refusal to repair it with forwarding headers, is right and well-sourced against LLP 0060.
- 0169's S1 refusals are the best-designed part of either document. Refusing to diagnose IndexedDB-absent, and refusing to diagnose Web-Locks-absent-in-a-secure-context, both avoid remedies that wouldn't work. The `isSecureContext` non-boolean guard correctly excludes non-browser hosts, and S1's condition 5 does real work: an Electron renderer with `process.versions.node` reaches the Node arm, not the terminal fallback.
- S4's unchanged-list and the "a unit test that only mocks those facts is necessary but not sufficient" clause are exactly the right acceptance instincts.
- The split itself is sound. 0169 does not depend on 0168 for anything load-bearing.

## Concerns

**1. [MATERIAL] [0169] — S3 (and Acceptance 9–10): the dev-build predicate is silent on Vite, and diverges from the package's own precedent.**
S3 makes "positively identified development build" an exhaustive two-signal list and adds a `MUST NOT` for everything else. Under Vite — one of the two first-class carriers — neither signal is present at runtime: Vite does not define `__DEV__`, and `globalThis.process` is undefined in the browser. The `globalThis.` prefix, chosen for safety, is specifically what defeats the bundler substitution that would otherwise rescue the check: esbuild/Vite `define` keys match the expression `process.env.NODE_ENV`, not `globalThis.process.env.NODE_ENV`. (The package's existing `env()` helper has the same shape and is likewise inert in browsers.) So on a Vite app served over LAN HTTP, S1 fires, the store is memory, and the warning never emits — and Acceptance 10 certifies that silence as correct. The structured reason still works, so the feature isn't dead, but the human-visible half is.
Separately, this contradicts in-repo precedent for the same class of event: the §0B.6 wire-version downgrade is emitted through `record → optional injected sink → console.warn`, **un-gated**, on the stated rationale that "a downgrade is never silent" (`packages/snapback-client/index.mjs:1846`, `:3595`). A store downgrade to volatile memory is the same class, and LLP 0008 DK-9 — cited by both documents — requires the degradation mode to be reported.
*Fix:* preferred — drop the dev-mode heuristic and adopt the established shape (record on the client, optional `onRqsStoreDiagnostic` sink, default `console.warn` once), which also answers S5's "not a substitute for an in-app fact on a remote device" without defining a general diagnostic API. Minimum — add `import.meta.env?.DEV === true` and a `typeof`-guarded bare `process.env.NODE_ENV === 'development'` to the signal list, and add a Vite-realm acceptance case.

**2. [MATERIAL] [0168] — "Go/no-go gate": items 3, 5, 6, and 7 cannot be satisfied before the RFC they gate.**
The gate says an RFC "should not be opened until all of the following are present," then requires an access-capability proof across navigation/assets/HMR/upgrades, an implemented and fail-closed LLP 0030 artifact with digest handshake, proxy compatibility "through the exact integrated topology," and security tests covering "a LAN edge to a loopback server" and "a credentialed-but-noncompliant local front." None of that exists without building an edge. The next sentence then forbids exactly that: "implementation work should stop at LLP 0169 and at documentation/proofs for the cheaper paths." As decided, the gate is unopenable — which reads less like a bar and more like a permanent no wearing a checklist.
*Fix:* split into (a) preconditions to **open** an RFC — demand evidence, the auth-boundary answer with an explicit local-process threat model, one named hostname/certificate strategy — and (b) conditions the RFC must satisfy **before acceptance**: capability proof, proxy compatibility, stable-origin proof, targeted security tests. Then authorize a time-boxed, explicitly fenced spike (not default, not shipped, not documented as a path) as the only way to produce the (b) evidence.

**3. [MATERIAL] [0168] — "What is established" vs. "Confidence and deliberately open questions": the document contradicts itself on whether a raw receipt exists.**
The finding table announces "A machine-readable receipt is now retained at `demos/warble/evidence/insecure-context-origin-comparison.json`." The prose immediately below says "the repository retains prose and reviews, not the raw capture," and the confidence section rates the recommendation medium partly because "the Warble browser measurement lacks a raw retained receipt." One of these is false, and the false one is load-bearing for a go/no-go reader's assessment of evidence strength.
*Fix:* keep the receipt statement; restate the residual weakness as what it actually is — one machine, one Chrome version, Safari/Firefox by specification inference — and re-derive the medium confidence from unmeasured carrier demand alone.

**4. [MATERIAL] [0168] — Security findings / Round-3 disposition #1 / two-axis table: a present-tense exposure is dispositioned into a hypothetical.**
Disposition #1 files "a direct tunnel to the loopback server bypasses the loopback-direct exemption" as *deferred as an authorization precondition*. But that finding is about the server shipping today, not about an edge: `ngrok http 4420` against a loopback-bound Snapback server yields a publicly reachable server that is still in the bind-derived `dev` profile — which the source comment describes as granting "the destructive/provisioning capability" — and whose peer is indistinguishable from a local process. Parking it behind a gate that forbids opening the successor RFC means the live finding has no owner and no tracked resolution. Compounding this, the two-axis table's only double-✓ rows are tunnel rows; the residue column marks them unapproved but never gives the reader the mitigation available *today*.
*Fix:* (a) route the finding to a present-tense owner — an LLP 0060 amendment or a server-side issue with a handle — rather than to a deferred RFC, or state explicitly why current exposure is accepted (operator-initiated, undocumented as a path); (b) add one sentence to the tunnel rows: anyone tunnelling today should set `SNAPBACK_PROFILE` explicitly to a non-`dev` value, because the loopback default survives the tunnel and grants destructive/provisioning capability.

**5. [MATERIAL] [0168] — "The LLP 0030 policy-sharing contract": a Research document binding another owner's implementation.**
"Research question and authority" asserts this document "changes no route, profile, auth, packaging, or client behavior" and that LLP 0030 remains authoritative. The contract section then fixes five requirements on LLP 0030's implementation — a checked-in versioned generated artifact, byte-identical Rust/JS consumption, shipped canonicalization rules and adversarial vectors, a readiness digest handshake that refuses before the first proxied request — and directs that "LLP 0030 must be amended." That is new, unaccepted implementation work created for an owner who is not the author of this document, inside the one document whose thesis is that nothing is being decided. It is also redundant: gate item 5 already states the same requirement in the correct register.
*Fix:* demote the section to a **finding plus successor constraint** ("any topology that shares route-admission policy must satisfy…"), delete the "fixed here" framing, and make the 0030 amendment a precondition inside gate item 5 rather than an instruction issued here.

**6. [DETAIL] [0169] — S1 / S3 fourth bullet: the diagnosis is causally wrong when Web Locks is simply unimplemented.**
S1 correctly refuses the secure-context-with-no-locks case, but the mirror case — a browser that has never implemented Web Locks, on an insecure origin — matches S1 and gets told that HTTPS or localhost "satisfies the secure-context requirement." Moving to HTTPS would not restore durability there. The conflation is unavoidable from inside an insecure context (there is no feature-detect that distinguishes gated-out from unimplemented), so the decision is fine; the mandated wording is not.
*Fix:* make S3's fourth bullet conditional — HTTPS or a loopback origin restores Web Locks *on browsers that implement it* — and note in S1 that this residual conflation is accepted and why.

**7. [DETAIL] [0169] — S3: "exactly once per JavaScript realm" is not what the obvious implementation gives.**
A module-scoped flag dedupes per *module instance*. Dual ESM/CJS resolution or two copies in `node_modules` yields two warnings while satisfying Acceptance 9, which only tests two clients in one realm.
*Fix:* either specify a realm-level guard (a `Symbol.for()` key on `globalThis`) or relax the text to "once per loaded package instance" and say so.

**8. [DETAIL] [0169] — Acceptance, final paragraph: the browser acceptance MUST has no environment escape.**
"At least one browser acceptance must load an ordinary HTTP non-loopback origin" is right in spirit, but note `127.0.0.2` is still loopback and still a secure context, so this needs a real non-loopback interface. On a host or CI runner without one, the suite has no defined behavior and will simply be red.
*Fix:* define the gating — required where a non-loopback interface exists, otherwise a recorded skip with a reason string, plus a stated cadence for refreshing the manual receipt.

**9. [DETAIL] [0168] — Go/no-go gate item 1: no bar and no decider.**
Items 2–7 are checkable; item 1 ("a real workflow requires remote browser HMR… names the carrier and frequency") has no threshold and names nobody who judges it. The gate also has no expiry or revisit trigger, so "no on this record" has no defined path back to the question other than someone deciding to try again.
*Fix:* state a minimal bar (e.g. N distinct reported workflows naming carrier and frequency, or one named committed consumer accepting the security cost), name the role that rules on it, and add a revisit date.

**10. [DETAIL] [BOTH] — 0168 authority section and cross-references.**
Three small couplings: (a) LLP 0166 is in Related and 0169 names it the owner of "the broader carrier/profile matrix," yet 0168's authority list omits it while building a carrier comparison table — state the boundary. (b) 0168's evidence row quotes `reason: 'no-durable-backend'`, which 0169 will replace for exactly that observation; mark the quoted value as pre-0169. (c) "implementation work should stop at LLP 0169" reads as though this Research authorizes 0169's implementation; 0169 is Draft and stands on its own acceptance — reword to "goes no further than what LLP 0169 authorizes on its own."

## Answers to the framing questions

**Is the split correct?** Yes, with concern 5 as the exception. 0169 is genuinely implementable from its own text — the source path, the exact info object, the predicate, and the refusals are all present, and its one reference to 0168 is decorative. 0168 is genuinely Research everywhere except the 0030 contract section, which is the single place it wears a proposal.

**Is 0168's deferral honest or avoidance?** The deferral of the three security questions is the right call — nothing is being authorized, and choosing a credential or capability design now would manufacture exactly the paper decision the prior three rounds kept puncturing. The avoidance is narrower and specific: disposition #1 defers a finding about the *current* server as though it were a finding about a *future* edge (concern 4), and the gate's structure makes the deferral effectively permanent (concern 2).

**Is S1 exactly right?** The five conditions are right, including condition 5, which correctly excludes the Electron-renderer path that would otherwise be misclassified. The refusals are right. The one gap is the unimplemented-Web-Locks conflation (concern 6), which is a wording fix, not a predicate fix. The acceptance section is close to sufficient — items 1–11 cover the ladder — but it cannot verify the S3 warning on the carrier where S3 most likely fails (concern 1).

0168: NOT READY
0169: NOT READY
SET: NOT READY

---

## Round 2 (delta) — 2026-08-04

**Reviewed revisions:** 0168 `5fc28d78…`, 0169 `50bb6302…`
**Capsule sha256:** `fcc9d965b613a149…`

## Concerns

**1. `[IN-DELTA] [MATERIAL] [0168]` — §The two-axis comparison, "Mitigation available today" paragraph: the advice can be followed literally and be a no-op.**
The paragraph says "set `SNAPBACK_PROFILE` explicitly" without naming a value. Per the included `resolve_profile`, `Some("dev") => ServerProfile::Dev` — an explicit `dev` is byte-identical in effect to the bind-derived default it is supposed to mitigate. A developer tunnelling a *dev* server will naturally set `SNAPBACK_PROFILE=dev`, believe they have applied the document's only today-actionable security mitigation, and remain in exactly the state the paragraph describes as granting "the destructive/provisioning capability to whoever reaches the public URL." The same wording appears in the filed issue's Direction 1, so the defect propagates.
*Fix:* name the value and the mechanism — "set `SNAPBACK_PROFILE` to `prod` (or `demo`/`test`) before exposing the server through a tunnel. Setting it to `dev` is not a mitigation: an explicit `dev` resolves to the same capability grant as the loopback default. Note that the fail-closed arm helps here — any unrecognized non-empty value resolves to `Prod` — so `dev` is the only explicit value that preserves the exposure." Mirror this into the issue.

**2. `[IN-DELTA] [MATERIAL] [0168]` — §How B-evidence may be produced: the spike authorization carries no exposure constraint, in a document whose central finding is that exposure is undetectable.**
The fence is stated as "not enabled by default, not published as a supported path, not documented in the guide, and removed or superseded when the RFC is decided." Every clause governs *distribution*; none governs *reachability*. Meanwhile B4 requires the spike to exercise "a LAN edge to a loopback server; a tunnel to a loopback edge; a direct tunnel to the loopback server" — i.e. the spike's job is to stand up publicly reachable dev servers, each of which inherits the bind-derived `dev` profile per concern 1 and the filed issue. "Time-boxed" also has no box: no duration, no owner, and "removed when the RFC is decided" has no fallback if the RFC is never decided.
*Fix:* add to the spike clause: (a) a named time box and a named owner; (b) a requirement that any spike run that is reachable off-loopback set `SNAPBACK_PROFILE` to a non-`dev` value, with B4's negative tests run under that setting; (c) a requirement that the spike branch not merge to the default branch, or that it carry an explicit opt-in flag defaulting off; (d) an expiry action if the RFC is undecided at the box's end (delete, not extend by default).

**3. `[IN-DELTA] [DETAIL] [0168]` — Summary vs §How B-evidence may be produced.**
"This document does **not** propose or authorize a dev edge" is contradicted on its face by "producing them is authorized as a **time-boxed, explicitly fenced spike**." The gate text resolves it (spike requires an open RFC under section A), but a skimming implementer reaches the authorization without the precondition.
*Fix:* qualify the Summary sentence — "does not authorize a dev edge or any edge implementation outside the fenced spike defined in the gate, which itself requires an open RFC."

**4. `[IN-DELTA] [DETAIL] [0168]` — §Finding: shared route-admission policy: the section denies doing what B5 does.**
The closing sentence says amending LLP 0030 is "part of that RFC's acceptance, **not an instruction issued by this document**," but B5 is an instruction issued by this document ("with LLP 0030 amended so owner and generated output land together"). The demotion to a finding is the right move and the gate is within this Research's stated authority; only the disclaimer overreaches. The five numbered items also remain in flat normative voice ("Consumers advertise artifact version and digest in readiness"), which reads as requirements on LLP 0031/readiness surfaces.
*Fix:* replace the disclaimer with what is actually true — "B5 makes this a condition of *edge acceptance*; it places no obligation on LLP 0030's owner absent an edge." Recast items 1–5 in the conditional voice used in the section header ("a successor that shares this policy must…").

**5. `[IN-DELTA] [DETAIL] [0168]` — A2 vs §Security findings: what counts as a paper answer is under-specified.**
A2 accepts "prose … it must be falsifiable," but §Security findings says the same choice "changes the server's auth boundary and needs a focused RFC, **not another paragraph in an edge proposal**." As written, A2 is satisfiable by a paragraph in the edge RFC — precisely what the earlier section rejects. The gate is genuinely openable (this is a quality bar, not a deadlock), but the two sections point different directions.
*Fix:* state the sequencing in A2 — the auth-boundary answer lands in its own accepted or under-review document, and A2 is satisfied by a pointer to it, not by prose inside the edge RFC.

**6. `[IN-DELTA] [DETAIL] [0168]` — §What is established, receipt row: the receipt does not carry the field the pair turns on.**
The row claims the run observed "the memory store with `reason: 'no-durable-backend'`," but the retained receipt records only `resolvedStoreImplementation: "memory"`. The `reason` string is the exact observable LLP 0169 redefines, and it is the one fact not receipted. Attribution to the diary is fine as far as it goes, but the machine-readable artifact then cannot verify the load-bearing claim.
*Fix:* add `resolvedStoreReason` to both rows of `warble.origin-comparison.v1` (bump to `.v2` if the schema is fixed), or scope the row's `reason` clause explicitly to the diary narrative.

**7. `[PRE-EXISTING] [DETAIL] [BOTH]` — 0168's receipt row goes stale the moment 0169 lands.**
0168 states the observed reason as `no-durable-backend`; 0169 S1/S2 replace exactly that value with `insecure-context-no-web-locks` for exactly that condition. Nothing in 0168 marks the value as the pre-0169 one, so the accepted pair will read as contradictory to a later reader.
*Fix:* annotate in 0168 — "`no-durable-backend` (the generic pre-LLP-0169 value; LLP 0169 reclassifies this exact case)."

**8. `[IN-DELTA] [DETAIL] [0169]` — Acceptance item 9's parenthetical over-claims what the test proves.**
Item 9 asserts the realm with neither `__DEV__` nor `process.env.NODE_ENV` defined is "the Vite-browser shape … since a build-mode predicate would be inert exactly there." That holds for the `globalThis.`-prefixed form only. S3's own parenthetical concedes the point: `process.env.NODE_ENV` *is* a Vite `define` key, so a bare predicate is substituted at build time and would not be inert. A runtime realm with no `process` global therefore does not demonstrate that a build-mode gate fails under Vite. The un-gated decision is still right, and the stronger justification is already in the text (the §0B.6 precedent and DK-9's report-the-degradation requirement) — only the inertness argument is doing more work than it can.
*Fix:* in item 9, drop the causal clause and assert the behavior: "…no build-mode gating, asserted in a realm where neither `__DEV__` nor `process.env.NODE_ENV` is defined." In S3, lead with the precedent/DK-9 rationale and keep the Vite point as the narrower claim it is — a `globalThis.`-prefixed predicate is unrescuable by `define`, and build-mode inference is not portable across the two first-class carriers.

**9. `[PRE-EXISTING] [DETAIL] [0169]` — S2 / Acceptance 8: the `secure-random-unavailable` precedence is not evidenced on the path S1 governs.**
In the included ladder, `unavailableFallback('secure-random-unavailable')` appears only in the React Native arm and fires *before* store construction. The browser terminal path is `memoryFallback('no-durable-backend')`, and `memoryFallback`'s body is not shown. So "the existing higher-priority `secure-random-unavailable` unavailable result MUST win" is either an unstated property of `memoryFallback` or a new behavior — and if new, it contradicts S4's "unchanged" list.
*Fix:* cite the line in `memoryFallback` where the randomness check lives; if there is none on that path, say so and state explicitly whether S2 adds it (and move it out of S4's unchanged set).

**10. `[IN-DELTA] [DETAIL] [0169]` — S3 dedup and the sink interact in an unspecified way.**
"Exactly once per JavaScript realm for this reason, regardless of how many clients are constructed" plus acceptance 10's sink path means: if two clients are constructed, only the first client's sink (or `console.warn`) ever sees the event. A second client supplying an app diagnostics sink silently receives nothing — including the case where the first client had no sink and the event went only to the console. The structured path is unaffected (`rqsStoreInfo` is per-client), so this is contained, but it is not stated.
*Fix:* say which is deduplicated. Recommended: deduplicate the un-gated `console.warn` per realm, but deliver to every registered sink; add an acceptance item for two clients with two different sinks.

**11. `[PRE-EXISTING] [DETAIL] [0169]` — S3's "record the diagnostic … optional caller-supplied sink" names no surface.**
Non-goals forbid defining a general diagnostic-event API, and S3 defers to "the shape this package already uses," but neither the sink's option name nor the record's observability is given. Acceptance 10 tests a surface the Spec never names.
*Fix:* name the existing constructor option and the record surface (one line, citing the §0B.6 downgrade site), so an implementer does not invent a second mechanism.

**Verification note (not a concern):** of the source claims, only `rqs-store-default.mjs` and `resolve_profile` were included, and both check out exactly as stated — including 0168's careful "unset **or empty**" and the fail-closed-on-unknown behavior. `src/server.rs` `local_dev_cors`, LLP 0060 §D1, and the §0B.6 downgrade precedent that carries S3's argument are cited but not included here; I did not verify them.

## What is good

- The gate split works. Section A is genuinely openable: A1 (demand), A2 (paper design), A3 (named strategy) are all producible without an artifact, and the spike clause closes the remaining "you need code to get B-evidence" loop without reopening the permanent-no. The old unopenable checklist is fixed.
- Re-routing disposition #1 out of the RFC-gated deferral and into a present-tense issue is the right ownership call, and the issue is honest about not having reproduced the tunnel end to end.
- The 0030 demotion is the right shape — the constraints now bind a successor at B5 rather than issuing requirements to another owner, which is within a Research document's authority.
- 0169's S3 is implementable on both carriers as written. On Metro native it cannot fire at all (the RN arm short-circuits before S1's terminal-fallback condition); on Metro web and Vite it fires identically. The un-gated choice is the correct one, and the sink is the right escape hatch.
- The receipt's `honestCaveats` are real caveats, including the `SNAPBACK_REACT_BINDING_MISMATCH` disclosure and the reasoning for why it does not contaminate the store facts — which is consistent with the synchronous resolver in the included source.
- The two-axis framing and the "fixing CORS makes the silent failure *more* likely" conclusion are correct and well-supported by the included ladder.

0168: NOT READY
0169: READY
SET: NOT READY

Concerns 1 and 2 are the only blockers, both in 0168, both a few sentences of text. 0169 is independently shippable as it claims and does not need to wait.

---

## Round 3 (delta, final) — 2026-08-04

**Reviewed revisions:** 0168 `411c3288…`, 0169 `cc838a30…`
**Capsule sha256:** `60860245f8197b72…`

## Concerns

**1. [IN-DELTA] [MATERIAL] [0168] — §"How B-evidence may be produced": the reachability fence permits exactly the values the mitigation paragraph condemns.**
The fence requires `SNAPBACK_PROFILE` to be "a non-`dev` value." Non-`dev` includes `demo` and `test` — and two sections earlier the same document states that explicit `dev`, `demo`, and `test` *all* permit provisioning and that `prod` is the only value that fails closed. So the spike's safety control admits configurations the document has already ruled unsafe, on the runs (B4) that are deliberately reachable from the network. Note this is robust to the accuracy of the underlying claim: if demo/test do permit provisioning, the fence is holed; if they don't, the mitigation paragraph is wrong. One of the two must change.
*Fix:* fence on `SNAPBACK_PROFILE=prod` specifically, not "non-`dev`", and say why demo/test are excluded.

**2. [IN-DELTA] [MATERIAL] [0168] — same section: the fence's trigger condition is ambiguous in the direction that exempts the worst case.**
"Any spike run reachable off-loopback" has two readings: the listener binds off-loopback, or the surface is reachable by a non-local peer. B4's third case — a direct tunnel to the loopback server — is precisely the topology where the bind is loopback and the surface is public. Under the bind reading, the most dangerous test in the list escapes the fence entirely, and the fence's own stated rationale ("each inheriting the bind-derived `dev` profile") is the thing that makes the bind reading tempting.
*Fix:* define the trigger as reachability by any peer other than a local process, explicitly including through a tunnel or front, and state that the loopback bind does not satisfy the fence.

**3. [IN-DELTA] [MATERIAL] [0168] — §gate B1/B3 vs. the fence: the fence may make the positive proofs unproducible.**
B1 (capability rejection across navigation/assets/HMR/upgrades), B2, and B3 (HMR over WSS, Metro manifests "through the exact integrated topology") are proofs that the dev topology *works*. The fence forces those runs off `dev`, where the document itself says "functionality may consequently refuse." The round-1 finding was a gate that forbade producing its own evidence; the fence risks reintroducing that in a narrower form, and an implementer who hits it will be tempted to quietly drop the fence rather than the proof.
*Fix:* split the fence by test class. Positive/compatibility proofs run on a loopback-only listener reached through a non-trustworthy hostname mapped to loopback — the exact technique 0169's new acceptance constraint already establishes — which preserves `dev` semantics without network reachability. Only genuinely-remote carrier proofs (iOS Safari, second machine) run reachable, and those require `prod` plus a disposable state directory. Say this explicitly so the fence has a compliant path to every B item.

**4. [IN-DELTA] [DETAIL] [0168] — mitigation paragraph: "explicit `dev`, `demo`, and `test` all permit provisioning" is not supported by the included source.**
`resolve_profile` and its comment establish only that the *loopback default* grants the destructive/provisioning capability and that unknown values fail closed to `Prod`. Nothing shown says what Demo and Test grant. This sentence is load-bearing for both the mitigation advice and the fence.
*Fix:* cite the profile→capability table wherever it lives, or narrow the claim to what `admin.rs` shows.

**5. [IN-DELTA] [DETAIL] [0168] — mitigation paragraph: "`prod` is the only value that fails closed" is imprecise.**
Any unknown non-empty value also resolves to `Prod`. The direction is safe, so this is not a hazard, but the sentence is checkable and wrong as written.
*Fix:* "the only named value that fails closed."

**6. [IN-DELTA] [MATERIAL] [0169] — §S3 sink contract / Acceptance: the realm-once budget is undefined for mixed sink/no-sink realms.**
Client A supplies `onRqsStoreDiagnostic` (suppressing its default warn); client B, constructed later, supplies none. Does B warn? "The once-per-realm rule governs delivery of the default `console.warn` only" implies a suppressed warn is not a delivery and B warns — but the opposite reading is available, and no acceptance item distinguishes them. The consequence lands on this Spec's central purpose: under the wrong reading, any library or wrapper that installs a sink silently suppresses the human-visible warning for the whole realm, on the Vite carrier the un-gated design exists to serve.
*Fix:* one sentence — a suppressed default warn does not consume the realm-wide budget — plus acceptance item 12 asserting sink-client-then-plain-client still warns exactly once.

**7. [IN-DELTA] [DETAIL] [0169] — §S3 lead sentence vs. the new bullets.**
The lead MUST says report "exactly once per JavaScript realm ... regardless of how many clients are constructed" over the whole record→sink→warn triple; the new bullets scope that to the default warn only. The bullets win by specificity and acceptance item 10 catches a wrong implementation, so this is recoverable, but two normative statements contradict. Acceptance item 9's "exactly one report" inherits the same ambiguity.
*Fix:* scope the lead MUST to the default `console.warn`; change item 9's "report" to "`console.warn`".

**8. [PRE-EXISTING] [MATERIAL] [0169] — §S2 and acceptance item 8: the `secure-random-unavailable` precedence claim is not visible in the included ladder.**
In the source shown, `unavailableFallback('secure-random-unavailable')` occurs only in the React Native arm, guarded before file-store construction. The terminal browser/unknown-host path calls `memoryFallback('no-durable-backend')` with no randomness check in view. `memoryFallback`'s body is not included, so this is a verification flag rather than a confirmed error — but if the terminal memory path has no such check, S2's "existing higher-priority ... MUST win" describes behavior that does not exist and acceptance item 8 cannot be written against the S1 path.
*Fix:* cite the line in `memoryFallback` that performs the check, or reclassify item 8 as new required behavior rather than an existing precedence.

**9. [IN-DELTA] [DETAIL] [0169] — §Acceptance: the new test-listener constraint sits awkwardly beside the older browser-acceptance sentence.**
That sentence still says "load an ordinary HTTP non-loopback origin," which reads as a LAN bind — the thing the new constraint forbids. The constraint's technique works because potential trustworthiness is evaluated on the *hostname*, not the resolved address, but the text doesn't say so, and an implementer may conclude the two requirements conflict.
*Fix:* reword to "non-trustworthy origin," and state the hostname-not-resolved-address basis. The existing requirement to assert `isSecureContext === false` before asserting the reason already guards against a UA that disagrees; keep it.

**10. [IN-DELTA] [DETAIL] [0169] — §sink contract: surface shape parity and delivery timing.**
`client.rqsStoreDiagnostics()` is specified as a method while the cited precedent is written `wireVersionDiagnostics` (no parens); the return type (array? frozen? copy?) is unstated; and delivery timing is unstated, though "a throwing sink MUST NOT fail client construction" implies synchronous invocation inside the constructor. Also, the claim that the diagnostic shape matches "the package's existing diagnostic envelope" is unverifiable from the text.
*Fix:* match the existing accessor's form or say why it differs; state that the sink fires synchronously during construction so records are populated when the constructor returns; cite where `snapback.client-diagnostic.v1` is defined.

**11. [IN-DELTA] [DETAIL] [BOTH] — review history narrated inside normative text.**
"An earlier revision of this paragraph said…", "Round-2 review found 'record → sink → warn' underspecified…". Both documents have Provenance/disposition sections built for this. Inline, it dates the text and makes the normative content harder to extract.

**12. [PRE-EXISTING] [DETAIL] [0168] — the mitigation paragraph never says what `prod` protects.**
A reader told "`prod` fails closed" cannot size residual exposure: is app data still readable, is only provisioning gated, and does the tunnel provider terminate TLS in front of a plaintext upstream? The paragraph correctly says a profile choice does not approve exposure, but stops short of the fact that the listener and its data remain reachable by anyone with the URL.

## What is good

The mitigation paragraph's core correction is right and the honest naming of the prior no-op is worth more than a silent edit — the bind-derived `dev` default surviving a tunnel is exactly what `resolve_profile` shows. Re-routing disposition #1 to a present-tense issue rather than an RFC precondition is the correct ownership call. The A/B gate split remains the strongest structural feature of 0168, and the Summary's spike exception is genuinely non-circular: the spike requires an open RFC, which requires A1–A3 on paper only.

In 0169, the un-gated-warning argument is technically correct — a `define` key of `process.env.NODE_ENV` does not match a `globalThis.`-prefixed member expression — and the wire-version precedent is the right analogy. The top-level/insecure-ancestor caveat and the "HTTPS cannot restore an unimplemented API" clause both close real misreadings. The test-listener constraint is the best single line in either document: it prevents the test suite from teaching the habit the research is trying to stop. The sink contract is close to implementable; concern 6 is the one branch it leaves open.

No coupling contradiction found between the two documents: 0168 defers the diagnostic to 0169, 0169 disclaims dependence on the edge question, and 0168's "implementation work stops at LLP 0169" is consistent with 0169 being independently shippable.

0168: NOT READY
0169: NOT READY
SET: NOT READY
