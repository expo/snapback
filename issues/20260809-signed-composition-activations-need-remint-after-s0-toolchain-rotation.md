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
