# Normalize hosted-target Tigris partial-credential diagnostic spellings

Status: Closed
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
the diagnostics registry to inventory. It also puts a hyphen between `CONTROL`
and `STATE` for the `control-state` role, which does not follow the stable
diagnostic spelling grammar.

The registry lane briefly replaced the template with six literals and exported
the Tigris role helper for testing. That was reverted: exporting a helper that
accepts arbitrary provider actions would widen LLP 0111's closed
role→verb→resource authority matrix, and changing the thrown message is a
runtime compatibility change outside the environment-classification repair.

The registry now records the five grammar-valid finite spellings (`artifact`,
`audit`, `backup`, `cleanup`, and `logs`) with explicit dynamic-emission
markers while leaving the runtime template unchanged. The `control-state`
role still produces the unregisterable hyphenated spelling and remains the
compatibility change owned by this ticket.

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

## Resolution (2026-08-26)

`target-onboarding.mjs` now uses a private exhaustive mapping for all six
closed Tigris roles. The `control-state` entry emits the registered
`SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL_STATE_PARTIAL` spelling; the other five
roles retain their existing codes. `ensureTargetTigrisRole` and the mapping
remain private, and `TARGET_TIGRIS_ROLES`, `targetRolePolicy`, and every IAM
action/resource decision are unchanged.

The existing onboarding test reads the module text as a non-executing test seam
and pins all six exact role-to-code pairs. It cannot invoke credential creation
or policy attachment. The diagnostics-registry projection test separately pins
all six spellings to the private dynamic throw site and keeps the hyphenated
spelling absent.

The old output with a hyphen between `CONTROL` and `STATE` is retired, not
aliased or reserved: it never satisfied the registry grammar and therefore was
never a valid diagnostic identity. The old hyphenated message is gone and no
alias for it is emitted. Consumers must use the underscore form.
