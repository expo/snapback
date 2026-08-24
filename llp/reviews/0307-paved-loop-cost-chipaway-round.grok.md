# Review artifact — LLP 0307, family: grok

## Round 1 — 2026-08-24

- Model: grok-4.6 (headless CLI, `--reasoning-effort xhigh`, web search
  disabled, full terminal ban in prompt; no repository inspection — inlined
  packet: LLP 0307 r1 full, LLP 0306 full, LLP 0295 lines 97-330).
- Target revision: r1, sha256
  `94121eb8cce46821125322d65f2b0da63fa6a03a88f3632b06c8741318cef68f`.
- Capsule: detached worktree at `c26bb9729` + r1 overlay; structurally
  blind (no 0306/0307 review artifacts existed).
- Received: 2026-08-24, exit 0, stderr empty. The first line of stdout is
  the CLI's interim narration, retained verbatim below for fidelity; the
  review body follows it.
- Verdict: **NOT READY** (4 MATERIAL concerns).

### Verbatim body

I'll read the full review packet and the LLP review skill first, then write the mutually-blind review from the document text only.The prompt is longer than the first read; I’ll pull the rest of LLP 0307 and the 0295 excerpts before writing the review.# Independent review of LLP 0307 r1

Reviewer family: grok-4.6. Mutually-blind round 1. Reviewed only the provided texts of LLP 0307, LLP 0306, and the LLP 0295 excerpts. No repository inspection.

The RFC is doing the right *kind* of work: it converts 0306’s findings into a round, re-checks them against `main`, retires items that URL-first already closed, and mostly refuses to open parallel owners. Several of the five rulings are the right call. The round is not ready, because four decisions as written would mis-sequence the pin, mis-score a 0253 boundary, turn a fail-fast into a later trap, and execute an unaccepted 0297 split.

---

## MATERIAL 1 — Sequencing §4–5 vs Track E4 / Summary fact 2: a pin gate is placed behind a non-gate, on the wrong M3 causal story

**Defect.** Sequencing step 5 gates the next full published pin on four things: Q green, T1 landed, the instrument bump landed, and per-milestone metering emitting. W5 is *not* in that list. Sequencing step 4 then puts E3/E4 “behind” E1 (the four W5 tickets). E4 *is* the instrument bump. The pin therefore waits transitively on “the round’s largest implementation item” even though the pin criteria deliberately omit it.

That order is justified by Summary fact 2: Familiar M3 (3,015s) is treated as “precisely an inability to tell transport latency from render cost,” so executing accepted W5 design is “the biggest open lever.” 0306’s own evidence does not support that attribution:

- F2 ranks M3 as ~12 Metro restarts, then 45 controlled keystrokes on a large tree, with visibility eventually ~1.5s; “the diary says render cost, not the channel.”
- Confidence table: “Familiar M3 cost was render, not ephemeral transport” (medium).
- Open question 4 in 0306: the 2s clock is instrument vs product vs both — owner LLP 0281, i.e. E4, not W5.
- 0307’s own verification already assigns the live leftovers to T1 (Metro bytes), T5 (volatile presence thunk), and E4 (typing/render split). W5 is pull-only phase/delivery inspection; S2 is the actual “why is this late?” span, and OQ3 correctly *defers* it so it will not double-own W5.

W5 is still worth doing (accepted 0267 §7, zero code, owns the pre-inconsistency diagnostic). Using M3 to put the *pin-gated* harness bump behind W5 is the defective decision. It also fights the RFC’s first reshaping fact (“highest-leverage next act is qualification, not design”) and the claim that the next pin “re-pays that noise unless the bump lands first.”

**Why material.** This is the round’s delivery order. As written, Clique will wait on four unimplemented runtime-cost tickets before the measurement repair 0306 actually implicated for the largest *authoring* sink, while a published pin that does not even require W5 is stuck behind them.

**Fix direction.** Run E4 in parallel with Track T/Q (it is a pin gate; it does not depend on W5). Keep E1 as large parallel work and keep S2 conditional (OQ3 is right). If the pin should also wait on W5, add W5 to step 5 explicitly and drop the claim that qualification-plus-instrument is the next act. Rewrite fact 2 so W5 is justified by 0267 §7 / contention / zero code, not by M3.

