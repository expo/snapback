# LLP 0171 review — claude family

**Target:** `llp/0171-authoring-loop-parity.rfc.md`
**Reviewed revision:** `b208b5adf9bcbfefa3e0fadcfa2ff876f0db3620`
**Capsule sha256:** `7f46b74158ae587e…`
**Runner:** claude -p --model claude-opus-5 (fresh process, cwd /tmp)
**Independence:** **NON-INDEPENDENT** — the claude family drafted this document. Launched with an adversarial-provenance instruction; reduced weight.
**Topology:** independent loop (not lockstep)

---

## Round 1 — 2026-08-04

I reviewed the RFC against itself and against the three appended guide excerpts. I have no filesystem access to the Snapback repo or to `~/projects/chess-bakeoff/` (blocked outside `/tmp`), so every claim below is grounded in the document or the appended context, and I say so where a claim is unverifiable either way.

## Concerns

**1. [MATERIAL] §C.2 — codegen-owned bundling does not say whether bundled third-party bytes are subject to the handler subset check, and that is the whole decision.**
The RFC claims §C "preserv[es] every existing property" and, in Non-goals, that it "explicitly preserves the property that makes [determinism enforcement] possible." But the property it names is only *hashability/replayability of bytes*. Byte-hashing preserves replay **identity**; determinism is preserved by the banned-forms check, which the appended guide describes as syntactic and generation-time (class syntax, `this`/`super`, dynamic computed member access, `eval`, `Function`, `Date.now()`, free identifiers outside an allowlist, each with file/line/column). Exactly one of these must be true and the RFC picks neither:

- Bundled dependency bytes *are* subject to the check — in which case essentially no real library passes (chess.js is class-and-index-heavy), and §C.2 is infeasible as described; or
- They are *exempt* — in which case codegen now emits an unchecked region of arbitrary npm code into the handler, and the determinism fence has a hole the size of a package.

The arm's own workaround points at a third, worse possibility: it esbuild-bundled chess.js and "re-checked the output against the banned forms itself" so it would pass. If transpiled output of a class-based library passes a check that refuses classes, then either the `{source, exportName}` lane's fence is materially narrower than the inline lane's (two fences the RFC treats as one), or a bundler at a low target is a general-purpose **syntax launderer** — `Date.now()` refused by name at generation survives as `D.now()` after minification. Moving bundling into codegen would institutionalize that laundering.
*Fix:* state which lane's fence applies to bundled bytes, and decide the fence question explicitly — e.g. bundled dependencies are checked by a *semantic* (not name-based) purity gate, or they run behind an explicitly-named narrower contract that the RFC admits is a new trust boundary rather than "every existing property." Do not carry the "preserves everything" claim forward unrevised. Relatedly, §C.1's proposed one-sentence docs fix should state the constraint (*handler sources are closed single scripts; you cannot import*) without the *"so pre-bundle"* clause, which would be documented advice to route around the checker before anyone has ruled on whether that is legitimate.

**2. [MATERIAL] §D — proposes relaxing an auth-integrity check on an explicitly unverified reading of what that check does, and a cheaper fix is available.**
The section says "the current check *appears* to compare the whole artifact," then proposes that a sessions app "admit a **superset** function surface across restart." That is a semantic loosening of `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` without establishing why the artifact covers the function surface. If the binding is deliberate — so a swapped or extended bundle cannot introduce a function that touches `ctx.auth` under an artifact issued for a different surface — then "admit supersets" is precisely the move the check exists to refuse, and the RFC would be removing the fence by describing the attack as the feature. The document should not propose loosening an auth check it has not read.
*Fix:* determine what the artifact binds and why before proposing any relaxation. Note also that the stated problem is not "the check is too strict" but "the documented recovery lives inside the thing §B says cannot be backgrounded." The cheapest adequate fix is therefore a **non-interactive artifact re-issue** (a `serve`/`generate` path that regenerates the artifact without dropping the database), which is tooling, not security semantics, and which §B's work already nearly delivers. Reserve the superset-admission change for the case where re-issue is proven insufficient.

**3. [MATERIAL] Acceptance — has no runnable form, is vacuously passable, and tests symptoms rather than the mechanisms the Design proposes.**
Open question 5 concedes the section's own premise is unresolved ("what is the non-flaky form of 'an agent with no prior exposure'? A recorded transcript replay is reproducible but stops measuring the thing"). So none of the five criteria can serve as a gate. Worse, criterion 2 ("whether any consulted page described a surface the installed package lacked") passes trivially if the agent simply never opens the drifted page, and criterion 3 (zero `node_modules` trips) is claimed to "kill A and C" but measures only C.1's discovery trip, not C.2 at all. Nothing anywhere verifies the actual §A mechanism: that a deliberately-drifted fixture page *fails* `check-guide.mjs`, and that an `unreleased: true` page renders its banner and *passes*. The RFC praises Snapback's "vacuous-pass protection … zero checks can never pass" as a distinguishing strength two pages earlier, then proposes an acceptance surface with exactly that defect.
*Fix:* add deterministic, mechanism-level acceptance that can gate — a drifted-page fixture that must fail the checker; a `serve` ready-line contract test (schema, non-zero exit on ready-timeout); a restart-with-one-added-function test; a job-under-concurrent-writes test — and keep the cold-start agent run as a periodic non-gating benchmark, explicitly labelled as such.

