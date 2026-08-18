# Exact: provider list queries need a typed page envelope

**Opened:** 2026-08-17
**Source:** Coterie M2 surface freeze (Diary 0086); LLP 0279 item 3

## Gap

Provider list queries have a row-list result rather than a typed page
envelope, so a paginated query like `listFeed` repeats one opaque
`nextCursor` on every row of a non-terminal page. Workable and testable,
but the duplicated metadata is a per-row lie waiting to diverge, and every
adapter re-derives the page boundary convention.

## Ask

Add an explicit paginated-result shape (rows + continuation cursor +
boundary fact) to provider list declarations. Co-design with Snapback's
LLP 0278 D1 envelope so a `ContractDataProvider` translates one page shape
on both sides. Acceptance: Coterie's per-row `nextCursor` disappears across
a declaration version bump. External (Exact repo) fix; graduate to Linear
(Exact project) when picked up.

## Resolution (2026-08-17)

Graduated to the Exact repo: `issues/20260817-exact-provider-list-page-envelope.md` there. Picked up by the
sbs-orchestrate Exact-side batch; further state lives in the Exact ticket.
