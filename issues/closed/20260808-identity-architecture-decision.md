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

- **2026-08-08, schema lane:** `20260808-numeric-identity-default-columns.md`
  now carries a worked design proposal for the identity-column half —
  substrate (extend LLP 0135's `_snapback_sequence_counters_v1` with a
  table-scoped counter identity under a successor profile, rather than a
  second counter authority), gap semantics, the client-supplied-value posture,
  exhaustion, indexing, the non-empty-table evolution cost, and naming — plus
  the two standing fences the Decision has to clear (LLP 0135 §1.1 "no
  authored start" and §1.9 "no cross-scope or global counter"). Consume it
  rather than re-deriving. LLP 0007's 2026-08-08 amendment records the same
  boundary in the storage authority.

## Author greenlight — 2026-08-10

Writing this Decision is greenlit now, and the schema lane's worked proposal
is endorsed wholesale — see the author ruling recorded in
`issues/20260808-numeric-identity-default-columns.md` (sequence semantics,
server-owned always, non-empty-table refusal in v1, `v.serial({ start })` as
the working spelling). That ticket lands as this Decision's first
schema-owner amendment.

- **2026-08-10:** the coordinating Decision now exists as Draft —
  `llp/0226-identity-architecture.decision.md` (namespaces, conversion rules
  C-1–C-6, mint conformance M-1–M-5, the LLP 0135 fence clearance, the three
  owner lanes, and the `v.serial({ start })` spelling ruling).

## Resolution — 2026-08-15 (backlog sweep)

The coordinating vocabulary Decision is Accepted
[LLP 0226](../llp/0226-identity-architecture.decision.md) (`v.serial({ start })`,
namespaces, conversion/mint conformance, owner-lane split). This ticket asked
for that Decision, not the owner implementations. Schema work remains on
`issues/20260808-numeric-identity-default-columns.md`; auth-claim exposure
remains on `issues/20260808-guide-gap-principal-to-app-identity-binding.md`.
