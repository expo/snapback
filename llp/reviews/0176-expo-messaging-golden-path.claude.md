# LLP 0176-0181 review — claude family

**Targets (lockstep cluster):** `llp/0176-expo-messaging-golden-path.plan.md`,
`llp/0177-chat-aggregate-and-first-related-row-demand.research.md`,
`llp/0178-generate-time-authoring-diagnostics.rfc.md`,
`llp/0179-generated-app-descriptor-and-surfaces.rfc.md`,
`llp/0180-asset-bearing-client-commands.rfc.md`,
`llp/0181-zero-configuration-expo.rfc.md`
**Reviewed revisions (git hash-object, entering round 1):**
0176 `ab06a9169e3e77ba10de4891d275ed0edc5892f9` ·
0177 `2f0cd543af76f3a52e1369868501b98e7fb419d9` ·
0178 `603d32100a331dbe131763721325315336dbb335` ·
0179 `2ca55c3cad2545b222db835b47664e7f56847575` ·
0180 `e3ab2e50adde02bdc7dc9d5b5b3a3b6fbd7351b1` ·
0181 `409ed1e3123c10e70fd887f209b8cb00cb0adaf9`
**Prompt sha256 (instructions + capsule, identical bytes both families):**
`b626ecc9859aa860b66443cba6fb8bd75494a46b8867ea82323ad0447c0e2e71`
**Runner:** `claude -p --model claude-opus-5 --allowedTools ""`, fresh
process, cwd `/private/tmp/super-refine-run-claude` (outside the repo)
**Independence:** structural — no repo access, no tools, capsule-only stdin
**Topology:** lockstep cluster review (one capsule, all six targets, per-target
verdicts)

Note on round 1 provenance: an earlier round-1 attempt against a
prompt lacking an explicit tool/file-access prohibition produced a valid
claude-family review, but the paired gpt-5-family run under the same
conditions used its (permitted, read-only) shell access to read this
skill's own procedural definition off disk — not a target-content leak, but
a structural blindness violation. Both families were re-run against a
corrected prompt (adding an explicit no-tool-use directive) so both verdicts
in this round bind to identical, tool-restricted prompt bytes. The earlier
claude-only output is discarded and not counted.

---

## Round 1 — 2026-08-05

Reviewed from the capsule text only; no files read, no tools used.

# Findings

## MATERIAL

**1. [MATERIAL] — 0176 (G0), 0181 (§Provider, E1). The `auth.mintSession` host-op that the entire dev-authority repair rests on is not supported anywhere in the capsule.**
0176 G0 asserts as settled fact that "Host-ops already exposes `auth.mintSession`, gated behind the process-bound impersonation capability," that this is "the exact same gate `snapback assets put --user` already uses," and that a CLI wrapper over it "mints no new authority class, widens no fence." 0181's supervised bootstrap then explicitly derives its safety from that same claim ("both wrap the same already-gated `auth.mintSession` host-op"). Nothing in Part B/C establishes that this host-op exists, that its gate is process-bound rather than bearer-presentable, or that it returns a *non-admin ordinary* session rather than an impersonation token the caller then narrows. This is the load-bearing safety claim of the whole C1 repair, and it is asserted, not established, in both documents.
*Failure scenario:* if the real gate is credential-presentable rather than process-bound, `snapback session mint --dev-persona` is a documented one-liner that turns any local process (a script, a compromised dev dependency, a CI step) into a session issuer for arbitrary personas — and 0181 ships that as an automatic exchange with no author in the loop. G0's exit criterion would then have been met by widening a fence the document claims it did not touch.
*Fix:* both documents should cite the concrete host-op source and its gate mechanism, and state the negative test explicitly (a local process *without* the operator capability is refused; the returned session is provably non-admin and bounded). Until that citation exists, mark G0's primitive as blocked on a host-ops fact rather than as a mechanical repair. **I cannot verify this from the capsule and am not guessing which way it goes.**

