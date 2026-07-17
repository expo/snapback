# Validate membership activation after DDL and seed on every deployment path

**Status:** Open
**Severity:** P1
**Systems:** RBAC, Memberships, Deployment, Schema activation, Storage
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Declaring a membership table
**Marker:** security, data-integrity

The membership activation scan does not validate the transaction's final
state, and several deployment paths do not run it at all.

`validate_membership_activation` in `src/storage.rs` skips an absent membership
table or absent key columns and performs referential/`lastHolder` checks only
when an optional `resourceTable` happens to name an existing table. Schema
validation does not require `resourceTable` for resource scope.

In `src/storage/auth_mode.rs`, staged and raw-dev flows call the validator
before `apply_schema_ddl` and before seed. Same-mode dev and same-mode network
deployment apply DDL and seed without invoking it. A fresh `lastHolder`
declaration over populated resources can therefore activate with an absent
roster, after which the transaction creates an unprotected final state. A
missing `resourceTable` also silently disables referential, bootstrap, and
resource-deletion guards.

**Done when:**

- One shared validator runs after DDL and same-activation seed, but before
  manifest/deployment metadata commits.
- Dev apply, staged transitions, same-mode sessions deployment, network
  provisioning, import, and restore all use that entry point.
- Resource-scoped declarations require a resolvable active `resourceTable`;
  missing, misspelled, or dangling bindings refuse with a typed diagnostic.
- An absent/new membership table is evaluated as an empty roster, so populated
  protected resources require holders in the same activation.
- Generated unique indexes are installed only after typed duplicate/null/role
  diagnostics have run.
- Until these guarantees are complete, production activation of a hand-built
  membership manifest is capability-gated rather than partially enabled.
- Tests cover fresh schema, brownfield schema, same-transaction seed, and every
  deployment carrier.
