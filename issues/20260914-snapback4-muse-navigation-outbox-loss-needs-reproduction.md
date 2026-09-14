# Snapback 4: Muse's navigation loss needs a reproduction that tracks admission

Status: Open — needs reproduction of the full app observation
Priority: P3
Date: 2026-09-14
Systems: browser device, IndexedDB, mutation admission, application navigation
Observed package version: published `snapback4@0.2.10`
Evidence status: received app failure and workaround; independent awaited-admission control passes

## Received observation

The completed 0.2.10 Muse Clique report labels its member-removal/settings
problem an app bug: a fire-and-forget mutation followed by immediate page
navigation could leave membership unchanged on the server. It introduced
`settingsMutate`, a direct online apply with `keepalive:true`, and retained
the device path as fallback. Subsequent member-cutoff choreography passed.

The essay makes a stronger claim: a locally admitted write can evaporate
before IndexedDB flush, and requests a new durable-mutation primitive. The
holistic scorer repeats that claim. Preserve those received accounts and
the real correction cost; they do not establish that the SDK loses a
successfully awaited IndexedDB admission. The report also records a
`memoryPersistence()` → `indexedDbPersistence()` change, so not every
historical app revision had the same persistence boundary.

## Contract and independent control

The published web opener uses IndexedDB by default. Its device call awaits
the persistence batch's transaction completion before returning. The local
client awaits `admit` before returning `pending`; store failure is a named
`E_STORE` outcome with admission unknown. The README describes restart
authority in the durable outbox, orphaned-tab adoption, and memory
persistence keeping nothing across page loss.

An independent headless Chromium control at the unmodified published pin:

1. Opens a default IndexedDB-backed local client against a fresh dev instance
   on an ephemeral port, using a one-table schema and an explicit dev persona.
2. Blocks backend fetches and **awaits** `client.mutate` returning `pending`.
3. Makes `page.close()` the next asynchronous controller action, without
   `client.close()`, queue inspection or a server read before closing.
4. Opens the persisted device from a new page with a null backend: one
   mutation is still queued. The server still has zero rows.
5. Reconnects normally: the mutation settles and the server has exactly one
   row. No keepalive or alternate write-through path is used.

The [result and method](../benchmarks/runs/2026-09-14-snapback4-clique-0.2.10/muse/qualifications/navigation-admission/result.json)
and [probe source](../benchmarks/runs/2026-09-14-snapback4-clique-0.2.10/muse/qualifications/navigation-admission/probe.mjs)
are retained. An earlier passing attempt included a pre-close queue/server
inspection; it is retained separately, and the tighter second attempt is
the one described above. Both owned browser contexts and servers closed.
This is one reduced case, not the full Muse app, a zero-time kill, arbitrary
pre-admission destruction, browser/OS crash or power-loss proof.

## What to isolate next

The final app awaits `settingsMutate` inside async callbacks, but the UI kit
invokes void callbacks and does not delay external navigation. Frozen
choreography waits for the click and then performs `page.goto`, which does
not wait for an application's admission promise. A started handler or an
optimistic appearance is therefore not evidence of completed admission.
Normal app routing also differs from a full document unload.

Reproduce the exact settings flow with its persistence mode and record
whether navigation precedes or follows successful admission, including the
returned card and any `E_STORE` outcome. If awaited successful IndexedDB
admission is lost, preserve that minimal reproduction as an SDK defect.
If navigation interrupts it first, fix the app's completion/feedback path
and clarify the evidence rather than proposing a second durable primitive.
The current control contradicts the blanket loss claim but does not close
the narrower full-app observation or justify adjusting its received score.

The original report, essay and receipts are under
`~/clique-sb4-20260913-relaxed-3models/lanes/muse-snapback4/`; the retained
pre-grade source has `lib/client.tsx`, `lib/helpers.tsx` and
`app/chat/[id]/settings.tsx`. This is a follow-up to
[LLP 3000.007 §10.3](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#10.3),
not a new author ruling or a change to the frozen benchmark.

## 2026-09-14 — the independent Astra grade observes the same boundary

The separate Astra app's completed independent grade reports membership
settings loss in 4/6 immediate-navigation attempts, with the member still
present in the server roster. Eight human-paced attempts passed, as did
four attempts waiting for removal to settle before navigation; direct API
removal enforced cutoff. Six immediate-navigation message sends committed.
These are the grader's observations in `grading/trace.md` §5c and its
`g-web-removal-*.mjs` evidence, not a new orchestrator reproduction.

This strengthens the case for isolating settings admission and UI
completion feedback. It still does not demonstrate loss after a successfully
awaited IndexedDB admission: the grader describes navigation before local
admission, while the reduced control above tests navigation after it.
Preserve Astra's received `m3-a12` failure and Muse's builder workaround
without treating the two different boundaries as contradictory results.