**2. [MATERIAL] — 0176. G0's exit criterion depends on a seam 0176 itself lists as an unresolved open question, and no document owns that seam.**
G0's exit requires "a real image upload authorized by a `snapback session mint`-issued session." 0176 Open Question 3 simultaneously asks: "Which ordinary guest/dev-persona issuance seam closes C1 without coupling the stable descriptor to one development environment?" Worse, the authority table gives the seam no owner: 0176 says it does not own subsystem semantics; 0181 explicitly does *not* own "session/principal policy"; 0180 explicitly does not own "ordinary session or guest principal semantics (LLP 0055 and auth owners)"; 0179 does not own auth. So a new user-facing CLI primitive that issues sessions is introduced by a Plan that disclaims mechanism ownership, and no sibling RFC ever specifies its schema, TTL, persona admission, revocation, or negative matrix.
*Failure scenario:* G0 ships a session-issuing command with no owning document, so no review ever runs its negative matrix; 0181 then automates it under E1 on the assumption G0 settled the policy, and the first specified constraints on dev-persona issuance appear nowhere.
*Fix:* either route the primitive to the auth owner (LLP 0055/0058/0172-0173) with a named amendment, or give 0181 explicit ownership of "supervised dev-session issuance" (with a corresponding edit to its does-not-own list) and make G0's primitive an early slice of it. Close OQ3 before G0's exit is claimed.

**3. [MATERIAL] — 0176 (§Product decisions "Three deliberately separate action namespaces"), 0179 (OQ3). The Plan settles a descriptor-grammar question its own authority table says it does not own, and the owner still has it open.**
0176 states as a product decision that "A bound surface exposes: `mutations`, `commands`, and `assets`: the advanced raw asset-task surface." 0179 Open Question 3 asks: "Should raw advanced assets appear only at `app.api.assets`, or may a surface explicitly re-export a bound `assets` namespace as proposed?" 0176's table says 0176 does not own "descriptor grammar." So the Plan pre-decides the grammar question, and 0179 both admits `assets` in its `defineSurface` grammar *and* leaves its admission open in the same document.
*Failure scenario:* G2 is implemented against 0176's three-namespace decision; 0179 review later resolves OQ3 the other way (assets only at `app.api.assets`), and the surface's public shape and generated types change after a gate was already declared passed.
*Fix:* strike the `assets` clause from 0176's product decision (leaving mutations/commands, which 0179 does not question) and let 0179 close OQ3; or close OQ3 in 0179 now and have 0176 cite that resolution instead of asserting it.

**4. [MATERIAL] — 0176 (G3 exit, Integrated acceptance), 0180 (OQ3). A gate exit requires a fact the sibling RFC says may not exist.**
0176 G3's exit requires the command to "pass negative authority, retry, cancel, residue ... tests," and Integrated acceptance requires "explicit unattached/finalized residue." 0180 OQ3 asks: "Can the existing asset task prove finalized-but-unattached status directly, or must the command label it as inferred/unknown until LLP 0044 exposes an authoritative fact?" 0180's own §Failure text hedges to "unattached according to *available* authoritative facts." Nothing in the program schedules the LLP 0044 amendment that would supply an authoritative unattached fact.
*Failure scenario:* G3 is declared passed with a residue field whose value is an inference; a UI renders "your image was uploaded but not attached — safe to retry" when the asset was in fact attached by a mutation whose receipt was lost, producing a duplicate send. This is precisely the false-atomicity claim G3's exit says it forbids.
*Fix:* 0176 G3 should state the two admissible exits explicitly — either LLP 0044 exposes the authoritative fact (add it as a G3 dependency), or the residue field is typed as `inferred | unknown | authoritative` and the acceptance test asserts that the client never presents an inferred value as certain.

