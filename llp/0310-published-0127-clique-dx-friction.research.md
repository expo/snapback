# LLP 0310: Published 0.1.27 Clique Snapback friction

**Type:** Research
**Status:** Draft
**Systems:** Competitive evaluation, Benchmarks, Agent experience, Developer
experience, CLI, Local server lifecycle, Auth, Live queries, Ephemeral state,
Code generation, React/Expo, Diagnostics, Guide, Testing
**Author:** Grok / Charlie Cheever
**Date:** 2026-08-25
**Related:** LLP 0041, LLP 0061, LLP 0108, LLP 0181, LLP 0186, LLP 0201,
LLP 0223, LLP 0258, LLP 0277, LLP 0295, LLP 0299, LLP 0300, LLP 0301,
LLP 0302, LLP 0306, LLP 0307, LLP 0310.000,
`benchmarks/runs/2026-08-25-clique-grok-0127/record.md`,
Diary 0113, Diary 0106, Diary 0096, Diary 0097

## Summary

The 2026-08-25 Clique run on grok 4.6 xhigh against published Snapback
**0.1.27** (`fastpath-0-1-27-98681377721e`) is N=1 calibration evidence
(LLP 0201 D5). It is not a magnitude claim. It is existence evidence that
the **paved Expo loop is now harder than the data model**, and that this
is a regression versus Clique explicit greens on 0.1.24 and 0.1.25.

Four cold lanes, Clique M1–M3 only, Linux web authoring:

| Lane | M1 | M2 | M3 |
|---|---|---|---|
| Snapback explicit | green | capability-failure | blocked |
| Snapback familiar | green | green | green |
| Convex 1.45.0 | green | green | suite pass; required typing choreo fail |
| Supabase 2.112.4 | green | green | green |

Explicit died after a *successful* additive schema successor:
`SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`. Familiar greened by restarting
`snapback dev` after Metro died. Convex and Supabase had Expo/Playwright
papercuts; they did not have “you edited your own schema, now the web arm
is a different app.”

This document lists every Snapback-attributed problem in those diaries,
essays, run-logs, and final reports. It does not authorize new subsystems.
The repair plan is [LLP 0310.000](./0310.000-successor-identity-and-paved-loop-repair.rfc.md).

## Evidence

- In-repo record:
  `benchmarks/runs/2026-08-25-clique-grok-0127/record.md`
- Cell reports under
  `benchmarks/runs/2026-08-25-clique-grok-0127/cells/{grok-clique-explicit,grok-clique-familiar,grok-clique-convex,grok-clique-supabase}/`
- Raw lanes: `/home/ccheever/clique-grok-0127-20260825/` on
  `expo-build-450a` (explicit), `expo-build-450b` (familiar), Minisforum
  (Convex + Supabase)
- Pin: npm `@expo/snapback-*@0.1.27`, runtime
  `@expo/snapback-runtime-linux-x64@0.1.27` gitCommit `98681377721e`
- Instrument: `social-messenger@0.3.3-m8`
- Historical contrast: 0.1.24 grok Clique explicit M1–M3 green (Diary
  0096); 0.1.25 sol-high explicit M1–M8 web green (Diary 0113); local-main
  grok explicit M1–M3 green (Diary 0106). LLP 0302 declared-dev identity
  gate landed 2026-08-24 and is in this 0.1.27 closure.

Method: read both Snapback diaries, essays, run-logs, and final reports
end to end; read Convex and Supabase diaries only for contrast (what did
*not* happen on those backends). Attribute using the lanes' own labels
(`snapback-defect`, `agent-error`, `environment`, `ambiguous`) plus an
orchestrator cluster. Agent-errors that exist only because a Snapback
seam is undocumented are listed as Snapback friction, not as “the model
was dumb.”

This document can license “this happened in this run” and “this is a
regression relative to named earlier Clique explicit greens.” It cannot
license frequency or that fixing any one item restores 0.1.25 explicit
wall.

