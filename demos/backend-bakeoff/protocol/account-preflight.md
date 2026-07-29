# Hosted account and identity preflight

Account login is no longer a universal Stage 0 gate after the author-approved
2026-07-28 shared/free-target amendment. Do not create an application target,
initialize provider files, or pull a provider stack during this preflight.
Those actions begin inside the assigned arm's timed window.

From `demos/backend-bakeoff`, authenticate through the provider's ordinary
browser or interactive flow:

```sh
npx supabase login
npx firebase login
npx instant-cli login
npx appwrite login
$HOME/.local/bin/spacetime login
```

Convex 1.42.3 has no standalone login command. Confirm that the Convex
dashboard is reachable in the intended account; `npx convex dev --configure
new` performs the CLI account/project binding inside the first Convex arm.

`~/Dropbox/APIKeys/dogfood-matrix-secrets.md` contains credentials for an
existing Supabase project, Convex deployment, and InstantDB app. They prove
those shared targets are addressable. Supabase and Convex may be used only
after an arm-specific namespace, redacted pre-write baseline, scoped mutation
plan, and baseline-preserving cleanup plan are recorded. Never copy values into
the repository, delete a shared target, or mutate outside the bound namespace.

The optional read-only check below probes service health or target metadata,
discards all provider output, and prints only coarse reachability statuses:

```sh
npm run preflight:shared-targets
```

Then run:

```sh
npm run preflight:credentials
```

The preflight captures command output in memory and discards it. Its stdout
contains only `ready`, `missing`, `indeterminate`, or
`configured-unverified`, plus booleans. It never prints account emails, tokens,
project identifiers, billing identifiers, or CLI configuration.

## Native-auth personas

Provide three distinct deliverable email addresses for:

- Alice — authorized owner/member;
- Bob — authorized second member; and
- Mallory — outsider.

One inbox with three plus-address aliases is acceptable if all three messages
remain distinguishable. Native local/emulator identities and namespaced
non-deliverable test addresses are also acceptable when email delivery is not
the acceptance fact under test. Put deliverable values under a `Backend bakeoff` heading in
the already-ignored root `.agent-local-secrets.md`; do not add them to a
tracked protocol file, shell command, diary, receipt, or run capsule.

## Paid-plan authorization

The frozen hosted defaults currently imply:

- Supabase Pro with Micro compute: $25/month;
- InstantDB Pro: $30/month;
- SpacetimeDB Maincloud Pro: $25/month;
- Appwrite Pro: from $25/month;
- Convex Starter: usage above included resources; and
- Firebase Blaze: usage-based.

The fixed-plan baseline is approximately $105/month before usage and taxes.
Paid plans are not authorized or required by default. Use free, local, emulator,
or approved shared targets. If a later arm genuinely requires a paid capability,
record explicit author authorization in `.agent-local-secrets.md`, not account
or card details, before incurring cost.

## Readiness rule

Stage 0 becomes ready when:

- all local tool statuses are `ready`;
- every provider has at least one preflighted execution mode: fresh local,
  emulator, fresh free hosted, or namespace-isolated shared hosted;
- any unavailable hosted profile is recorded as missing evidence rather than a
  product failure;
- personas can be created through the selected mode's native development path;
- exact plan/region choices are confirmed before provisioning; and
- `npm run freeze && npm test` passes with `readyForTimedArms: true`.
