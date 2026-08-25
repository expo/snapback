# Normalize hosted-target Tigris partial-credential diagnostic spellings

Status: Open — separate compatibility change
Created: 2026-08-25
Related: `packages/snapback-hosted-supervisor/target-onboarding.mjs`, LLP 0111,
LLP 0193

## Problem

The private `ensureTargetTigrisRole` helper currently constructs its refusal at
runtime:

```js
`SNAPBACK_HOSTED_TARGET_TIGRIS_${roleStem.toUpperCase()}_PARTIAL`
```

That template has six possible role spellings, but no complete literal code for
the diagnostics registry to inventory. It also produces
`SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL-STATE_PARTIAL` for the `control-state`
role, which does not follow the stable diagnostic spelling grammar.

The registry lane briefly replaced the template with six literals and exported
the Tigris role helper for testing. That was reverted: exporting a helper that
accepts arbitrary provider actions would widen LLP 0111's closed
role→verb→resource authority matrix, and changing the thrown message is a
runtime compatibility change outside the environment-classification repair.

## Proposed compatibility change

Keep `ensureTargetTigrisRole` private and keep every provider action derived
from the existing closed `TARGET_TIGRIS_ROLES` matrix. Add a private, exhaustive
role-to-code lookup used only by the partial-credential refusal:

- `artifact` → `SNAPBACK_HOSTED_TARGET_TIGRIS_ARTIFACT_PARTIAL`
- `backup` → `SNAPBACK_HOSTED_TARGET_TIGRIS_BACKUP_PARTIAL`
- `control-state` → `SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL_STATE_PARTIAL`
- `audit` → `SNAPBACK_HOSTED_TARGET_TIGRIS_AUDIT_PARTIAL`
- `logs` → `SNAPBACK_HOSTED_TARGET_TIGRIS_LOGS_PARTIAL`
- `cleanup` → `SNAPBACK_HOSTED_TARGET_TIGRIS_CLEANUP_PARTIAL`

Do not export the lookup or the credential-creation helper. Test the private
behavior through the existing onboarding surface or a module-local test seam
that cannot create or attach IAM policy. Treat the `control-state` message
normalization as an explicit compatibility change, regenerate diagnostics,
symbol, and Guide projections, and record the old spelling's disposition.