**4. [MATERIAL] §A — the flagship proposal reproduces the failure class it is fixing, is keyed to a frontmatter value the visible evidence contradicts, and a cheaper mechanical join already exists.**
Three problems compound:
- **`since:` is hand-authored.** The failure in §A is that an author's model of "what is shipped" was wrong. Asking that same author to hand-annotate `since: 0.1.9` reproduces the error: whoever forgot the fence forgets the annotation, and the checker only fires on pages that carry one. The RFC never says `since:` is mandatory, nor what happens to the existing corpus without it. That is load-bearing and undecided.
- **The predicate is scoped to `maturity: shipped`.** Both appended guide pages are `maturity: partial`. A `partial` page that describes a nonexistent surface is exactly as misleading, and if `partial` is the common value the check would rarely fire. The RFC asserts the two drifted pages were `shipped`; I cannot verify that, but the predicate must cover `partial` regardless.
- **A cheaper join exists and is not considered.** The appended page already carries `reviewed-commit:`, `authorities:` pointing at files *inside published packages* (`packages/snapback-codegen/index.mjs`), CI-verified snippet excerpts, and the publication ledger is named by filename. Resolving a page's cited authorities/snippets against the newest published closure — or comparing `reviewed-commit` to the commit that closure froze — catches `ctx.refuse` drift with **zero new hand-authored frontmatter**. The RFC says "only the join is missing"; the join it chose is between a hand-written string and the closure, which is the weakest available.

Also, Open question 2 speculates that `targets:` "may already be the discriminator" between the repo tree and the npm closure. The appended page contradicts this: `targets: [local]` means *local dev/test server vs hosted deployment target* ("Hosted targets make deliberately weaker or different claims"), not contributor-vs-app-author. That guess should be struck. And Open question 1 (page vs section vs snippet granularity) is a decision this document owns and should make — page granularity is the obvious cheapest start.

**5. [MATERIAL] §E — raising the `maxAttempts` default is not the free move it is presented as, and the two proposals are offered as alternatives when only one addresses each failure.**
The appended jobs guide states that re-enqueueing dedupes on "the same key, an equal canonical-args SHA-256 digest, **and the same `maxAttempts`**." `maxAttempts` is therefore part of the idempotency identity. Changing the default silently changes the dedupe scope for every caller that omits it — a re-enqueue that previously matched a stored job no longer does. The RFC does not mention this. Separately, the "either … or" framing is false: raising the default does not fix `lastErrorCode: null` being wrong, and fixing attempt-history does not stop the first-move `dead` transition. These are two defects needing two fixes. Finally, "treat reservation contention as a platform-class retry that **does not consume the application's budget**" is unbounded as written — a persistently contended job retries forever.
*Fix:* price the idempotency-identity change explicitly (and say what happens to jobs already stored under the old default); present attempt-history and platform-class retry as both-required rather than alternatives; give platform-class retries their own bounded cap and backoff.

**6. [MATERIAL] §C.2 — bundling at generate time pulls the npm dependency tree inside the replay-identity boundary, unaddressed.**
"Hash the *output*" is presented as neutral. It makes the handler hash a function of resolved `node_modules` contents and the bundler version, so hash reproducibility now depends on lockfile fidelity across machines and on bundler determinism. The RFC's own "must not regress" list names codegen as "deterministic, fails closed, writes nothing on error." A dependency-resolving bundling step is the one part of codegen that is not purely a function of the repo's own source.
*Fix:* state where declared dependencies are declared and pinned, whether the bundle is stored as bytes (replay reads stored bytes, never regenerates) or re-derived, and what happens when re-derivation produces a different hash. If bundles are stored, say so — it resolves most of this and should be one sentence.

**7. [MATERIAL] Scope — this is a findings report typed as an RFC, and accepting it authorizes nothing.**
A/B/C/D/E have five different owners (0061+0134, 0041, 0118→0108, 0160, 0070); the header says "LLP 0115 remains the sequencing home … should absorb these as CV items"; two items are already filed as guide-gap tickets. Nothing in the document is implementable under this number, yet it carries Status: Review and an Acceptance section for outcomes it does not own. "What does Accepted mean here?" has no answer.
*Fix:* keep RFC status for only what this document can decide alone — §A's `since:`/checker mechanism and §C.1's docs correction, both pure guide/tooling changes — and demote B, C.2, D, E to clearly-labelled *evidence handed to the owning LLP*, with the Acceptance section scoped to the retained items. Alternatively retype the whole thing as a findings note and file five CV items. Either is fine; the current hybrid is not.