**5. [MATERIAL] — 0176 (G4 exit), 0181 (E1-E3), grounded against LLP 0064. Per-OS receipts are required at G4 but the only qualifying evidence path is deferred to G5 or left as an open question.**
0176 G4's exit requires "separate iOS and Android evidence under LLP 0064." The 0064 excerpt says React Native/Expo "may claim `Online` when its **device** evidence proves network-backed query, mutation, lifecycle, authority, and reconnect behavior," and that "evidence is per operating system." 0181's baseline through E2 is explicitly simulator/emulator only; real devices are E5/G5, except an "already admitted hosted HTTPS target." 0176's own OQ4 asks whether a USB/port-forward path can cover both OSes before G5 — i.e., the enabling mechanism is unresolved while G4's exit is stated unconditionally.
*Failure scenario:* G4 is declared complete on simulator/emulator receipts, and the program records a per-OS 0064 claim that 0064's own bar does not admit — exactly the "one simulator or Expo Go smoke test" claim 0181 lists as a non-goal.
*Fix:* make G4's exit conditional in 0176: "iOS and Android 0064 receipts produced via hosted-HTTPS or USB/port-forward device runs; simulator/emulator runs do not satisfy this criterion," and add the chosen path as a G4 prerequisite rather than leaving it in OQ4.

**6. [MATERIAL] — 0181 (§Provider, OQ2, §Risks). The "no bearer anywhere" security claim rests on a mechanism the same document lists as undesigned.**
0181 asserts the bootstrap exchange "is single-run/scoped/expiring, never contains admin or arbitrary impersonation power, and leaves no bearer in generated artifacts or logs," and its Risks section restates this as a mitigation. OQ2 then asks: "What local bootstrap exchange delivers the ordinary dev-persona session without placing it in `AppBinding`, bundle source, logs, or persistent public configuration?" The property is claimed as a design outcome while the design that would produce it is open. E1 delivery is nonetheless scheduled on it.
*Failure scenario:* the first working implementation delivers the session via the simplest available Expo channel (a Metro-served config value, an env var injected into the bundle, or a `console`-visible readiness line), the bearer lands in a source map or Metro log, and the acceptance criterion "no dev secret or endpoint leaks" is checked only at E3 against the *release* graph — where a development bearer would not appear anyway.
*Fix:* downgrade the §Provider and §Risks statements to requirements on the future exchange ("the exchange must ..."), and add an E1 acceptance item that greps the bundle, source maps, Metro logs, and readiness stream for the issued bearer.

**7. [MATERIAL] — 0181 (§AppBinding v1 vs §Provider). The binding override contradicts the "no arbitrary hostname or runtime URL override" invariant.**
§AppBinding v1 lists as load-bearing: "v1 admits no arbitrary hostname or runtime URL override," and Non-goals forbid "inferring a production endpoint from development state" and any `EXPO_PUBLIC_SNAPBACK_URL` fallback. §Provider then says "An explicit `binding` override may exist for tests and advanced multi-target applications." An `AppBindingV1` contains `target.origin` and `routing`, so a caller-supplied binding *is* an arbitrary-origin override with a different spelling. No admission rule constrains it and nothing excludes it from release builds.
*Failure scenario:* an app ships `<SnapbackExpoProvider app={app} binding={bindingFromRemoteConfig}>` to production; the release-selection closure (explicit target name / admitted channel default / refusal) is bypassed entirely, and the "no fallback to localhost or an arbitrary URL" guarantee is void.
*Fix:* state the override's admission rule in §AppBinding v1 — e.g. it must still carry a `descriptorIdentity` match and a target identity present in generated target facts, and the provider refuses a `source: "supervised-dev"` override in a release build — or restrict it to a test-only entry point not exported from the package's production condition.

**8. [MATERIAL] — 0176 (§Already shipped but undiscovered), 0181 (§Supervised development baseline, §Diagnostics), grounded against LLP 0017. "The generated admin console already exists" is unsupported by the excerpt that would establish it, and 0181 schedules work that depends on it.**
0176 states the admin console "already exists" and calls its absence from the bakeoffs "a workload-indexing failure in the guide, not a reason to create replacement primitives." 0181 makes `snapback dev --expo` print "the LLP 0017 admin console's launch command" in its readiness stream and lists it as a diagnostics deliverable, calling it "the cheapest fix available in the whole program." The LLP 0017 excerpt is written entirely in proposal voice ("Snapback **should** ship a first-party admin console"; "The default serving model **should be**") and states no implementation status and no launch command.
*Failure scenario:* E1 implements a readiness line printing a command that does not exist or is spelled differently, and the program's cheapest claimed win is a broken string in the one output stream every new developer reads.
*Fix:* cite the shipped console's actual entry point (command or URL) and its status in 0176's already-shipped list; if LLP 0017 is still a Draft proposal, move the console out of "already shipped but undiscovered" and out of 0181's E1 diagnostics into a dependency. **This needs a repository fact the capsule does not supply.**