---

## MATERIAL 2 — OQ2 is the wrong call as worded; E4 then misnames it as 0306’s “honest completion profile”

**Defect.** 0306’s no-plan clause offered two coherent alternatives: grade Familiar M8-schedule N/A, *or* stop forbidding the 0253-documented leave. OQ2 takes the leave and then records it “as an in-profile escape rather than a failure,” because “N/A would hide it.”

Leaving the profile is the 0253 boundary. Calling that an *in-profile* success is a contradiction in terms. It also contradicts LLP 0295 objective 7 as given in the packet: a capability is not paved because a lower-level escape can assemble it. 0307’s own non-goals keep “Adding Familiar cron” off the table; scoring the escape as in-profile is how cron gets paved for Familiar Clique without adding Familiar cron.

E4 then lists “the honest-Familiar completion-profile ruling (OQ2).” That is not what 0306 idea 12 named. Idea 12 is: if cron and native offline replay stay Explicit-only, the Familiar prompt must not carry M8-schedule or native-queue obligations *as if they were in-profile*. OQ2 as ruled is the opposite prompt: keep the obligation, allow the exit, count it as in-profile.

Allowing the documented leave so Guide and lane charter stop fighting is the right half of the 0306 fork. The scoring half is the wrong call.

**Why material.** This changes what a Familiar Clique green cell *means*, and it re-litigates 0253 inside an instrument bump while claiming not to. Later pins will report Familiar-paved schedule work that 0253 says is out of profile.

**Fix direction.** Split the ruling. (a) Lane charter: stop forbidding the documented leave. (b) Scoring: either N/A for M8-schedule on Familiar-only lanes, or a visible `profile-exit: cron` outcome that is neither failure nor in-profile success. Do not equate OQ2 with 0306 idea 12. If the author wants the path exercised, charter an explicit profile-exit cell; do not launder it through Familiar success.

---

## MATERIAL 3 — Track T6: vocabulary-only “repair” turns a fail-fast into a later trap; 0306 OQ3 is left unruled

**Defect.** 0306 F3.8 is a *chain*: target lists `offline_mutation_replay` as experimental; Familiar `requiredCapabilities` rejects it as unknown; the binding omits the settlement ledger; native queue dispatch then refuses `SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED`. 0306 OQ3 asked the actual product question: grow an authorable requirement, or stop asking Familiar-only lanes for native durable queue replay (idea 12 again).

0307 puts “add the id + a parity gate binding the authorable set to the Rust registry” in Track T as “straightforward, implementable as written,” “independent of the larger settlement-ledger acceptance,” and “closes the drift class.” S3 only *later* graduates profile-surface leftovers to a 0253 amendment.

A parity gate of authorable-set ↔ Rust registry, given that the id already sits in the registry, target manifest, and experimental-maturity mirror, *adds* the id. Generate stops failing closed. The next walls (omitted ledger, queue refuse) become M7-shaped, which is exactly the treadmill 0306 already paid for. 0295 objective 3 as excerpted: Familiar-looking code may either work or refuse *before output* with the supported rewrite. T6 as written does neither.

**Why material.** This is the one Track T item that changes the Familiar capability grammar. Shipping it as a chip-away without ruling 0306 OQ3 is a silent expansion, and it is likely to *increase* agent cost on the next pin.

**Fix direction.** Rule 0306 OQ3 in this RFC. Either (1) keep the id non-authorable until ledger admission lands, and make generate refuse with a table that names target ∩ authorable ∩ binding ∩ admission (0306 idea 5), and stop asking Familiar Clique for native-queue replay; or (2) land id + ledger admission + refuse-before-output as one 0253-owned unit (S3, not Track T). Do not add the id alone.

---

## MATERIAL 4 — Track E3: this round “finishes” LLP 0297 Option E while 0297 is still Review / both-families NOT READY

