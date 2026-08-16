# No local-development mint path for the signed visibility-governance target config

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