**8. [MATERIAL] §A vs the Summary table — the stated priority contradicts the document's own evidence.**
"A is worth more than the other four combined" sits directly beneath a table costing A at ~8 min against B ~4 + C ~3 + D *unquantified* + E *latent*. §D is separately described as having "degraded the loop to 'drop the database'" and as "the reason 'day 200 of a real product' is currently unanswerable" — which is plainly a larger defect than a stale docs page, and is not a time cost at all. Since this ranking is what the RFC hands to LLP 0115 for sequencing, the misordering has consequences.
*Fix:* rank by severity rather than by measured minutes, or drop the "combined" claim. Relatedly, the Summary's "none of which is a design mistake" is contradicted by §C (two lanes with divergent fences) and §D (an auth check whose semantics the RFC wants changed) — soften or withdraw it.

**9. [MATERIAL] Summary — the central claim that these five items *are* the gap is not shown.**
Convex's 18 minutes is stated; the Snapback arm's total is never given. The itemized costs (~8 + 4 + 3, plus the ~7 minutes of doc-reading disclosed only in Acceptance §2, plus ~5 minutes writing) are the reader's only handle, and they are not reconciled against any total. "That is the whole gap" is therefore unfalsifiable as written.
*Fix:* state both arms' wall-clock totals and show that A–E account for the delta. If there is residual time, name it — unattributed time is the most interesting number in the document.

**10. [MATERIAL] §B — the ready line puts the admin URL and token file path on a stream designed to be captured.**
The appended authoring-loop page treats admin-token locality as an existing fence (browser code "does not receive the loopback origin, admin token, runtime path, or repository path"), and `dev` keeps this in a ready *descriptor*. A backgroundable `serve` printing address + admin URL + database path + token file path to stdout moves admin-reachability data into CI logs, scrollback, and supervisor logs. The RFC correctly says *path*, not token value — but it does not say the value is never emitted, and it duplicates the descriptor's contents into a second, less controlled location for no stated reason.
*Fix:* have `serve` emit the address and a pointer to the ready descriptor, keep credential-adjacent fields in the descriptor only, and state explicitly that no token material ever appears on stdout.

### Details

11. **[DETAIL] §E** attributes job-queue contention to `SNAPBACK_AUTH_RESERVATION_STALE` — a code in the *auth* namespace — without reconciling that. If the reservation being contended is an auth-session reservation rather than a queue reservation, E's "platform-class retry" classification is aimed at the wrong subsystem. Verify the code's origin before writing the classification rule.
12. **[DETAIL] §B** specifies "non-zero exit on any failure to reach ready" but no readiness timeout. Without one, a server that never reaches ready hangs a backgrounded script — the same class of failure `serve` exists to eliminate.
13. **[DETAIL] Acceptance §2** smuggles a sixth proposal ("no Rust toolchain required should be one line on the guide's first page") that has no section, no owner, and no proposal text. Promote it into §A or a §F so it survives revision.
14. **[DETAIL] "What Snapback already beats Convex on"** — "on every axis that was compared" is self-assessment by the arm that also chose the axes and read Snapback's diagnostics far more deeply than Convex's. The list is worth keeping as *things to protect*; the comparative superiority claim is not licensed by n=1 and should be stated as the arm's impression.
15. **[DETAIL] §C** generalizes from chess.js to "any domain with real rules — chess, dates, geometry, currency, parsing — hits it on day one." The reasoning is plausible and I think it is right, but it is reasoning, not evidence; mark it as such.

## What is good

- **The evidence boundary note is exemplary.** It names the diary, the working copies, the repeatability cost, and separates what this RFC proposes from what other LLPs own. Deferring sequencing to 0115 rather than opening a second track is the correct instinct. Do not lose this in revision.
- **§C's core observation is correct and valuable**: third-party-library import is a materially different problem from sibling-helper reuse, and LLP 0118's eight paths do not cover it. Supplying the counterexample while explicitly declining to re-litigate 0118 is exactly the right posture.
- **§B's contract is a real design, not a wish** — backgroundable, EOF-is-not-shutdown, machine-readable ready line, non-zero exit with a stable code, `dev` unchanged. Concern 10 is a two-line amendment to it, not a rejection.
- **The "must not regress" section** is the right instinct for a repair-program RFC and should survive verbatim (modulo the comparative claim in 14).
- **§E identifies a genuine latent footgun** with a plausible mechanism and a specific succeeding-row lie (`lastErrorCode: null`). The diagnosis is sound even where the remedy needs work.
- **Non-goals are crisp and correctly drawn**, particularly the hosted-provisioning exclusion with its justification that every item is reachable without a hosted story.
- **The document is honest about its own weakest artifact** (`refusalCodeOf()` regex-matching a diagnostic). That candor is what makes the rest reviewable.

NOT READY