**Defect.** 0306’s overlap clause: 0297 already owns the node-ceiling finding from this same 450b run; “Do not re-open that design here.” 0307’s verification table still has 0297 in Review, round-1 both families NOT READY, narrowed to Option E. Track E then sequences “LLP 0297 Option E close-out: finish the narrowed generated-artifact-category ruling *and* fix the live 4,096-vs-65,536 identity/admission budget mismatch” as work this round depends on, with the blank-boot guide-gap ticket as acceptance fixture.

Finishing that category ruling *is* 0297’s remaining design. This RFC does not own it, 0297 is not accepted, and reviewers have not marked it ready. Which number is wrong (identity 4,096 vs admission 65,536) *is* the category split. Implementing the mismatch fix under an unaccepted Option E is how the wrong ceiling gets “fixed.”

**Why material.** Ownership and feasibility: the round would either re-litigate 0297 inside 0307, or land a budget change that 0297 may still reverse. That is the 0207 failure mode 0295’s excerpt warns against — a coordination document becoming a second owner.

**Fix direction.** Drop “finish the Option E ruling” from this RFC. Sequence only the existing guide-gap ticket as blocked on 0297 acceptance. If a live crash must be contained before 0297 accepts, record a temporary operational cap owned by 0297, not a close-out of Option E.

---

## The five rulings (decision-quality)

| # | Call | Verdict |
| --- | --- | --- |
| OQ1 standalone Q probe | Right. 0295 R2 is “machinery in active repair, not yet run”; gating a minutes-per-cell published-0.1.26 check on that controller would re-own R2, which the non-goals forbid. |
| OQ2 allow leave as in-profile escape | **Wrong as worded.** See MATERIAL 2. Allowing the leave is fine; in-profile success is not. |
| OQ3 S2 stays conditional on W5 | Right. Commissioning a second 0219/0267 surface before the four accepted W5 tickets have code would double-own W5. Do not reverse this to “fix” M3; M3’s owners in this RFC are T1/T5/E4. |
| OQ4 export `defineAuth`; accept `v.json<T>()` | Not the wrong call on the evidence given. Disposition 4 plus an unreachable constructor *is* a trap if schema-level auth is already disposition-1; a declared cast is an honesty-preserving convenience if it stays a cast. It must not ship from Track T4 as a “straightforward” ticket — that is the 0253 dated amendment. |
| OQ5 helper-first, thin CLI verb | Right, and it matches S1’s recommendation and 0306 idea 3. Packaging can be bound here; the Spec still owns the contract (minted `clientMutationId`, dispose, no live replica). |

---

## Non-blocking

- Track T heading (“straightforward, implementable as written”) vs T3 as S1’s tracking anchor: keep T3 inventory-only so sequencing step 1 cannot start replay implementation before S1.
- T4 is a guide-gap ticket; OQ4’s export and `v.json<T>()` belong only on the 0253 amendment. `v.json<T>()` is not “the same honesty” as leaving the result `unknown` unless the guide says the parameter is a caller assertion.
- “Moves 1–4 are landed” overstates 0295’s 2026-08-23 table (refusal remainder, `whereApplicable` guide fact, W3 export-parity catalogue still open). E2 picks up one leftover; say so.
- “Roughly half of the 0.1.25 pair’s error loops were instrument- or harness-attributable” is not supported by 0306’s 40/42 Explicit agent vs 7 Familiar Snapback-defect split. The “bump before the next pin” conclusion does not need that fraction.
- Sequencing step 2 (“Q before anything else is built on 0299/0301/0302”) vs step 1 (T1/T2 start immediately): say T1/T2 are allowed to race Q because they are not lifecycle redesign, or start them after Q green.
- S1 “unblocks the next full pin’s scale cost” while step 5 omits S1: S1 changes scale *shape*, not pin admission. Say that.
- E4 currently absorbs 0306 A1–A3 (session split, detached scale watcher, compact choreography misses) onto a Draft LLP 0281 ticket whose child tickets 0306 already found missing. Those can ride 0281, but they are not the typing/render bump; list them as extra 0281 scope so the pin gate can land without them.
- “All four URL-first implementation landings” then names three (0299, 0301, 0302). Count 0300 or drop “four.”

---

VERDICT: NOT READY

## Round 2 — 2026-08-24 (combined: 0307 r2 delta + 0307.000 r1 fresh)

