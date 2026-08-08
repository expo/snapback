# Commission the coordinating identity-architecture Decision + three owner amendments (LLP 0191 OQ2, ruled)

**Opened:** 2026-08-08 · **Ruling:** LLP 0191 "Author rulings" #2, Charlie Cheever 2026-08-08 (distributed structure)

One short coordinating **Decision** LLP defining the identity vocabulary —
namespaces, provenance, uniqueness, mutability, conversion rules — with
implementation authority distributed as amendments to the owners:

- **Schema owner:** declared source keys (unique app-public ids the
  generated tier can address), identity columns with *sequence* semantics
  (monotonic, gaps allowed; a display/permalink identity, not the
  canonical relationship key), defaults, alternate-key lookup. Tickets:
  `20260808-numeric-identity-default-columns.md`.
- **Auth/D7 owner:** verified principal-claim surface bound to immutable
  provider `(issuer, subject)` (email is a mutable attribute), or a
  privileged provisioning channel; which claims are exposed is a
  deliberate trust-boundary decision. Ticket:
  `20260808-guide-gap-principal-to-app-identity-binding.md`.
- **D5/effects owner:** read-only server-bound settlement identity on the
  handler context, namespaced to app/instance/operation — never a raw
  client-chosen global effect key. Ticket:
  `20260808-handler-settlement-identity-surface.md`.

Constraints from the ruling: one Zerobugs port acceptance corpus covering
all three lanes; LLP 0129 retains sole admission authority over any
mutation-IR consequences; the Decision holds vocabulary and conformance,
not implementation.

Evidence base: LLP 0191 §3 (four workaround clusters: W-IDENTITY,
W-MUTATION-IR, W-SHORTID, settlement identity).