## Findings

### F1. Explicit M2 is a successor-identity regression

**Cluster:** identity / Expo receipt.
**Attribution:** snapback-defect.
**Confidence:** high (receipt-backed, named hashes, named diagnostic).

M1 was green (suite 7/7, choreography 3/3). M2 generate produced an
additive successor:

- old schema `…2d884c32…` → new `…f6d3f2a1…`
- lifecycle `startup-successor-activated` with
  `continuity.accounts/sessions/stores: preserved`
- starter-m2 52 actions replayed through generated mutations

Then Expo web refused with `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`.
Generated files on disk named the new descriptor. The running Expo
integration receipt still named the M1 descriptor (`5204d9d4`). Login
never rendered (`sm-auth-email` missing). M3 was not started.

The guide
(`guide/clients/react-expo.md#diagnose-a-binding-identity-mismatch`) says
the refusal means imported `AppDescriptor` and delivered `AppBinding`
name different identities, and to restart only when the mismatch came
from a stale supervisor. This mismatch came from the *same* supervisor
after a watched generate. There is no documented non-destructive
refresh of the Expo extra after a successor.

`snapback dev` stdin was `/dev/null` (`/proc/<pid>/fd/0`), so the JSON
control channel could not send reload/restart. The lane correctly
refused `pkill`.

This is the regression. Earlier Clique explicit greens added tables in
the same owner without the web arm becoming a different app. LLP 0302's
fail-closed identity gate is the right idea against a *wrong* backend.
Here it fired on the *same* backend after a legal successor.

### F2. Familiar greened by surviving Metro death, not by a paved successor

**Cluster:** generate / Metro.
**Attribution:** snapback-defect (Metro death) plus luck (restart recooked
the receipt).
**Confidence:** high.

Familiar M1→M2 and M2→M3 both killed the lifecycle owner with
`SNAPBACK_EXPO_METRO_EXITED` (Metro watch ENOENT on a codegen `.tmp-*`
directory). The lane restarted the same `snapback dev` against existing
`dev.sqlite3` with no reseed. Account rows survived. The restart recooked
the Expo receipt, so Familiar never saw F1's mismatch.

That is not a paved loop. The prompt forbids destructive reseed and
pattern-kills; a Metro crash that forces an owner restart is how
Familiar accidentally satisfied LLP 0302. Explicit's Metro stayed alive,
so Explicit kept the stale receipt.

CI inheritance (`CI=true`) also disables Metro watching. Familiar unset
it (`env -u CI`). 0.1.25 work already found `CI=1` as a watcher killer
(LLP 0307 T1, closed tickets). The codegen-tmp ENOENT is a distinct
mechanism: generate writes a watched temp path, Metro panics, owner
exits.

### F3. Supervised Expo web still hides password UI

**Cluster:** provider / URL.
**Attribution:** snapback-defect.
**Confidence:** high.

Supervised `snapback dev --expo --expo-platform web` injects
`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` and mints an ambient session. It
does **not** inject `EXPO_PUBLIC_SNAPBACK_URL`. Adopting the mint hid
`sm-auth-email`. Signing it out crashed the provider with
`SNAPBACK_AUTH_SESSION_EXPIRED`.

Familiar's working landing was URL-first `SnapbackProvider` using the
supervisor bootstrap's `binding.target.origin` and ignoring the minted
bearer. That is the LLP 0300 URL-first story reconstructed by hand inside
a supervised owner. The familiar profile page does not say this.

Convex's `ConvexProvider` is one object. This split is Snapback-specific
and cost Familiar the first hour of M1.

### F4. Activity presence is split across packages and generation-fenced

**Cluster:** ephemeral / presence.
**Attribution:** snapback-defect (split + fence); agent-error (per-keystroke
`touch()` after that).
**Confidence:** high.