- Same model/config as round 1; capsule = worktree + r2/0307.000/companion
  tickets overlaid. Target hashes: 0307 r2
  `e594e38ea12a92d2e78f527e5e8355d5f1b57e02afb2c6071481a72f6a4efa24`,
  0307.000 r1
  `458c06f01d467223b649d14e3090cb8cdabcd6a85885d36fdc9039e79b5dbf90`.
- Verdicts: **0307 READY** (all dispositions real and correct; 5
  non-material in-delta leftovers + 1 obligation). **0307.000 NOT READY**
  (5 MATERIAL: receipts cannot serve ctx.settled/resume; exactly-once
  without persist-before-send; acceptance-4 vs 'none' custody; resume must
  follow per-action custody; cross-run retention ack-drain missing; plus 2
  high non-verdict items: SIGKILL status synthesis, one-shot iterable
  resumability).

### Verbatim body

I'll read the full offloaded prompt first, then review both targets against that text only.The prompt is long; I’ll keep reading it in chunks so the full r2 text, the diff, and 0307.000 are all in view.I have the full texts. Next I’ll load the review-loop rules so the verdicts follow the same classification the round requires.## TARGET A — LLP 0307 r2 (delta)

Punch-list dispositions match the r2 text. The diff’s load-bearing rulings are sound. Leftover one-liners and underspecification are not defective decisions.

### Disposition check

All four MATERIAL folds and the named non-blocking folds are present and correctly stated.

| Finding | Disposition in r2 | Verdict |
| --- | --- | --- |
| M1 pin-gate / M3 attribution | Fact 2 justifies W5 by LLP 0267 §7 + zero code + the contention diagnostic, never by M3; metering is landed-to-validate; M3 owners are T1 / T5 / E4 typing-clock. Step 4 runs E4 from the start; step 5 says W5 is not a pin gate. | Real and correct |
| M2 OQ2 escape wording | OQ2 scores `profile-boundary: cron` (neither failure nor in-profile success), drops M8-schedule from Familiar-only charters, and parks a real leave as a separately chartered forced-migration cell gated on an executable path under LLP 0252 no-mixing. | Real and correct |
| M3 T6 / 0306 OQ3 | Bare id add is ruled out; T6 is allowlist + generate-time vocabulary table; authorability is the non-conditional S3 unit; OQ6 rules 0306 OQ3. | Real and correct |
| M4 E3 / 0297 | E3 is routing only, blocked on 0297 acceptance, split across 0114/0179 vs result/live-query; interim caps are 0297-owned; no close-out language. | Real and correct |
| T3 inventory-only; T4/v.json; moves 1–4 leftovers; instrument-share evidence; T1/T2 race; S1 not pin admission; E4 vs 0201 session shape; URL-first / 0300 umbrella | Each is in the named section. | Real and correct |

No disposition error.

### Diff review (IN-DELTA)

The new decisions are the right ones: Q-a vs Q-b failure routing, T1 investigate-first after the alias-bytes correction, S1 cross-ownership (0043 / 0275 D9 / CLI verb / 0201 consumer), idea 13 minting at the ack-owning layer, S3 as one unit, E4 observation-only.

Non-blocking leftovers the rewrite created (not verdict-bearing):

1. **IN-DELTA, not MATERIAL.** The four-track one-liner still calls Q “qualify the published paved loop” after the body narrowed Q-a to LLP 0299 and deferred 0301/0302 to Q-b. Sequencing step 5 still requires Q-b before the pin, so execution does not follow the stale one-liner.
2. **IN-DELTA, not MATERIAL.** OQ2’s owner parenthetical still says “LLP 0201/0281 instrument bump” after E4 dropped the completion-profile work. The ruling itself is a next-pin charter/scoring constraint; OQ7 already keeps session-shape off 0281. Name 0201 (next pin charter) as the vehicle.
3. **IN-DELTA, obligation.** Q-a’s “cross a supervised binding term” is unspecified next to OQ1’s minutes-scale probe. If the term is still a clock TTL, say how the probe forces refresh without waiting it out.
4. **IN-DELTA, not MATERIAL.** OQ1’s question text still says “the Track Q probe” singular; the body correctly applies the ruling only to Q-a.
5. **IN-DELTA, not MATERIAL.** The Track T blurb “straightforward, implementable as written” is now a worse fit for investigate-first T1 and inventory-only T3. The per-ticket lines govern.

