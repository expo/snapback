# guide-gap: no recipe for binding server principals to app-owned identities

**Opened:** 2026-08-08 · **Severity:** P3 (guide-gap; the largest identity friction cluster)

The sessions guide documents `ctx.auth.userId`, dev minting, logout, and
bearer replacement, but gives no recipe for the thing every ported app
needs first: securely populating a principal-to-app-user table when the
app carries its own user identity scheme. Handler auth exposes the
verified principal but not the verified mint email, so an in-handler
claim cannot prove which app row a principal owns. The Zerobugs control
confined this to an acceptance-only bootstrap (`W-IDENTITY`: frozen
actor map, one-to-one refusal, closure sentinel, gateway omission) — fine
for a harness, not an answer for products, which still need a trusted
identity claim or privileged provisioning path.

Ask: an intent-indexed guide page for principal↔app-identity binding
(acceptance-harness pattern AND the production external-broker pattern),
plus consideration of exposing verified identity claims to handlers.
Owner seam: the LLP 0183 review round flagged identity as a cross-cutting
contract needed by D2 authorization, D3 partitions, and D5 guards — not a
D7 afterthought.

- **Claimed 2026-08-08:** session dc26442d (13-ticket sweep orchestrator) is executing this ticket now; sibling sessions should not duplicate.

## Partial resolution — 2026-08-08 (guide page landed; platform ask remains)

**The docs ask is done.** New page
[`guide/auth/app-identity-binding.md`](../guide/auth/app-identity-binding.md)
— *"Bind a principal to your app's user identity"* — linked from the guide
index under Auth, claiming `auth.sessions` + `auth.external-identity-broker`,
`maturity: partial`, `targets: [local]`.

It is intent-indexed on the port's actual first question and leads with the
reason the obvious approach is wrong: `ctx.auth` carries the resolved
principal and **not** the verified mint email or external subject, so a
`bindMe({ sourceUserID })` mutation is an authentication bypass. From that
the page derives the rule — the binding row must be written by code that
already knows *both* sides — and then teaches both sanctioned shapes:

- **The binding table**, with unique indexes on all three sides (principal,
  app user id, external id), not just `by_principal` — transcluded from the
  control's `identityBinding` declaration.
- **Resolving the principal in every protected handler** (`requireSourceUser`
  / `requireCrew` / the zero-argument self query), including why roles come
  off the resolved app row rather than the session, and how this composes
  with `authScopeField` and scoped roles (those compare principals).
- **Pattern A — production: bind in the trusted identity broker.** The
  broker is the only component holding the verified identity, the app user
  row, and the just-minted principal at once, so it writes the binding under
  privileged authority before releasing the bearer. Includes the two
  load-bearing properties (privileged non-public mutation kept out of any
  function allowlist; bearer released only to the authenticated caller) and
  the honest boundary that `auth.mintSession` is currently a dev/test/demo
  host operation.
- **Pattern B — acceptance harness: a frozen actor map** (this ticket's
  W-IDENTITY), decomposed into the five properties that make it safe —
  frozen actor map, complete-fixture precondition, one-to-one refusal on
  both sides, set closure, gateway omission — with the closure/refusal code
  transcluded, the idempotent-rerun rule, and an explicit *"this is a harness
  pattern, not a product answer"* fence.
- **Reset reissues principals**: never seed binding rows; the
  reset → load → mint → bind order and why the dependency is circular.
- Six anti-patterns, and an explicit *"What Snapback does not give you yet"*
  section that states the platform gap in the guide itself rather than
  leaving it implicit.

Evidence honesty: the control's binding surface is exercised by its own
`test:lane2` / `test:lane2:live` suites and the retained ZB receipts under
`demos/zerobugs/evidence`, **not** by repository CI. The page says so
(`demos/zerobugs/control` is not in `EXPECTED_DEMO_IDS`, since
`scripts/demo-setup` scans only one level under `demos/`). Snippets are
transclusion-verified, so drift in the control breaks the guide check.

Landed with it: `guide/capabilities.md` `auth.sessions` aliases gained
`principal binding, app user table, identityBinding` (grep vocabulary,
LLP 0187 T1 ii), and `guide/retrieval-eval.md` gained seed case 19 whose
failure condition is exactly the bypass above.
`node scripts/check-guide.mjs` is green.

**Remaining — graduate-worthy platform ask.** Exposing verified identity
claims to handlers (the verified email/subject the session was minted from),
or a declared privileged provisioning path for binding rows, so an app can
write the binding inside Snapback instead of in an out-of-band broker. That
is cross-cutting contract work, not docs: the LLP 0183 review round flagged
identity as a contract needed by D2 authorization, D3 partitions, and D5
guards. It touches LLP 0057 (provider protocol), LLP 0058 (invocation
authority), and the auth-mode readiness projection, and it needs a named
owner and sequencing — i.e. it wants Linear (Exact project, Snapback label),
not this file. Ticket stays open until that is filed or ruled out.