`@expo/snapback-expo`'s `useSnapbackActivityPresence` requires
`SnapbackExpoLifecycleContext`. A URL-first provider (F3) does not
provide it. The hook that works is `@expo/snapback-react`, which defaults
lifecycle to active. The familiar page does not say which import to use
on URL-first web.

`touch()` starts a new presence generation and cancels the in-flight
publish. Per-keystroke `touch()` therefore never lands a typing row in
time for the frozen 2s appearance check. Familiar published once on
typing start and idle-stopped locally, then isolated `MessageComposer` so
Playwright `pressSequentially` of a 45-character run id dropped from
~2.7s to ~1.4s. Typing greened at `visibleMs ~1261ms`.

Convex hit the same instrument clock at ~3.2s and recorded
instrument-failure. Same check, different product outcome: Snapback's
fence made the first attempt structurally late; React render cost made
the second attempt late; isolating the composer made the third attempt
green. Convex had no generation fence but also no cheap composer.

### F5. Guide drift is still charging orientation

**Cluster:** docs.
**Attribution:** snapback-defect (guide).
**Confidence:** high.

Named misses in this run:

1. Familiar briefs/start packets still say `_generated/`. 0.1.27 refuses
   that directory and emits `generated/`. The directory mismatch itself
   was closed for codegen (issue
   `closed/20260815-familiar-codegen-generated-directory-mismatch.md`);
   the **guide spelling** is still wrong.
2. `snapback guide SNAPBACK_AUTH_STALE_RESULT` pointed at an unrelated
   assets page.
3. Diagnose-a-binding-identity-mismatch does not describe a same-owner
   successor (F1).
4. Familiar page does not document F3 or F4.

Orientation is inside the Clique clock. Wrong first pages are not free.

### F6. Explicit grammar papercuts are real and not the M2 killer

**Cluster:** authoring grammar.
**Attribution:** mix of snapback-defect and by-design strictness.
**Confidence:** medium-high (happened; not causal for the capability-failure).

- `SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER`: inline handlers cannot close
  over a top-level `const` (HANDLE_RE). Explicit switched to a function
  declaration. Related history:
  `issues/closed/20260801-0137-a4-outbound-notification-effects-unauthorable.md`.
- Durable custody is unavailable on the Node `memory` platform. Headless
  replay had to impersonate `expo-web` + fake-indexeddb. The template's
  own acceptance already does this; the start packet does not say so
  loudly enough.
- `defineCommand` admits at most one asset input. Multi-image posts used
  `assets.upload` then mutate. Owned by open
  `issues/20260815-finish-media-happy-path.md` / LLP 0239 — do not
  re-open here.
- Result contracts, `reads`/`writes`/`refusals` on every function, and
  asset intent names that must exist in the same generate are ceremony
  Convex infers. They are the explicit/familiar product, not a 0.1.27
  regression. List them so the RFC does not pretend they are free.

### F7. The JSON control channel is not agent-safe

**Cluster:** lifecycle / CLI.
**Attribution:** snapback-defect.
**Confidence:** high for this launch; medium as a general product claim.

Grok launched `snapback dev` with stdin `/dev/null` (setsid, no TTY).
The documented control verbs then cannot be delivered. Reloading Metro
after a successor is exactly the verb F1 needed. An interactive human
terminal may still type. An agent lifecycle owner as required by the
Clique prompt cannot.

This is not “don't use `/dev/null`.” The paved loop claims the supervisor
owns Metro. Ownership without a non-TTY control path is a hole.

### F8. Competitor contrast: Expo papercuts are shared; identity is not

**Cluster:** contrast.
**Attribution:** observation.
**Confidence:** high as contrast, not as a ranking.

Shared with Convex/Supabase (not Snapback-owned): RN-web `Link asChild`,
controlled `TextInput` vs Playwright `fill`/`pressSequentially`, kit
`sm-profile` leading with “Edit profile,” feed tabs vanishing after
profile navigation, Linux iOS/Hermes environment-null, Chromium libraries
on 450a, instrument choreography tree not writable.

