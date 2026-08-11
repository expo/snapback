# Signed trusted-composition-activations need re-mint after the S0 codegen toolchain rotation

- **Date:** 2026-08-09
- **Source:** LLP 0204 S0 landing (user-reachable agent registration)
- **Systems:** codegen, demos, drift gates

## What happened

S0 (LLP 0204 — manifest `auth.agents`, agent registration/invitation routes)
changes `packages/snapback-codegen` and the manifest schema, which rotates the
codegen `inputsHash` for **every** committed backend. All demo `generated/`
trees were regenerated and landed with S0, **except** the four backends that
carry a signed `trusted-composition-activation.json` (LLP 0087 facets):

- `demos/latency-kanban/snapback`
- `demos/triage-graph/snapback`
- `demos/fleet-observatory-move1/snapback`
- `demos/zero-bakeoff/apps/contention-calendar/snapback`

Their activations bind the pre-rotation generation (`schemaHash`/`bundleHash`/
`inputsHash`), so `packages/snapback-codegen/index.mjs` fails them with
`TRUSTED_COMPOSITION_ACTIVATION_INVALID` under the new toolchain. Re-minting
is a signed ceremony bound to each demo's acceptance run (for latency-kanban:
`tests/acceptance/latency-kanban-move3-v1.mjs`) — not something an unrelated
landing should fake. These four demos were left at their old committed
generation (bit-identical to before S0).

## Consequence

`scripts/check-generated-artifacts` (and the pre-push generated-artifacts
drift gate, when path-selected) fails at the first of these four backends
until the activations are re-minted. The S0 landing used the documented loud
bypass (`SNAPBACK_DRIFT_GATES_BYPASS=1`) for exactly this gate, with this
ticket as the record. The `com.snapback.drift-backstop` schedule will keep
reporting the staleness until resolved (it dedupes against this open ticket).

## What to do (demo owners)

For each backend above, after the S0 toolchain is on main: re-run codegen,
re-run the demo's acceptance ceremony, and re-mint/commit the signed
`trusted-composition-activation.json` for the new generation together with the
regenerated `generated/` tree. Consider also whether the activation format
should bind a toolchain-stable identity instead of the raw `inputsHash`, so
routine codegen changes stop invalidating signed ceremonies (that design
question belongs to LLP 0087's owner).

## Dated note — 2026-08-09, unique-where-present landing (Lane B)

The LLP 0007 unique-where-present landing rotates the manifest schema
again (`whereApplicable` on `IndexManifest`), which joins this ticket's
blocked class: the `local-store-publication` carrier refresh
(`scripts/finalize-local-persistent-store-publication`) transitively
requires re-minting the triage-graph/fleet-observatory receipts, whose
demos cannot regenerate until their signed activations are re-minted
under this ticket's ceremony. Per the S0 precedent recorded above, the
landing uses the documented loud bypass; the carrier refresh and receipt
re-mint fold into this ticket's resolution ceremony (which should run
once, after the structured-stored-values landing that rotates the schema
a third time today).

## Dated note — 2026-08-10, remint ceremony (3 of 4 complete)

Re-minted through their full acceptance ceremonies on the current toolchain
and landed together: `demos/triage-graph` (8/8), `demos/fleet-observatory-move1`
(8/8), `demos/latency-kanban` (5/5). The downstream carrier chain is re-greened
(see the two closed local-store tickets). Still outstanding:
`demos/zero-bakeoff/apps/contention-calendar` — its rung-2 ceremony failed
twice on the "alice provisional paint missed one frame" latency assertion
under heavy machine load (load average ~200, concurrent agent fleet); the
committed tree keeps its pre-rotation generation bit-identical. Re-run
`tests/acceptance/contention-calendar-rung2-v1.mjs` on a quiet machine to
finish this ticket. The toolchain-stable-identity design question for
LLP 0087's owner remains open.

## Dated note — 2026-08-10 (post-ceremony rotation re-blocks; third bypass landing)

The c45e5215b ceremony's activations are invalid again at current main:
`triage-graph`, `fleet-observatory-move1`, and `latency-kanban` codegen all
refuse `TRUSTED_COMPOSITION_ACTIVATION_INVALID` (a post-ceremony landing
rotated codegen inputs once more). The lane C+A landing of 2026-08-10
(client fixes: pre-witness search refusal + connection-id refusal) rotates
`packages/snapback-client/index.mjs`, which the triage/fleet Move-1 and
local-store carrier-exit receipts pin; those re-mints are activation-blocked,
so the landing used the documented loud bypass per this ticket's S0
precedent. The resolution ceremony now owes: fresh activations for all four
demos at the current toolchain, then triage → fleet → carrier-exit re-mints
picking up the new client pin, then
`scripts/finalize-local-persistent-store-publication`.

## Dated note — 2026-08-10 (design question re-routed and drafted)

The toolchain-stable-identity question was mis-routed to LLP 0087 (a
parked hosted-adoption Plan). The activation format is owned by LLP 0157,
and a full PROPOSED design now sits there:
"Proposed amendment — 2026-08-10: toolchain-stable activation identity"
(`snapback.composition-activation.v2`: bind `authoredSourceHash` for
admission, demote the minted generation to an audited provenance record).
One author ruling decides it; if accepted, the v2 implementation lane's
final ceremony re-mints the four demos and discharges this ticket's
recurring class — the fourth same-day rotation of this treadmill would
otherwise keep re-blocking every client-touching landing (five bypass
landings recorded above as of tonight).

## Dated note — 2026-08-10 (RULED: v2 adopted)

Charlie ruled for `composition-activation.v2` (LLP 0157 amendment, now
RULED): admission binds `authoredSourceHash`; generation drift becomes an
audited `activationGenerationAdvanced` marker instead of an invalidation.
Implementation commissioned; this ticket's resolution ceremony becomes the
v2 re-mint of the four demos, after which routine toolchain rotations stop
re-opening this class.

## Resolution — 2026-08-10 (v2 ceremony complete; class retired)

All four demo activations re-minted to `snapback.composition-activation.v2`
under the RULED LLP 0157 amendment, each through its full acceptance run:
latency-kanban 5/5, triage-graph 8/8, fleet-observatory-move1 8/8,
contention-calendar 8/8 (the previously flaking rung passed on this run).
Carrier chain requalified: local-store-carrier-exit 17 PASS / 0 GAP,
finalize published, conformance green, custody checker 110 pass / 0 fail.
Under v2, admission binds `authoredSourceHash`; future toolchain rotations
record an audited `activationGenerationAdvanced` marker instead of
invalidating the ceremony — the recurring class this ticket tracked (five
bypass landings in two days) cannot recur. Closing.
