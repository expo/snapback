# LLP 0081 spec-amendment frictions (post-Implemented consolidation)

**Status:** Open
**Severity:** P3
**Systems:** Migrations, CLI, Documentation
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-26
**Related:** Implemented LLP 0081, LLP 0072, LLP 0063 WS6

Small, non-blocking frictions recorded during the LLP 0081 implementation
program (Phases C/D and the Step 5 application witness), consolidated here
when the program's carrier tickets closed on 2026-07-26. None gated the
Implemented flip; each wants a dated 0081 amendment (or 0072-lane work)
rather than silent drift.

1. **`cancel_requested` naming.** The executor's journal state uses
   `cancel_requested`; the RFC's transition prose names the state
   inconsistently. Amend the RFC to the implemented name.
2. **Explicit `release` and `rehearse` CLI verbs.** §2's CLI list has
   neither verb; the implementation reaches `released` through `apply` and
   drives rehearsal via `migrate apply --rehearsal-receipt` against the
   restore-derived binding. Either admit the two verbs into §2 or bless the
   flag-form as canonical.
3. **Admission-timing profile note.** The local profile admits at the
   publication barrier under the single serialized writer; hosted profiles
   need the RFC's admission-timing note to say which timings are
   profile-defined versus normative.
4. **Rehearsal receipt custody (0072 lane).** On the local profile receipt
   custody is structural (operator file). Control-plane receipt
   authentication and binding rehearsal to the LLP 0072 backup manifest are
   0072-lane work, recorded in the retained-work ticket's closing note
   (issues/closed/20260724-step5-impl-0081-retained-work.md).
5. **Baseline-prose discrepancy (0063 WS6, pointer only).** WS6 prose says
   "about 168 handwritten lines" while floor(x*0.80)=152 implies a 190-line
   freeze source; flagged in the 2026-07-25 LLP 0063 amendment, thresholds
   untouched. Resolve in 0063, not here.
