# Wave-1 remainder: implement LLP 0134 — capability maturity promotion

**Status:** Closed
**Systems:** Testing, Deployment, Runtime
**Related:** LLP 0134, LLP 0058, LLP 0115

## Resolution — 2026-08-02

Implemented the first LLP 0134 process machinery without promoting a
capability:

- Rust maturity assignment is exhaustive—there is no `_ => Stable` path—and
  the codegen experimental mirror is byte-compared through canonical emissions.
- The five-member grandfathered-direct reservation is closed in Rust and in
  the record validator while granting no maturity by membership.
- `tests/acceptance/maturity/` is the closed record root. All six suffix schemas
  validate as canonical JSON with reopenable digest locators; default-route
  soak evidence enforces every local profile/day cell and every hosted
  deployment extract.
- Promotion and `MaturityDemotionRecordV1` paths enforce
  `candidateSourceSha == candidateParentSha == sole parent`; promotion also
  recomputes `stagedTreeManifestSha256`. A committed git-history acceptance
  drives the real atomic `bounded_children_v1` + `write_activity_v1` ids through
  fourteen observations, promotion, gate regression, and fast-path demotion.
- A real current-main `inline_handler_v1` local observation starts the honest
  non-retroactive soak record. It is evidence for one day, not a promotion or a
  fabricated fourteen-day history. The intended atomic relation/activity
  observation was refused after its mandatory suite found a source-carrier
  digest regression; that exact failure is retained in the open filesystem
  ticket rather than mislabeled green.
- LLP 0134's header and in-document Status section were already aligned as
  Accepted on the fetched candidate (the ticket's drift claim had been fixed by
  another main landing); this change preserves that correction and adds the
  dated implementation record. LLP 0115's CV-8 board row is updated in lockstep.

One item remains explicitly design-blocked rather than stubbed as green: LLP
0134 §4 asks a registry comment to cite the receipt digest while the receipt
binds a tree containing that comment. The implementation record explains the
cryptographic self-reference. A1/A2/A5 still validate registry parity, the
same-commit record, sole parent, changed ids, and the complete landed tree, but
the redundant comment-digest comparison awaits a dated digest-domain
correction before the first real promotion.
