# LLP 0310 P19 / LLP 0310.000 A0 — same-owner schema successor: result

**Run:** 2026-08-26 · `node tests/probes/successor-binding-rotation-20260826/run.mjs`
**Ticket:** `issues/20260826-probe-successor-binding-rotation-json-stream.md`
**Retained:** `observations.json`, `events.jsonl` (the full `--json` stream),
`samples.jsonl` (208 paired samples of both sides of the predicate)

## What ran

Real `snapback dev --expo --expo-platform web --json`, stdin **not** a TTY, no
owner restart, against a scratch copy of
`packages/snapback-cli/fixtures/comparator/app/snapback`, driving a **schema**
successor by adding an optional field to an existing table. Metro is the
headless stand-in (`metro-stub.mjs`), which also exits 86 if it ever observes a
codegen staging directory vanish under it — the Track C detector, so this probe
cannot pass through a Track C regression.

The successor edit deliberately does not add a table: adding a `public-read`
table refuses with `SNAPBACK_TABLE_VISIBILITY_POLICY_RATCHET_GROWTH`, which is
a governance refusal and not the identity transition under test.

## The four observations the ticket asked for

1. **Was `binding-rotated` emitted?** Yes, at t+5523 ms.
   `previousDescriptorIdentity sha256:dbc67d74…` → `descriptorIdentity
   sha256:4bf382cc…`, `changed: "schema.mjs"`. The remint is not missing, and
   never was.
2. **Was `generated-and-loaded` emitted to the Expo arm after the successor
   activation?** Yes, and it **precedes the remint**. That is the ordering
   defect LLP 0310 F1 established from source, now observed on a live stream.
   (`startup-successor-activated` did not appear: the supervised backend
   hot-loads the successor rather than restarting, so the activation is inside
   `generated-and-loaded`.)
3. **What did the next bootstrap exchange return?** `200`, the **successor**
   binding, `source: supervised-dev`.
4. **What did the client admit, and against which descriptor?** This is the
   question the retained Clique evidence could not answer, because the lane read
   the M1 identity out of the Expo `extra` rather than out of a bootstrap
   response. The probe samples **both** sides of the `admitAppBindingV1`
   predicate every 10 ms through the transition, so it does not have to infer:

   | atMs | generated descriptor | delivered binding |
   |---|---|---|
   | 5503 | `sha256:4bf382cc…` (successor) | `sha256:dbc67d74…` (**predecessor**) |
   | 5517 | `sha256:4bf382cc…` (successor) | `sha256:dbc67d74…` (**predecessor**) |

   **`stalePredicateSide: "delivered-binding"`.** The generated graph an arm
   imports names the successor while the binding the supervisor delivers still
   names the predecessor. LLP 0310 held that as *inference*; it is now observed.

## The window, and why its size here is not the run's window

The disagreement lasted **~14 ms** across 2 samples at a 10 ms period. Do not
read that as "the 0.1.27 window was 14 ms". This probe's Metro is a stub that
serves a precomputed bundle; the Clique lane's Metro had to rebuild and HMR a
real bundle into a live browser, and the provider re-boot that lost the race is
driven by that. What the number establishes is that **the window is real and
sits exactly where the source said it does** — between graph exposure and
binding publication — not how wide it is under a real bundler.

## A1, observed

`metro-reloaded` fired 665 ms after the remint with
`reason: "successor-binding"`, carrying the successor `descriptorIdentity`, a
replaced Metro pid (37245 → 37448), and an **unchanged** backend pid (37219).
That is LLP 0310.000 A1 doing its job: the live arm is driven to re-import and
re-exchange instead of waiting for a change that never comes.

## Standing

Closes LLP 0310.000 **OQ6**'s corroboration and the A0 acceptance row. Does not
gate anything — Track A proceeded on the source-established ordering defect, as
r4 ruled.