No IN-DELTA MATERIAL defect. No PRE-EXISTING MATERIAL admitted under delta-round scope.

---

## TARGET B — LLP 0307.000 r1 (full)

Ownership, packaging, and the product shape match the parent: helper-first in `@expo/snapback-acceptance`, thin JS CLI verb, 0043 semantics, 0275 D9 package API, 0201 consumer, minting in the layer that also acknowledges, client unchanged, no live queries, `rqsStore` pinned null, 1,024 ceilings not widened, hosted `'minted'` not claimed. Those decisions are good.

The **resume/receipt contract is not closed**. That is defective specification, not missing detail.

### MATERIAL

**1. Receipts cannot support `ctx.settled` or resume.** D2/D6 make later actions resolve earlier minted row ids through `ctx.settled(intent)`. D7 resume’s source of truth is the receipts file. The D6 line schema has `seq` / `intent` / `transportId` / `outcome` / `version` and **no settlement result**. After a crash, the placeholder→id map cannot be rebuilt from the durable log. Acceptance 4’s digest match is then unimplementable for any log that threads prior creates into later args (the actual 0.1.25 loader pattern the spec cites).

**2. Exactly-once is claimed without persist-before-send.** D3/D7/Acceptance 4 claim minted resume re-sends “the recorded transport id” so LLP 0043 republishes once. D6 only flushes a **terminal** line before the *next* dispatch. The crash-ambiguous action is the one with no terminal line. Unless the minted id is written durably *before* `mutate`, there is nothing to re-send and a new id double-executes. The helper’s reason to exist includes this class (`SNAPBACK_AUTH_STALE_RESULT` vs retention). As written, the claim is false.

**3. Acceptance 4 contradicts D7 `'none'`.** Resume must yield the same per-table digests as an uninterrupted run, with no custody qualifier. D7 `'none'` re-executes the crash-ambiguous action and records at-most-once ambiguity. Those cannot both hold for a non-idempotent last action. Digest equality belongs only on `'minted'` (and only after (2) is real).

**4. Resume keys off run-level custody; D3 minting is per-action.** Generated-IR references auto-mint inside a `'none'` run and retain server-side. D7’s `'none'` branch would re-execute that step. Resume must follow whether a `transportId` was actually sent, not the run default.

**5. “Retention respected by construction” is intra-run only.** Unacked settled ids from a killed run are not in the resume contract (no start/resume/failure ack-drain of receipted transport ids). Repeated kill/resume of `'minted'` runs on the same auth fingerprint can accumulate toward `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` — the ceiling this surface is supposed to make structurally unreachable.

### High, not separately verdict-bearing if 1–5 are fixed

- **D8 / Acceptance 5:** the status *file* cannot reach a terminal state under SIGKILL, which is the babysitting-kill path D7 advertises. `readReplayStatus` needs a synthesized dead state (pid gone / stale heartbeat), or Acceptance 5 is overclaimed.
- **D5 async iterable vs D7 prefix-continuity:** a one-shot stream is not resumable. Resume-eligible runs need a re-readable log.

### Not MATERIAL (altitude)

Unspecified RSS budget; which CLI flags exist vs the programmatic surface; how preflight reads “live” ceiling values; `clientPool` clamp not repeated in the D5 sketch; item 8 as first-consumer evidence at pin time (parent step 3 still sequences S1 before the pin, and explicitly not as a pin *gate*). Do not treat item 8 as making S1 a pin-admission gate; the parent forbids that.

### What would make 0307.000 READY

Close the receipt WAL: in-flight line with transport id (and enough result payload for `ctx.settled`) before dispatch; terminal overlay after settle; resume rebuilds the map from the file; ack-drain receipted minted ids on start/resume/exit; resume/exactly-once/digest rules per actual custody, with `'none'` digest equality dropped or scoped. Detached liveness as an API projection, not a file-write after kill.

---

VERDICT 0307: READY
VERDICT 0307.000: NOT READY
