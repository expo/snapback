# Probe: does `binding-rotated` fire on a schema successor under supervised `--expo`?

**Filed:** 2026-08-26 · **Resolved:** 2026-08-26
**Systems:** React/Expo, CLI, Local server lifecycle, Testing
**Revised:** 2026-08-26 (no longer a gate: the ordering defect is established
from source; this probe corroborates the interleaving)
**Owner:** LLP 0310.000 Track A / acceptance A0
**Related:** `issues/20260825-successor-expo-receipt-stale.md` (corroborated by,
  **not blocked on**, this probe), LLP 0310 F1 / P1 / P19

## Why

`rotateBindingAfterLoad` (`packages/snapback-cli/expo-dev.mjs`) already remints
the supervised binding on `generated-and-loaded` and emits `binding-rotated`,
and `guide/clients/react-expo.md#know-what-the-supervisor-owns` documents it.
The 0.1.27 Clique explicit lane nonetheless hit
`SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` after a legal same-owner schema
successor — but retained only suite and choreography receipts, so **no `snapback
dev --json` stream exists**.

**This probe is not a gate.** The supervisor-side ordering defect is
established from source: `generateApp` publishes the successor graph into
`generated/` (Metro-visible), `loadGenerated` flips serving identity, and only
then does `generated-and-loaded` trigger the remint — both exposure events
precede publication of the successor binding. Track A proceeds on that. What
the source cannot settle is the **interleaving** in this run: Metro HMR and the
provider re-boot are asynchronous and unordered against the remint. That is
what this probe records.

## Probe

Reproduce a schema successor under `snapback dev --expo --expo-platform web`
with stdin `/dev/null` and no owner restart. Retain the full `--json` event
stream. Record:

1. Was `binding-rotated` emitted? With which `previousDescriptorIdentity` and
   `descriptorIdentity`?
2. Was `generated-and-loaded` emitted to the Expo arm at all after
   `startup-successor-activated`?
3. What did the next `GET /_snapback/expo/v1/bootstrap` return?
4. What binding did the client admit, and against which imported descriptor?

## Retired hypothesis

An earlier revision led with "a schema successor is untested." That was wrong
on both halves. The rotation predicate is
`successor.identity.descriptor !== descriptor.identity.descriptor`, which a
functions edit changes exactly as a schema edit does, so schema-vs-functions was
never the discriminator. And the existing test
(`packages/snapback-cli/expo-dev-loop.test.mjs`, label *"supervised binding
rotation after functions edit"*) does more than that filing credited: it waits
for `binding-rotated`, fetches the next bootstrap exchange, waits for Metro to
serve the successor bundle, and drives a **fresh** successor boot. The real
coverage hole is that no test holds an **already-running** arm across a
successor — which is LLP 0310.000 acceptance A1/A3, not this probe.

## Done when

The four observations above are recorded as a retained artifact, and LLP
0310.000 OQ6 is answered.

## Resolution — 2026-08-26

Ran. `tests/probes/successor-binding-rotation-20260826/` retains the full
`--json` stream (`events.jsonl`), 208 paired samples of both sides of the
`admitAppBindingV1` predicate (`samples.jsonl`), the four observations
(`observations.json`), and the reading (`summary.md`).

1. **`binding-rotated` was emitted**, `sha256:dbc67d74…` → `sha256:4bf382cc…`,
   `changed: "schema.mjs"`. The remint is not missing.
2. **`generated-and-loaded` precedes the remint** on the live stream — the
   ordering defect LLP 0310 F1 established from source, now observed rather than
   inferred. (`startup-successor-activated` does not appear: the supervised
   backend hot-loads the successor instead of restarting.)
3. **The next bootstrap exchange returned the successor binding**, `200`,
   `source: supervised-dev`.
4. **Which side was stale: the delivered binding.** Two consecutive samples show
   the generated graph naming the successor while the supervisor still delivered
   the predecessor binding. LLP 0310 recorded this as inference; it is now
   audited fact.

The observed disagreement lasted ~14 ms at a 10 ms sample period. That is **not**
the 0.1.27 window: this probe's Metro is a stub serving a precomputed bundle,
while the Clique lane's Metro rebuilt and hot-reloaded a real bundle into a live
browser. The number establishes where the window is, not how wide it is under a
real bundler.

The run also observed LLP 0310.000 **A1**: `metro-reloaded` fired 665 ms after
the remint with `reason: "successor-binding"`, the successor `descriptorIdentity`,
a replaced Metro pid, and an unchanged backend pid.

LLP 0310.000 OQ6's corroboration and the A0 acceptance row are closed.
