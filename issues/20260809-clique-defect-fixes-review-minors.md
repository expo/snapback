# Clique-defect fixes: six minor review findings (fix-forward)

- **Date:** 2026-08-09
- **Source:** same-family review of the clique-defects integration
  (verdict: no material finding remains; these are the MINOR notes)
- **Systems:** Search, Headless client, snapback-react, guide

1. `llp/0208-clique-pilot-gap-closure.plan.md` — three ticket links still
   point at `issues/20260809-*.md` for tickets this landing moved to
   `issues/closed/`; only the 20260806 link was updated.
2. `packages/snapback-client/index.mjs` (`assertSearchFunctionReferenceV1`) —
   an 0.1.15-generated reference (no `searchRequestContractHash`) refuses with
   the generic "requires a generated Query reference for SearchRequestV1"
   message. That is the exact migration every pre-witness generated project
   hits at the next release; add a "regenerate: reference predates the request
   witness" hint.
3. Same function — the retained compatibility aliases
   `expectedArgsContractHash`/`carriedArgsContractHash` now carry the
   request-witness hash, so the alias names are literally inaccurate; consider
   renaming or dropping after one release.
4. `client.search()` — when a search's `resourceArg` is named `userId`
   (Principal resource field), the wrapper suppresses the per-call auth
   `userId`, so a caller cannot both scope and authenticate per-call.
   Deterministic and fail-closed, but undocumented in the LLP 0131 amendment
   and the search guide page.
5. `packages/snapback-react/index.mjs` wedge warning — can false-positive by
   naming an already-settled mutation if its settlement diagnostic was evicted
   from the 256-entry `outboxDiagnostics` ring while other mutations keep
   `pending > 0`. Dev-only console diagnostic; low stakes.
6. `guide/clients/react.md` — "Server rejection removes only its own layer"
   can be misread as a queued rejection leaving the built-in optimistic layer
   installed (it does not). Wording only. Related follow-up: `useSnapbackQueries`
   (plural) still keys on `entries` identity — same shape as the fixed
   inline-args hazard, pre-existing and outside the fixed tickets' scope;
   assess whether group entries need the content-key treatment.

## Dated note — 2026-08-10 (5 of 6 landed)

Landed: LLP 0208 ticket links corrected; pre-witness search references now
refuse with the explicit "regenerate the app references" hint (package
regression proves refusal before I/O); the `userId` resourceArg/auth-slot
collision documented in LLP 0131 + the text-search page; the React
queue-wedged warning no longer falsely names a specific mutation as the
blocking head (regression added); the React page clarifies that every
rejected attempt (incl. SNAPBACK_REACT_MUTATION_QUEUED) removes its built-in
optimistic layer. Remaining in this ticket: the
expectedArgsContractHash/carriedArgsContractHash compat-alias rename (ticket's
own "after one release" caveat — do at/after the next release cut), plus the
noted follow-up that `useSnapbackQueries` still memoizes on `entries` object
identity rather than a content key.
