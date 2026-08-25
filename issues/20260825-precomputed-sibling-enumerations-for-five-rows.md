# Pre-computed sibling enumerations for F091, C004, C009, F286, F288

Status: open
Date: 2026-08-25
Systems: snapback-engine, snapback-sync, snapback-kernel, snapback-server
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/20260825-the-strict-family-is-not-batchable-45-roots-for-58-rows.md,
  issues/20260825-lane-completion-checklist.md

## Why this was produced before the lane

LLP 0303 revision **(n)** makes sibling enumeration a deliverable of the fix rather than a finding of
the review, because eight of nine gated lanes were defeated by an adjacent path their fix never
reached. Enumerating in advance, on otherwise-idle read-only capacity, means the implementing lane
inherits the map instead of spending a round drawing it.

## The headline: fixing the exploited site is not close to sufficient

| Row | Distinct path families | Reach of a fix at the exploited site |
|---|---:|---|
| **F091** | **13** | 4/13 structurally — **0 guaranteed semantically**, because all four reconstruct an unbound output |
| **C004** | **12** | 10/12 structurally; coverage indeterminate, and R7–R8 **definitely bypass** the site |
| **C009** | **12** | descriptor site is directly on 6 branches and causally upstream of 12/12, but only if literal, clone, serde, builder **and** alternate construction all derive from the installed issuer reservation |
| **F286** | **2** | 1/2 — direct core callers remain |
| **F288** | **3** | 1/3 overall, 1/2 of the generation-bearing paths — direct prepared and development siblings remain |

F091's line is the one to sit with: a fix at the site where the exploit was executed touches four of
thirteen path families and is **semantically guaranteed on none of them**, because each reconstructs
an unbound output. A lane that fixed the exploited site and declared victory would have been
defeated, exactly as seven lanes before it were.

## My hypothesis about the shared root was wrong

I asked whether the **generation issuer** was a common root across C009, F286 and F288, on the
reasoning that all three concern connection generations and subscription scope. It is not:

- for **F286**, issuer closure covers **0 of 2** paths;
- for **F288**, it "removes the unissued-generation component but does not close the row", because
  B's genuine descriptor still carries a genuinely issued generation that can be combined with A's
  body connection ID, and B's subscription can still be repointed to A.

The actual root is **the exact `PreparedConnectionAct` plus retained subscription owner** — the
prepared act including its connection ID, descriptor/admission, fence and grant, paired with a
subscription whose retained owner is that same connection.

**That is good news.** `PreparedConnectionAct` is one of only four authority roots in the strict
family currently assessed as **sound**: server-private, unconstructible from a dependent crate, and
retaining exact live registry/grant provenance. So F286 and F288 hang off a root that will actually
hold, which makes them more tractable than their path counts suggest — provided the fix derives from
the *tuple*, not from the generation.

## The Q06 asymmetry recurs

Both F286 and F288 show it: a validated B prepared act enters the server, but the staged plan is
assembled with **body connection ID A** and **B's descriptor/fence**. Stage ownership prevents
engine-to-engine travel, but it does not preserve the connection-ID equality the validated input
implies.

That is the same shape as the landed Q06 row — input view bound, reconstructed output not — and it
is now the third place it has appeared. Worth treating as a standing check rather than a per-row
discovery.

## Roots required for the remainder

- **F091** — authenticated subject and claims plus producer database/projection provenance, enforced
  at the consuming engine's common authority tail.
- **C004** — server-derived subject and claims tied to the same durable session database; the common
  raw authority/fence tail must not accept caller-authored equivalents.
- **C009** — the exact installed issuer's reservation history, associated with the exact connection
  grant/fence.
- **F286 / F288** — the `PreparedConnectionAct` / connection-grant tuple, and for F288 the retained
  subscription owner with it.

## Provenance

Read-only against `5c2650d7526f65a60211057db50b97a9bf2a3551`, rechecked unchanged at the end. These
five rows were briefly promoted to P1-SHIP and have since been corrected back to P2/P3
(`issues/20260825-i-over-escalated-five-p3-rows-to-p1-ship.md`); the enumeration is unaffected by
that severity correction, since it describes reachability rather than severity.
