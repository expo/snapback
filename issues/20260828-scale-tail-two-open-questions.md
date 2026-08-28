# Two questions from the sealed 0.1.29 scale tail

**Status:** Open
**Opened:** 2026-08-28
**Systems:** Live queries, Auth, Assets, Sync, Codegen
**Related:** LLP 0317 §Scale tail (O47–O51), LLP 0317.000

The `sol-snapback-explicit` lane sealed on 2026-08-28 with 7 greens. Its scale
phase is classified in LLP 0317. The two items below are **not** backlog rows:
they are questions about deliberate design. (A third item drafted here — the
saturated ledger itself — did become a row, **O53**, once review established
that the paved recovery cannot apply to an application that has lost its
predecessor ACK cohort.)

## 1. Should a saturated durable mutation ledger block *reads*?

At both scale checkpoints, once the durable client-mutation ledger reached its
10,000-record global ceiling, `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` refused
**celebrity/small post acknowledgements plus Insights and Trending
mutation-backed reads**.

**Correction (review, 2026-08-28):** the documented recovery requires
re-entering the **predecessor authority cohort**
(`guide/sync/offline-and-retention.md:981,1037`), which an application that has
lost those ACK obligations cannot do. That gap is now **LLP 0317 O53**, not a
non-defect. What remains open here is the separate blast-radius question
below.

But the *blast radius* is worth deciding deliberately. Insights and Trending
are **reads**; they were mutation-backed only because the explicit JS mutation
contract rejects an empty write set (LLP 0317 O13, and the read-model
commission C5). A full write ledger stopping analytical reads is a coupling
that C5 would sever. Questions:

- Is refusing reads on a saturated write ledger intended, or incidental?
- Does C5's first-class read model remove this class entirely? If so, that
  raises C5's priority above where the program currently has it.

## 2. Should codegen refuse a view-once surface on public-immutable delivery?

The lane reported that view-once and delete-for-everyone did not revoke
already-delivered asset URLs. That is true and it is **documented**:
`guide/recipes/view-once-media.md` prescribes `grants: true`, an `owner-only`
read policy and `delivery: { kind: 'private-strict' }` *precisely so* close or
delete denies the next governed byte request, and it warns that revocation
"controls future governed requests, not bytes the client already copied."

The lane used public-immutable delivery, which cannot revoke by construction.
So this is an authoring error against clear guidance — but it is a
**security-shaped** one: the app shipped a view-once feature that does not view
once, and every UI-level fact suggested it worked.

Per the program's P2 ladder, the cheapest prevention that would have stopped it
is generate-time, not documentation: should codegen refuse (or at minimum warn
on) a view-once/revocation-shaped surface declared over a public-immutable
asset? The two declarations are visible together at generate time.

## Third item, ticketed separately

Candid gap 1 — the table-native conversation and receipt projections being
broader than membership-filtered private reads, so an opaque chat ID can expose
data — is the measured confidentiality cost of the O17 workaround and is
tracked with O17 rather than here.
