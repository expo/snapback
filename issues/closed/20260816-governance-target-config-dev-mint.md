# No local-development mint path for the signed visibility-governance target config

**Status:** Closed
**Opened:** 2026-08-16
**Severity:** P2 (blocks live governed-activation acceptance runs; unit/fixture coverage exists)
**Systems:** Security/authorization, Tooling, Testing

Once a backend's manifest carries a visibility-governance activation carrier,
`snapback serve` demands `SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG`
pointing at a target-owned signed configuration (Ed25519-signed verdict bound
to the source OID) — by design, with no boolean downgrade
(`src/visibility_governance.rs`). There is no repository tool that mints a
local-development/fixture config, so demo acceptance runs stop at
`SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE` (hit by the
LLP 0240 rollout lane's rbac acceptance attempt).

LLP 0234's D4 review round anticipated exactly this: the fixture-profile
attestation needs a named local-development default. The unit tests construct
signed fixtures with test keys; extract that construction into a script (e.g.
`scripts/mint-visibility-governance-dev-config.mjs`) that mints a
fixture-profile-fenced config for repository-registered apps, refuses
production/hosted target classes, and is documented on the relevant guide
page. Then rerun the rbac roster acceptance live (also closes the G0
"alternate-scope storage e2e" residual path).

## Resolution (2026-08-16)

Implemented, then hardened after dual review,
`scripts/mint-visibility-governance-dev-config.mjs` and the
packaged `visibility-governance-dev-config` helper. The producer creates a
fresh Ed25519 keypair and green verdict bound to the current generated schema,
function bundle, governance activation, and quarantine checkpoint. It admits
only `repository-local`, requires exact-set equality between generated fixture
profiles and the complete five-field tuples pinned by the committed app
registration, and refuses hosted/production classes or any production override
lifecycle. This registry is deliberately only the producer's mint-time allowlist;
it is not described as the D4 host fence.

The D4 host fence is reader-side. The native startup adapter threads its
independently resolved `ServerProfile` (including fail-closed unknown profiles,
fronted defaults, and non-loopback defaults) into activation validation. A dev
provider config is accepted only for `Dev`, `Demo`, or `Test`, exact
`repository-local` metadata, and an empty production-window set. Missing,
empty, or unsupported `providerProfile` values refuse. Ambient inherited target
config paths are not caller custody, and dev-minted paths are never forwarded
to a production-resolved child.

`snapback dev` and `demos/_kit/server-process.mjs` now supply the owner-only
dev config automatically while retaining the carrier-required validation
path. Coverage is named by
`todo and rbac prime to schema-valid exact-identity signed dev configs`,
`primed_todo_and_rbac_dev_mints_validate_from_target_and_tampering_refuses`,
`repository_local_dev_provider_refuses_production_and_hosted_targets`,
`activation_requires_provider_profile_and_exact_source_oids`,
`freshly primed todo binds through snapback dev with an auto-minted config`,
and `freshly primed todo cold-start carrier binds through the demo kit`.

The rbac live bind reaches governance admission but remains stopped by the
inherited membership-grammar `_id` resource-field red recorded in this lane's
report; its real primed config is validated through the Node producer and Rust
target-reader tests above.