**9. [MATERIAL] — 0179 (S2), 0176 (gate list). LLP 0179's S2 deliverables are load-bearing for G3 and for 0179's own v1 acceptance, but are mapped to no gate.**
0179 explicitly maps S0 → "G1's first half" and S1 → "G2," then leaves S2 unmapped. S2 contains "Admit LLP 0180 command references without folding them into mutations" — a prerequisite for 0180 C0, which 0180 assigns to G3 — plus "Measure descriptor size and enforce member/depth budgets" and "one non-React descriptor consumer," the latter two being 0179 v1 acceptance items ("Unsupported ... budget cases refuse at generation"; "A language-neutral consumer can enumerate all members and requirements"). 0176's G0-G5 list never schedules any of them.
*Failure scenario:* G3 begins with the descriptor's `commands` namespace unadmitted and budgets unenforced; the command member is added ad hoc during command work, and the budget refusal (0179's stated defense against a surface becoming a global store) is never implemented because no gate required it.
*Fix:* map S2's command-reference admission into G3's deliverable list in 0176, and place the budget-enforcement and non-React-consumer items explicitly in G2 or G4; or state in 0179 which gate S2 belongs to.

**10. [MATERIAL] — 0177 (§Recommendation, OQ1), grounded against LLP 0130 SD-2 and LLP 0120. The document routes its evidence against a bar SD-2 does not state, and leans toward the one branch SD-2 gates on evidence 0177 does not have.**
0177 recommends "Run LLP 0130 SD-2's evidence check now. Relay Board, Split Ledger, and chat are three unrelated domains asking for reduction nodes that do not exist," and OQ1 asks whether three workloads "satisfy SD-2's usage evidence bar." The SD-2 excerpt does not turn on a count of workloads: it fires on 3a usage evidence and then decides by *expressibility* — if snapshot-batch composition plus the sequence primitive express the demonstrated shapes within their ceilings with acceptance green, no third profile is authored. Separately, SD-2 says "**Maintained-exact aggregates are authored only on measured contention evidence**," yet 0177's central lean is that "a maintained exact aggregate — or an explicitly capped aggregate with an at-cap fact — [is] a strong candidate for this workload," supported by a read-heavy/write-rarely argument, not contention measurement.
*Failure scenario:* the decision owner receives a sidecar framed as "three domains clears the bar, and maintained-exact looks strong," runs the count-based check SD-2 never specified, skips the expressibility test that actually decides the branch, and authors a profile SD-2 says requires contention evidence that was never gathered.
*Fix:* restate the recommendation in SD-2's own terms — first test whether 3a plus the sequence primitive express grouped reaction counts within their ceilings; report the result as the SD-2 input. Label the maintained-exact lean explicitly as *not* satisfying SD-2's contention-evidence precondition, and say what measurement would.

## DETAIL

**11. [DETAIL] — 0179.** The `export const app = {...} satisfies AppDescriptor` sketch in the Summary omits `format`, `identity`, and `api.queryGroups`, all of which are non-optional in the `AppDescriptorV1` interface given later in the same document. It is introduced as "Conceptually," but a `satisfies` clause invites the reader to treat it as type-checked. Either drop `satisfies` or complete the literal.

**12. [DETAIL] — 0178.** V3 says "The runtime result-contract check ... must also stop hashing away the actionable field path" — a `must` aimed at a runtime subsystem this RFC's own scope section says it does not own. Name the owning LLP/ticket and phrase it as a routed dependency (0176 tracks it as B3) rather than a requirement issued from here.

