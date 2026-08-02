# PUSH-01b: make the optional push registry additive

**Status:** Open
**Systems:** JS client, Packaging, Bundle metrology
**Related:** LLP 0143 D6, LLP 0145 Phase A,
`issues/20260802-push-01-0143-implementation.md`

## Defect

The PUSH-01a landing put installation-id generation, token validation, registry
methods, and `client.push` construction in the root `@expo/snapback-client`
module. Applications that never select notifications therefore retain the push
runtime. The primary bundle fixture reports the closure as roughly 3.3 kB
minified / 0.9 kB gzip before the rest of the root client is considered. This
contradicts LLP 0143 D6 and the additive-capability posture measured by LLP
0145.

## Required repair

- Move the registry runtime and declarations to an explicit
  `@expo/snapback-client/push-registry` subpath.
- Require an explicit attachment call; the root constructor and root namespace
  must expose no push-shaped property or export.
- Keep the request funnel package-private and preserve all ordinary public
  method behavior and arity.
- Add positive attachment and negative root-closure profiles without rewriting
  LLP 0145's immutable primary baseline. Freeze those profiles only after the
  implementation commit exists so the supplemental receipt names the exact
  source revision it measured.
- Prove register/unregister custody, validation, token non-disclosure, external
  bearer fencing, public surface shape, and every existing primary bundle
  ceiling.

## Running log

- **2026-08-02 — reproduced.** Commit `769e7139` exposes `client.push` from
  every root client and closes over the registry implementation in the root
  bundle even when the application never imports a push-specific entry point.
- **2026-08-02 — repair prepared.** The implementation is split into an
  explicit additive subpath with root-negative type/runtime fixtures and a
  versioned prospective metrology ledger. The immutable primary baseline and
  its committed current receipt remain byte-identical pending the repair
  commit.
