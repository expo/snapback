# Twenty-eight of the forty P4 rows are siblings, not duplicates

Status: open
Date: 2026-08-25
Systems: snapback-auth, snapback-engine, snapback-kernel, snapback-server
Related: issues/shelved/20260824-liveness-row-bucket-assignment.md,
  issues/shelved/20260825-p2-rows-are-nine-decisions-not-sixty-eight.md,
  issues/shelved/20260825-twelve-of-seventeen-p3-rows-need-execution.md

## The first correction in this programme that goes up

| Classification | Count |
|---|---:|
| TRUE-DUPLICATE | **12** |
| SIBLING | **28** |
| UNCLEAR | 0 |

The P4-DUPLICATE bucket excluded 40 rows from every actionable count on the strength of one word.
**The exclusion is valid for 12 of them.** The other 28 remain actionable after their named canonical
row is corrected.

Five earlier published counts in this programme were all over-counts corrected downward — 137→134,
47→34, 11→9, an unclear figure, and a strict enumeration labelled 37 that listed 41. This audit was
briefed with that record precisely because it made the opposite error direction the one to watch
for. It found it.

## Corrected arithmetic

| | Before | After |
|---|---:|---:|
| P1 + P2 + P3 actionable | 92 | 92 |
| P4 siblings, now actionable | 0 | **28** |
| **Actionable total** | **92** | **120** |
| P4 true duplicates (close with canonical) | 40 | 12 |
| RESOLVED | 2 | 2 |
| **Sum** | **134** | **134** |

Landed progress restates from *9 of 94* to **9 of 120 — 7.5%**, not 9.6%. The previously published
94 was 134 − 40, which also swept in the 2 RESOLVED rows; the arithmetic above keeps those separate.

## Why the original classification was defensible and still wrong

The audit is explicit that it does not contradict the earlier verification that all 40 rows can reach
durable or outbound effects:

> Effect reachability and defect identity are different questions.

Several rows reach an effect *solely through the canonical defective gate* and are genuine
duplicates. Twenty-eight retain an independent entry point, authority root, caller population,
subject join, or exposure. The test applied was the right one: **would a correction confined to the
named canonical defect make this row unable to reproduce the mismatch?**

## The clearest example, verified independently

**F037** (`provider.rs:3209`) was called a duplicate of **F061** (`provider.rs:4331`). Both are
public. Both are named `prepare_guest_claim_password_plan`.

- F061 is on `impl AddressAdmission` and takes **no identifier** — it derives one from the admission.
- F037 takes `identifier: &'a str` — a **raw caller-supplied identifier**.

F037 never calls F061. Fixing F061's address-admission derivation leaves F037 fully constructible.
Identical name, identical shape, different defect — which is exactly how a name-based or
signature-based duplicate classifier merges two distinct rows. Confirmed by reading both
declarations at the named commit.

Others in the same family: **F020** joins a guest issuance context to an independently supplied
plan and commits through `commit_guest_issuance` without touching its claimed canonical row at all;
**F032** accepts a preparation obtainable through either F061 *or* the separate public F037 factory,
so fixing one leaves the other route open.

## Consequence

The three examined buckets have now all moved, and in different directions. P2's policy blockers
were mostly imaginary (68 rows → 9 decisions, 3 author-blocked). P3's closures were mostly unearned
(12 of 17 likely falsifiable). P4's exclusions were mostly wrong (28 of 40 still actionable).

Every bucket that was looked at closely turned out to be misclassified. That is the finding about
the inventory as a whole, and it argues for treating any remaining unexamined classification as
provisional rather than as data.

## Provenance

Read-only, static inspection at `85d272010`, with the ref rechecked as unchanged at the end. No
files written, no builds run, no commits made. Traced definitions and production callers directly,
including changes after the earlier P4 verification's `5cae72b2b` baseline.

---

## Confirmation (2026-08-25): the remaining eight are genuine

The spot-check that refuted F280 stated its own limit — one of four sampled was wrong, so the other
eight TRUE-DUPLICATE calls were provisional. Those eight have now been audited individually.

| Row | Canonical | Result |
|---|---|---|
| F002 | F073 | TRUE-DUPLICATE |
| F014 | F011 | TRUE-DUPLICATE |
| F019 | F022 | TRUE-DUPLICATE |
| F078 | F082 | TRUE-DUPLICATE |
| F095 | F094 | TRUE-DUPLICATE |
| F161 | F240 | TRUE-DUPLICATE |
| F162 | F237 | TRUE-DUPLICATE |
| F312 | F306 | TRUE-DUPLICATE |

**Eight of eight genuine. No siblings, no unclear.** Every row reaches its effect only by executing
its named canonical implementation; no call direction is reversed, endpoint visibilities match, and
the apparent alternate routes do not bypass the canonical.

Two were checked with specific extra scrutiny. **F095 → F094**: F094 is one of only four rows in the
strict family whose root is currently sound, and its leaf defect is public *dismantling* rather than
construction — the dismantling fix does reach F095. **F312 → F306**: confirmed against `origin/main`
rather than the lane's uncommitted state; F312 is purely a handle-forwarding surface, and replacing
F306 with an opaque `AuthenticatedHostedTarget` removes raw incarnation/nonce combination from both
the direct and F312-mediated paths.

## The final arithmetic

| | Rows |
|---|---:|
| P1-SHIP + P2-POLICY + P3-LOW | 92 |
| P4 siblings (28 + F280) | 29 |
| F190, F191 — not actually resolved | 2 |
| **Actionable** | **123** |
| P4 true duplicates (close with canonical) | 11 |
| **Total enumerated** | **134** |

**The count is now stable, and every classification in the inventory has been audited** — P2 by
decision grouping, P3 by adversarial design and then by execution, P4 twice, the RESOLVED pair, and
the P1-SHIP set. Seven corrections were needed to get here; this is the first audit that changed
nothing.

