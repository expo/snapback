# Retrieval eval run — 2026-08-10 — session-mint identity broker (seed case 41)

**Protocol:** guide/retrieval-eval.md (LLP 0061 §5; seed case added by
LLP 0223 ticket 3 from the Clique P2 pilot regression in which the
`auth.mintSession` HTTP request shape was learned by observation — every
documented guess refused with `SNAPBACK_AUTH_REQUEST_INVALID` — recorded in
`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md` and
`issues/closed/20260809-scaffold-env-autowrite-and-mint-docs.md`).
**Fixture:** fresh Claude subagent with no inherited conversation context,
cold in the LLP 0223 execution worktree (origin/main `45044929b` plus the
ticket 1/2 changes under review, immediately before landing), instructed to
read `AGENTS.md` first and then plan (read-only) a trusted server-side
identity broker: authenticate the user at the broker's own front door, mint
a Snapback session for that user over HTTP, and return the bearer to that
same user.
**Run:** `guide/index.md` at tool use 2, `guide/auth/native-apps.md` at tool
use 3, `guide/operating/host-ops.md` (the "Mint a session over HTTP"
section) at tool use 5. Thirteen tool uses total.

## Rubric

- **(a) Loads the relevant guide page within ~15 tool uses: PASS.**
  `auth/native-apps.md` at tool use 3 straight from the index's auth
  section; a grep for "mint" in `operating/host-ops.md` at tool use 4
  (following native-apps' pointer to the canonical HTTP shape) put the
  mint section on screen at tool use 5. Both expected pages loaded well
  inside budget.
- **(b) Plans with the paved technique: PASS.** The plan reproduces the
  documented contract exactly: `POST /_snapback/api/host-ops` with
  `content-type: application/json`, `x-snapback-admin-token`, and
  `x-snapback-impersonation-capability`; the closed body
  `{"operation":"auth.mintSession","args":{"email":"…"}}` with `email` as
  the single required member; outcome read from the `hostOpsResult`
  envelope's `ok`/`diagnostics[]` rather than the HTTP status; the five
  success `data` members named; bearer adoption through
  `createExternalSessionClient` (JS) / `Configuration.sessionBearer`
  (Swift); rotation via `replaceBearerToken` on `refreshAfter`. It also
  routed the sibling concern correctly — the principal↔app-user binding row
  goes through `auth/app-identity-binding.md` Pattern A inside the broker —
  and stated the honest scope boundary (non-production mint, no hosted
  identity claim).
- **(c) Avoids the named anti-patterns: PASS.** No request-body guessing:
  the exact shape and its refusal semantics were cited from the mint
  section, including that `SNAPBACK_AUTH_REQUEST_INVALID` details carry the
  expected contract. Authority carriers were complete and precisely
  located (AdminWrite token server-side; the impersonation capability read
  from the owner-only `<ready-file>.impersonation` sibling). Operator
  credentials in the app bundle, a client-supplied mint email, a generic
  unauthenticated mint endpoint, and phone-side mailbox reads were each
  explicitly prohibited. The CLI projection (`snapback session mint`)
  appeared only as the guide's own paved alternative where the broker can
  invoke it, not as a per-login implementation workaround.

**Verdict: PASS.** The pilot failure mode (guess → refuse → guess) did not
reproduce: the exact request shape was retrieved before any request would
have been written, and both expected pages were the sources the plan cited.

## Agent tool transcript

1. Read `AGENTS.md` — steered to the guide.
2. Read `guide/index.md` — auth section named native-app entry shapes.
3. Read `guide/auth/native-apps.md` — broker seam, three authorities,
   pointer to the canonical HTTP shape.
4. Grep for "mint" in `guide/operating/host-ops.md`.
5. Read `guide/operating/host-ops.md` (lines 1–200, the mint-over-HTTP
   section).
6. Read `guide/auth/app-identity-binding.md` — Pattern A binding row.
7. Grep guide for "impersonation" (page inventory).
8. Read `guide/auth/sessions-and-principals.md` — settled-Sessions
   boundary, test personas.
9. Grep `guide/clients/headless.md` for `createExternalSessionClient`
   (parallel with 10).
10. Grep `guide/clients/swift.md` for `sessionBearer`.
11. Read `guide/clients/headless.md` (external-session construction).
12. Grep `guide/getting-started/the-authoring-loop.md` for the readiness
    descriptor.
13. Read `guide/getting-started/the-authoring-loop.md` (ready-file and
    impersonation-sibling custody).
