# The 68 P2 rows are nine decisions, seven of them already made

Status: open
Date: 2026-08-25
Systems: snapback-auth, snapback-engine, snapback-kernel, snapback-sync, snapback-server
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/20260824-liveness-row-bucket-assignment.md,
  issues/20260825-the-critical-path-is-the-shared-surface-not-the-rows

## The question that was asked

P2-POLICY is the largest bucket — 68 of the 134 liveness rows — and was being treated as 68
individual pieces of work. At the observed rate that is not a plan. So the question put to an
independent analysis was whether the 68 are genuinely 68 decisions, or a small number of decisions
wearing 68 costumes. Grouping was required to be by **the decision each row waits on**, never by
crate, file, or naming similarity.

## The answer

| Decision class | Questions | Rows | Author decision needed? |
|---|---:|---:|---|
| Strict derive-not-supply | 37 | 58 | No |
| Pending-effect cross-principal binding | 1 | 2 | No — landed (Q06) |
| Ask payer selection | 1 | 2 | **Yes** |
| Honest singleton residue | 6 | 6 | One of six: Q23 |
| **Total** | **45** | **68** | **2 decisions / 3 rows** |

Collapsed: **68 rows → 9 distinct decision questions, 7 of which are already decided.** Two product
decisions remain open and they cover **3 rows**. Q06's two rows have landed, leaving 66 represented
in code, of which **63 are engineering work under settled policy** and **3 are author-blocked**.

The 68-row partition was checked for exact set equality: 68 unique members, no duplicates, no
omissions.

## What this changes, and what it does not

It changes who is blocked. The programme has been carrying "blocked on author" as though it gated a
large share of the work; it gates **three rows**. Everything else is engineering under a ruling that
already exists, and can be staffed now.

It does **not** reduce the work to nine mechanical edits, and the analysis says so plainly. The
58-row family shares one ruling while still containing producer-provenance, database-instance,
capability-lifetime, and public-surface problems that need engineering judgement at individual
seams. The reduction is in *decisions*, not in *diffs*.

That distinction is worth holding onto. Four earlier published counts in this programme were
over-counts corrected downward, and the temptation with a result like this is to read it as the work
shrinking. It is not: it is the decision structure shrinking, which changes sequencing and
staffing rather than volume.

## The defect it found in LLP 0303

The analysis surfaced an enumeration defect in the governing ruling itself. The strict disposition
was labelled **37 questions** over printed ranges containing **41** identifiers — the ranges wrongly
included Q23, Q25, Q27, Q30, Q39 and Q45, and omitted Q36.

The document repairs itself without guessing:

- **Q39** is classified later in the same document as an external effect that precedes proof of
  ownership by design, i.e. rate-limit rather than authorize.
- **Q36** is ranked for implementation later in the same document with a DERIVE disposition.
- **Q23**'s product dimension is listed as still open, so it cannot be in a settled strict set.
- **Q25, Q27, Q30, Q45** are cross-principal flows whose implementation plans retain exact
  *relation* verification rather than derivation. Q25 asks directly whether "their exact
  pending-request relation" must be the authorization; Q45 concerns caller/approver attribution
  across principals.

Removing those six and adding Q36 yields exactly 37. Verified independently by recomputing the
ranges rather than by accepting the report: as printed they yielded 41, and the repaired ranges
yield 37 with Q23/Q25/Q27/Q30/Q39/Q45 excluded and Q36 included. Landed as LLP 0303 revision (m).

A label and its own enumeration disagreed by four, and every downstream count drawn from that
sentence inherited the error. This is the fifth count defect found in this programme; unlike the
previous four it was found by checking a set against its own label rather than by re-counting rows.

## Analysis provenance

Performed read-only against `142a4644b8ff22166ce7629e6dc47fed58e61842`. The sandbox correctly
refused the analysis's `git fetch` (it would have written `.git/FETCH_HEAD`), so the analysis states
it cannot certify that commit was still the remote tip, and scopes its findings to that named
object. That is the right disclosure to make and is recorded here rather than papered over.

## Ruling update — 2026-08-25

Q23 is no longer author-blocked. The author selected **owner-bound** development impersonation:
`DevImpersonation` may act only as the app owner or users within a project the developer
administers; unrestricted and fixture-bound impersonation are rejected. `local_dev_only` must become
environment-derived. This unblocks the Q23 implementation lane `q23-owner-bound`; Q13 remains the
one open product decision in this accounting. See LLP 0303 §Product decisions — Q13 open, Q23
ruled. This accounting ticket remains open.