Snapback-only in this run: F1, F2, F3, F4, F5, F7, and the
reads/writes/codegen.policy fork. Convex's hard M3 miss was the typing
clock plus no TTL primitive. Snapback *has* the TTL primitive and still
almost missed the same clock because of F4.

Supabase was the only competitor with full M1–M3 authoring-green, and the
fastest complete green. That is existence evidence that the Clique bar is
passable on this host and instrument. Explicit's M2 stop is therefore not
“Clique is too hard.”

## Inventory (every Snapback-attributed item)

| ID | Lane | Cluster | Item | Attribution | Disposition |
|---|---|---|---|---|---|
| P1 | explicit | identity | `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` after same-owner successor; Expo extra still names M1 descriptor | snapback-defect | RFC Track A |
| P2 | explicit | lifecycle | `snapback dev` stdin `/dev/null` → JSON control unusable | snapback-defect | RFC Track E; ticket |
| P3 | both | generate | `SNAPBACK_EXPO_METRO_EXITED` on codegen `.tmp-*` ENOENT | snapback-defect | RFC Track C; ticket |
| P4 | familiar | provider | no `EXPO_PUBLIC_SNAPBACK_URL`; supervisor mint hides password UI; signOut → `SNAPBACK_AUTH_SESSION_EXPIRED` | snapback-defect | RFC Track B; ticket |
| P5 | familiar | presence | `@expo/snapback-expo` presence needs lifecycle URL-first does not have | snapback-defect | RFC Track D; guide ticket |
| P6 | familiar | presence | `touch()` generation-fenced; per-keystroke publish cancels | snapback-defect | RFC Track D |
| P7 | explicit | grammar | inline handler cannot capture top-level `const` | snapback-defect | note; existing grammar |
| P8 | explicit | grammar | durable custody unavailable on Node `memory` | snapback-defect | guide ticket |
| P9 | explicit | assets | `defineCommand` max one asset | known | existing `20260815-finish-media-happy-path.md` |
| P10 | both | guide | `_generated/` still in packets; 0.1.27 refuses it | snapback-defect | guide ticket |
| P11 | familiar | guide | `SNAPBACK_AUTH_STALE_RESULT` lookup hits assets page | snapback-defect | guide ticket |
| P12 | explicit | guide | successor-mismatch diagnosis missing | snapback-defect | RFC Track A + guide |
| P13 | familiar | env | inherited `CI=true` disables Metro watch | environment / known | already closed 0307 T1; lane workaround `env -u CI` |
| P14 | both | ceremony | `reads`/`writes`/`refusals`, two authoring profiles | product | out of this RFC's repair bar |
| P15 | familiar | agent | profile editor saved empty handle before `getMine` | agent-error | not a Snapback ticket |
| P16 | both | instrument | no `sm-nav-chats`; typing clock includes `pressSequentially` | instrument | not a Snapback product ticket |

## Confidence and non-claims

- High: P1–P6, P10–P12 happened as described in hash-backed reports.
- Medium: P2 as a *general* agent-hosting hole (this launch is proof of
  one path; other harnesses may keep a pipe).
- Not claimed: that Familiar is faster than Explicit, that 0.1.27 is
  worse on wall than 0.1.25, or that weakening LLP 0302 admission is the
  fix.

## Open questions

1. Should a same-owner successor recook the Expo extra in-process, or
   is a documented, non-destructive owner restart the intended recovery?
2. Is supervised `--expo` still a supported paved path after LLP 0300, or
   is caller-owned `expo start` + URL-first the only path that must work?
3. Is `touch()` generation fencing load-bearing for presence correctness,
   or can a typing heartbeat reuse one generation?

Those are ruled in LLP 0310.000.

## Revision history

- 2026-08-25 — initial Draft from the grok 4.6 xhigh 0.1.27 Clique
  diaries.
