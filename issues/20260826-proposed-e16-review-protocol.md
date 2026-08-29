# Proposed protocol for landing E's "independent integrated review" (E-16)

**Status:** open — a proposal awaiting the owner's ruling, not a decision
**Context:** `issues/20260826-what-landing-e-requires.md` found E-16's protocol **absent**: LLP 0313
does not define reviewer count, blindness, execution duty, reconciliation, or the signature artefact.
E-16 is one of only two landing-E bundles blocked on a *decision* rather than on landings B–D, so it
can be settled now.

This proposal is grounded in what was actually observed reviewing this programme's own changes over
one working session, not in general principle.

## The evidence

**Two reviewer kinds catch disjoint defect classes, and neither dominates.** A *reading* reviewer
judges by inspection with no build; an *executing* reviewer compiles, runs witnesses, and models races.

| Change | Reading reviewer | Executing reviewer |
|---|---|---|
| Fork identity, round 1 | **LAND** — detailed, correct analysis | **DO NOT LAND** — `pthread_atfork` inside a lazy `Once`; a fork landing mid-registration left the child inheriting RUNNING with no thread alive to finish it. Child **blocked forever**. |
| Fork identity, round 2 | **LAND** — saw the issue, judged it non-blocking, *and supplied the fix* | **DO NOT LAND** — a legitimate identity compared **unequal to its own clone** during transient registration. Revision (p). |
| Fork identity, round 2 | Found `clone(CLONE_NEWPID)` from pid 1 **fails open** — invisible to an executing reviewer on macOS, where the syscall does not exist | did not reach it |
| Chokepoint landing A, round 2 | Found the `obtain` probe passes **six arguments to a seven-argument function**, so its real diagnostic is `E0061`, not the claimed `E0308` | **confirmed all seven probes** "substantively exercise real APIs with the intended diagnostics" |

The last row is the decisive one. **Execution tells you a compile-fail witness failed; it does not tell
you why.** The probe failed, a diagnostic overlapped the marked span, the gate scored green. Only
reading the signature revealed the mismatch — the third instance that day of a witness failing on stale
arity and being scored as proof.

**Reviewers also vanish.** One codex review was refused mid-run — *"flagged for possible cybersecurity
risk"* — after ~494k tokens, producing no verdict at all. A protocol that assumes both reviewers report
will silently degrade to one.

**And they can review the wrong thing.** A stale published ref once produced a confident DO NOT LAND
whose four load-bearing facts were all false, because the reviewer saw a different commit than the one
under consideration.

## Proposed protocol

1. **Two reviewers minimum, of different kinds.** At least one reading-only and at least one executing.
   Two reviewers of the same kind do not satisfy E-16; the table above is the reason.

2. **Blind to each other.** Neither sees the other's findings before submitting. Disagreement is the
   signal being purchased, and it is destroyed by anchoring.

3. **Same content digest, verified.** Both reviewers are given a digest and each **echoes it back** in
   its report. The orchestrator confirms the echoed digests match before reading either verdict. Not
   "both were pointed at the same ref" — *both demonstrated they read the same bytes*.

4. **Explicit duties, stated in the brief.**
   - The **executing** reviewer must *run* things: build the witness, execute the composition, model
     the race, fork the process. A report that only inspects has not discharged its duty and is
     recorded as a reading review.
   - The **reading** reviewer must mark every claim it could not verify as **UNVERIFIED**. Those lines
     are the executing reviewer's assignment on the next round, not filler.

5. **Witness checks are mandatory for both**, because this is where the programme has been burned most:
   does the call site's **arity and signature** still match the target; is the diagnostic at `@attack`
   rustc's **first** or an incidental secondary; does the recorded `expectedCode` match what was
   **observed**.

6. **Reconciliation is explicit.** Every finding is resolved as *fixed*, *refuted with reasoning*, or
   *accepted as a recorded residual*. A finding one reviewer raised and the other did not is **not**
   discounted for lack of corroboration — three of the four rows above were single-reviewer findings and
   all three were real.

7. **A reviewer that does not report is recorded as absent.** Never inferred to have passed. If a
   landing proceeds on one review, the closure record says so in those words.

8. **Two READY signatures**, each naming the reviewer kind, the echoed digest, and the findings it
   resolved. One signature is not E-16; it is a documented exception.

## What this costs

The fork primitive took **three rounds** under this shape, each closing a defect the previous reviewer
could not see. That is the cost, and on a chokepoint whose whole purpose is to be the one place
authority can be created, it is worth paying. The alternative — landing a permit that `mem::forget`
can leave armed after commit — is exactly the class of defect this programme exists to eliminate.

## Related

- `issues/20260826-what-landing-e-requires.md` — E-16 and the other fifteen bundles
- `issues/closed/20260826-f145-witness-arity-drift-manufactures-a-false-closure.md` — the witness-evidence rules
- `llp/0313-authority-creation-chokepoint.spec.md` §8, §11
