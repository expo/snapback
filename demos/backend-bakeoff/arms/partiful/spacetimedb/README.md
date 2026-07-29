# Partiful-shaped event app — SpacetimeDB deep arm

This isolated LLP 0102 arm implements the frozen Partiful-shaped event prompt
directly on SpacetimeDB 2.7.0. The server uses private source tables,
identity-aware public views, transactional reducers, a native scheduled
procedure, and procedure HTTP effects with a durable idempotency ledger.

The React client reads `public_preview` through generated bindings. The
acceptance harness drives distinct Alice, Bob, Mallory, and Casey identities
and retains direct authority, transport, settlement, contention, effect, asset,
revocation, performance, target, and cleanup evidence under `evidence/`.

The local target name is exactly `llp0102-partiful-spacetimedb-w2`. No
Maincloud claim is made because the frozen credential inventory records that
credential as unavailable.