**13. [DETAIL] — 0178.** "This RFC is not a prerequisite for LLP 0179-0181" and the non-goal "Making LLP 0178 a dependency of application surfaces, commands, or Expo binding" sit awkwardly beside "Validation runs before LLP 0179 emits an `AppDescriptor`." The intended reading is that the *pre-existing* validation lane already gates generation and 0178's *new checks* add no dependency; say that explicitly, since as written the two sentences read as a non-goal reappearing in the design.

**14. [DETAIL] — 0180.** `defineCommand` has no declared syntax for command inputs or passthrough arguments, yet the descriptor carries `passthroughArgs` and 0179 binds `body: input("body")` and `image: input("image")` on a command. The derivation rule (inputs = mutation args minus the asset-mapped arg; asset input name = the `assets` key) is implicit. State it, and state what happens when an asset key collides with a mutation arg name.

**15. [DETAIL] — 0180.** OQ2 asks what mutation-attempt identity should be allocated *before* upload, while §Execution allocates the mutation only at step 4 and Acceptance asserts "Ambiguous mutation settlement never generates a new mutation identity." The acceptance criterion is satisfiable under the step-4 ordering, so this is not a contradiction — but the two sections should agree on when identity is minted before C1 tests are written.

**16. [DETAIL] — 0176.** The north-star snippet uses a bare `skip` sentinel with no stated import or provenance; 0179 uses it identically. Worth one line naming its owner, since it is the only piece of the headline snippet that is neither a generated node nor a React primitive.

**17. [DETAIL] — set-wide vocabulary.** The `manifest` / `descriptor document` disambiguation (0179) and the `surfaces` / "React surface" disambiguation (0179) are done well and held consistently by 0176, 0180, and 0181 — no lingering "manifest" usage for the app wire form anywhere in the set. The one residual is that 0181's LAN-relay exclusion list still says "manifest load," which is the *deployment* manifest sense and is correct, but a reader arriving from 0179's naming note may stumble. A parenthetical would close it.

# What is good

- **The G2 falsification checkpoint** is the strongest single decision in the set. Requiring a real bakeoff screen to be rebuilt and diffed on named metrics *before* G3 commits asset work to the surface design, with an explicit "halt and revise" instruction, is a genuine pre-registered disconfirmation test rather than a retrospective G4 measurement. Most plans of this shape defer exactly this and discover the answer too late.
- **The 0179/0180 split rationale** in 0176 is unusually honest: it names the failure-mode-vocabulary argument, cites in-repo precedent, states the sync cost as real, and invites future editors to re-open it. That is how a debatable structural choice should be recorded.
- **The namespace separation** (`mutations` returns a promise, `commands` returns a task, `assets` is raw) with the explicit prohibition on an ordinary mutation "sometimes returning a promise and sometimes a task" is a real correctness property, not ergonomics, and it is stated consistently in 0176, 0179, and 0180.
- **0180's residue and ambiguity semantics** — mutation as sole commit boundary, no silent deletion, no fresh mutation identity to make `.done` settle, cancellation that cannot claim compensation — are the parts of an "it's just one call" API that are usually elided, and they are specified rather than gestured at.
- **The evidence boundary in 0176** and the negative-result framing in 0177 both state what the experiments do *not* establish before stating what they do. 0177 in particular closes its own central factual question ("v1 explicitly refuses the self-join") against source rather than leaving it open, and refuses to mint syntax.
- **0178's validation/advisory split**, with the rule that any check a legitimate input can trigger belongs in the advisory lane and that validation admits no suppression at all, is a correct and durable line — and the document is candid about the earlier draft's `--allow-lint` mistake.
- **0181's LAN-relay gating** is the right call and is argued from reachability rather than trust posture ("a Metro listener on a LAN is a network front, even if the backend behind it remains loopback-only"), including the explicit rejections that a QR code is not transport security and an attempt grant is not a relay session.

```
VERDICT 0176: NOT READY
VERDICT 0177: NOT READY
VERDICT 0178: READY
VERDICT 0179: NOT READY
VERDICT 0180: NOT READY
VERDICT 0181: NOT READY
VERDICT SET: NOT READY
```
