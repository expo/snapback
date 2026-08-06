# AppDescriptor `useSurface` blocks process-cold retained rendering

**Status:** Resolved — LLP 0176 G2 rerun passes; G3 unblocked
**Impact:** 5
**Urgency:** 5
**Ease:** 2
**Confidence:** 5
**Systems:** AppDescriptor, React client, Expo client, RQS retention, Surfaces
**Date:** 2026-08-06
**Governing:** LLP 0114, LLP 0129, LLP 0176, LLP 0179
**Related:** `demos/expo-golden-path-fixture/receipts/20260806-g2-falsification-baseline.md`,
`issues/20260806-expo-file-carrier-process-kill-witness.md`

## Design defect

The preferred generated-surface path hides retained state behind a binding that
cannot be constructed during a process-cold offline launch. The retained rows
and exact persisted binding receipt both exist, and the surface projection can
represent `retained`/`refreshing`/`stale`, but
`prepareReactBinding({ generatedManifest: app })` rethrows the connectivity
failure before the provider or `useSurface` exists.

This fails frozen fact 6 of LLP 0176 G2's two-half falsification checkpoint.
The screen shrank by 33.5%, but the original Relay Room cold-client behavior
was not preserved, so G2 is FAIL and G3 work must not proceed.

## Reproduction

From `demos/expo-golden-path-fixture`:

```sh
SNAPBACK_RUNTIME_BINARY=/path/to/snapback bun run test:g2
```

The acceptance does the following:

1. Starts the runtime with the fixture artifacts and an ordinary session.
2. Prepares from the generated `app`, reaches current surface messages, and
   persists the exact React binding receipt and RQS resume state.
3. Disposes the surface/provider/client, closes the store, and stops the
   runtime.
4. Reopens the same Expo-file carrier through a fresh store and client and
   proves the binding receipt and all three retained message rows still exist.
5. Calls `prepareReactBinding({ generatedManifest: app })` and observes
   `TypeError: fetch failed` before a provider can be constructed.

The test is green because this fifth step is an explicit negative witness. It
does not mean the G2 checkpoint passes.

## Cause

`packages/snapback-client/react-binding.mjs:560-568` handles preparation's
connectivity failure. The portable AppDescriptor omits server-owned function
interiors, and the legacy receipt does not retain the admitted deployment view.
The implementation therefore rethrows when `generated.descriptorMode` is true
before reaching `adoptPersistedBindingReceipt(...)`.

The refusal is individually fail-closed, but it conflicts with the accepted
surface/no-URL authoring path's retained-data obligation. The app can render
only its provider fallback diagnostic; it cannot render saved history through
`useSurface` because the provider never exists.

## What done looks like

- A byte-identical AppDescriptor and persisted receipt carry, or can safely
  recover, sufficient admitted function/schema/capability facts to prepare a
  binding without contacting the runtime.
- A fresh process with the runtime unreachable constructs the Expo provider
  from that receipt and `useSurface(app.surfaces.conversation, ...)` renders
  the retained rows with `freshness: retained`, `status: refreshing`, and a
  stale/offline transport fact.
- Descriptor, deployment, schema, function, and capability drift still refuse
  loudly; server-answered authorization/capability refusals never fall back to
  a receipt.
- The G2 real-runtime witness changes from expecting the pre-provider refusal
  to expecting rendered retained surface data, while the existing low-level
  receipt-adoption and negative-drift tests remain green.
- LLP 0176 G2 is rerun from the frozen baseline before any G3 setup resumes.

This is a product design defect, not a missing-guide-knowledge report, so it
does not carry `guide-gap`.

## Resolution — 2026-08-06

The descriptor-only rethrow was removed. Online AppDescriptor preparation now
adds a compact admitted deployment projection to LLP 0114's existing binding
receipt: per-function query-artifact/authority-independent facts, admitted
ephemeral definitions, descriptor identity, and registered/mixed capability
facts. Cold preparation supplies the byte-identical descriptor, reconstructs
the normal inspection input from that projection, and re-runs the existing
function/result/schema/surface admission before constructing the provider.
No second receipt format, retained store, cache, or surface boot owner was
introduced.

Same-app receipt drift now refuses with the existing typed
`SNAPBACK_REACT_BINDING_MISMATCH`; server-answered failures still never fall
back. The scripted regression in
`packages/snapback-react/cold-boot-binding.test.mjs` covers legacy and
descriptor receipt adoption, retained/refreshing/stale surface rendering,
server-answered refusal, and typed generation drift. The real-runtime
`demos/expo-golden-path-fixture/tests/g2-falsification.mjs` acceptance renders
all three retained messages through `data` and `state` and passes 5/5.

The frozen receipt was updated append-only, LLPs 0114/0179/0181 record the
seam and boot-state decision, and LLP 0176 records Half 1 PASS, Half 2 PASS
(18/18), overall PASS, and G3 unblocked.
