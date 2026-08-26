# LLP 0310: Published 0.1.27 Clique Snapback friction

**Type:** Research
**Status:** Draft
**Systems:** Competitive evaluation, Benchmarks, Agent experience, Developer
experience, CLI, Local server lifecycle, Auth, Live queries, Ephemeral state,
Code generation, React/Expo, Diagnostics, Guide, Testing
**Author:** Grok / Charlie Cheever
**Date:** 2026-08-25
**Revised:** 2026-08-26 (P6 / Track D implemented with one generation per
typing episode and all-boundary queued-work discard; the F4 source account is
retained as published-0.1.27 evidence)
**Revised:** 2026-08-26 (r8, reconciliation with `main`: P4/Track B landed at
`15797fe10` and P17's guide fix at `c80a35f0c` while this document was in review)
**Revised:** 2026-08-26 (r6, after round-5 dual review: the P1 inventory row
still carried the "admitted a binding" clause r5 claimed to remove; the run's
root cause narrowed to the ordering defect; the work map no longer copies the
withdrawn I1 ordering. Adopts the author's pit-of-success standard for
agent-error attribution and re-dispositions every row it touches)
**Revised:** 2026-08-26 (r5, after round-4 dual review — one family READY on
this document, the other NOT READY on two evidence-classification defects: the
P1 inventory row asserted the stale side as fact, and the inventory still said
both probes gate design. `fallback` terminology corrected; F1's concurrency
restated as a race)
**Revised:** 2026-08-26 (r4, after round-3 dual review: both families located
the F1 fault r3 called unlocated — exposure precedes remint and the provider
never re-exchanges — so P19 is demoted from blocker to corroboration; "which
side was stale" held open as inference; the existing rotation test's coverage
corrected; the historical claim narrowed to the cited baselines)
**Revised:** 2026-08-26 (r3, source-audit correction: the regression claim is
withdrawn; F1 re-attributed to the shipped binding remint, not the config-plugin
extra; F7 re-attributed to a missing verb on the shipped control route; F4's
import half downgraded to unverified; P19/P20 added)
**Revised:** 2026-08-26 (inventory Status column: done / in-progress /
planned-not-started / not-yet-planned / out-of-bar, per LLP 0315)
**Revised:** 2026-08-26 (work-to-do map: RFC vs ticket-only; P12/P6/P17
tickets; P15 reclassified as undocumented-seam guide-gap; F9)
**Related:** LLP 0041, LLP 0061, LLP 0108, LLP 0179, LLP 0181, LLP 0186,
LLP 0201, LLP 0223, LLP 0257, LLP 0258, LLP 0262, LLP 0277, LLP 0295,
LLP 0299, LLP 0300, LLP 0301, LLP 0302, LLP 0306, LLP 0307, LLP 0310.000,
LLP 0315, `issues/20260826-probe-successor-binding-rotation-json-stream.md`,
`issues/20260826-probe-expo-presence-facade-bare-provider.md`,
`issues/20260826-inline-handler-free-identifier-recovery.md`,
`issues/20260826-membership-scoped-query-reachability.md`,
`benchmarks/runs/2026-08-25-clique-grok-0127/record.md`,
Diary 0113, Diary 0106, Diary 0096, Diary 0097, Diary 0114

## Summary

The 2026-08-25 Clique run on grok 4.6 xhigh against published Snapback
**0.1.27** (`fastpath-0-1-27-98681377721e`) is N=1 calibration evidence
(LLP 0201 D5). It is not a magnitude claim. It is existence evidence that
the **paved Expo loop is now harder than the data model**.

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

**This document does not claim a 0.1.27 regression.** The r1/r2 revisions
did; the r3 source audit withdrew it. The supervised same-owner successor
path was never shown green in an earlier Clique run — the three cited
contrasts each used a different topology or an owner restart
([Historical contrast](#historical-contrast)). The honest claim is that
**none of the cited baselines** exercised this path — a statement about those
three runs, not an exhaustive history — and that the supervised arm dies on a
legal successor because of an **ordering defect located in source**. Whether
that ordering is what killed *this* arm is inferred pending P19.

This document lists every Snapback-attributed problem in those diaries,
essays, run-logs, and final reports. It does not authorize new subsystems.
The design repair for the paved Expo loop is
[LLP 0310.000](./0310.000-successor-identity-and-paved-loop-repair.rfc.md).
Straightforward items are tickets, not RFC tracks. See
[Work to do](#work-to-do).

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

Method: read both Snapback diaries, essays, run-logs, and final reports
end to end; read Convex and Supabase diaries only for contrast (what did
*not* happen on those backends). Attribute using the lanes' own labels
(`snapback-defect`, `agent-error`, `environment`, `ambiguous`) plus an
orchestrator cluster.

## Reading an agent-error label (author standard, 2026-08-26)

Lane self-labels are the starting point, not the disposition. **When a
capable agent gets something wrong, the default assumption is that the product
made the wrong thing easy — not that the agent was careless.** An
`agent-error` label is evidence about Snapback's authoring surface, and the
question it raises is "what made this the natural move?", not "whose fault was
it?"

Concretely, a row keeps its `agent-error` label as a *dismissal* only when all
three hold:

1. The correct move was discoverable from the material the lane actually had —
   start packet, served guide, package types — not merely present somewhere in
   the corpus.
2. The wrong move was not the one the API, the types, or the surrounding idiom
   made most natural.
3. Nothing cheap (a diagnostic that names the fix, a type that refuses the bad
   shape, a sentence in the packet) would have prevented it.

If any of the three fails, the row is Snapback friction with a ticket, however
small. "Working as designed" is a statement about the implementation, never by
itself a disposition for a lane that fell into it. Rows genuinely outside
Snapback's control — instrument choreography, host environment — stay out of
bar, but the document says *why* rather than leaning on the label.

This standard is applied to every row in the [inventory](#inventory-every-snapback-attributed-item);
the r6 revision re-dispositioned P5, P7, and P18 under it.

**r3 source audit.** Every product finding below was re-checked against
`main` at the named symbol, and every historical-contrast claim against
the cited diary text. Findings that survived unchanged are marked
*audited*; findings the audit corrected carry the correction inline. A
lane's own inference is now only admitted as a finding when a named
symbol or a named observation supports it.

### Historical contrast

The r1/r2 revisions read three earlier Clique explicit greens as proof
that a same-owner successor used to work. None of them exercised that
path:

| Contrast | What the diary actually says | Comparable? |
|---|---|---|
| 0.1.24 grok explicit (Diary 0096) | Backend started with `--startup-artifacts` and “a hand-built Expo environment because `SnapbackExpoProvider` ignores a raw `binding` override” | **No** — supervised `--expo` not used |
| 0.1.25 sol-high (Diary 0113) | “The supervised Expo launcher again selected undeclared ports, so both lanes used fixed-port external-client topology. Clean Metro restarts were also needed after several generated descriptor/module changes.” | **No** — external client, and restarts were needed after descriptor changes |
| local-main grok explicit (Diary 0106) | Additive successor for posts/follows/likes/reposts, but “Metro HMR storms reclaiming the lifecycle (restarted the same `snapback dev` on 48100, sqlite preserved)” | **No** — owner restarted, the same accident as F2 |

LLP 0302's declared-dev identity gate landed 2026-08-24 and is in this
0.1.27 closure. Because no cited baseline exercised the supervised
same-owner successor, **0302's landing is not evidence-linked to this
failure** and must not be treated as the suspected cause.

This document can license “this happened in this run” and “none of the three
cited baselines exercised this path.” It cannot license frequency, a magnitude
claim, a regression relative to 0.1.24/0.1.25, an exhaustive claim about every
Clique run ever, or that fixing any one item restores an explicit wall.

## Findings

### F1. Both exposure events precede the successor's binding

**Cluster:** identity / supervised binding.
**Attribution:** snapback-defect.
**Confidence:** high that the refusal happened; the **ordering defect** is
located from source and confirmed across four reviews and two model families.
The *run's* root cause — whether that ordering is what killed this particular
arm — remains inferred pending P19, as does which side of the predicate the
lane observed as stale.

M1 was green (suite 7/7, choreography 3/3). M2 generate produced an
additive successor:

- old schema `…2d884c32…` → new `…f6d3f2a1…`
- lifecycle `startup-successor-activated` with
  `continuity.accounts/sessions/stores: preserved`
- starter-m2 52 actions replayed through generated mutations

Then Expo web refused with `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`.
Login never rendered (`sm-auth-email` missing). M3 was not started.

**Which artifact is actually stale (r3 correction).** The r1/r2 text —
and the lane's own wording — said the *Expo extra / integration receipt*
was stale. The audit says otherwise:

1. On this path the refusal is thrown by `admitAppBindingV1`
   (`packages/snapback-expo/app-binding.mjs`), which compares the
   **imported generated `AppDescriptor`** the application hands the
   provider against the **delivered `AppBinding`**. Under supervised
   `--expo` that binding comes fresh from
   `GET /_snapback/expo/v1/bootstrap` with `cache: 'no-store'`.
2. `expo.extra.snapback.integrationReceipt` is emitted by the config
   plugin (`withSnapbackExpo`, `packages/snapback-expo/config-plugin.cjs`)
   as a public build-invalidation and compatibility record. **No runtime
   code reads it** — the only non-test readers of the symbol anywhere in
   `packages/`, `guide/`, and `demos/` are the plugin itself and its own
   tests. It can neither cause nor cure this refusal.

So the extra is not the admit operand. **What r4 does not claim:** that the
delivered binding, rather than the imported descriptor, is the stale side. The
predicate only establishes that the two differ, and the lane recorded the M1
identity from the Expo `extra`, not from the bootstrap response. "The client
admitted a binding naming the M1 descriptor" is an inference from the boot
fallback plus the extra's vintage — consistent with the mechanism below, but
not independently established. P19 settles it.

**A remint primitive already ships, and is documented** — it is not the whole transition this program needs, but it is not missing either. `rotateBindingAfterLoad`
(`packages/snapback-cli/expo-dev.mjs`) fires on the backend's
`generated-and-loaded` event, re-reads the successor
`snapback/generated/app.descriptor.json`, remints through
`bindingPublisher.issue(...)` in the *same* supervisor generation and
route, and emits `binding-rotated`. The guide teaches exactly this in
[`guide/clients/react-expo.md#know-what-the-supervisor-owns`](../guide/clients/react-expo.md):
“the supervisor reads the successor `app.descriptor.json` and remints the
binding for that exact descriptor identity … without restarting
`snapback dev --expo`.”

The r1/r2 sentence “there is no documented non-destructive refresh” was
therefore wrong. But r3's replacement — “what is missing is the reason the
mechanism did not take” — was also wrong, and in a more expensive way: it
declared the root cause unlocated and blocked the repair on a reproduction.
Round 3 found it from source, twice, independently.

**The mechanism.** The remint fires too late, and the client cannot recover:

1. `regenerateAndLoad` (`packages/snapback-cli/index.mjs`) publishes the
   successor generated graph (`generateApp` — codegen renames its
   `.generated.tmp-*` staging directory into `generated/`, so the successor is
   **Metro-visible from here**), then **activates it** (`loadGenerated`),
2. and only *then* emits `generated-and-loaded`, which is what triggers
   `rotateBindingAfterLoad` to remint the binding the exchange serves.
3. Meanwhile — asynchronously, unordered against step 2's *emission* and the
   remint it triggers — Metro can HMR the successor `app` into the **live**
   browser arm.
4. `SnapbackExpoProvider` (`packages/snapback-expo/provider.mjs`) disposes and
   re-boots on any `app` change: one bootstrap exchange, one admission attempt.
5. If that exchange still carries the **predecessor** binding,
   `admitAppBindingV1` *refuses* — nothing is admitted — and the boot settles on
   `status: 'error'`, surfaced through the `fallback` prop, which is what the
   lane's retained “clique boot fallback” note records. (`fallback` is a prop,
   not a boot status.)
6. The remint then lands. Too late: `app` does not change again, so the arm
   never re-exchanges and stays dead.

**Both exposure events precede the remint**, which is the reverse of what a
coherent same-owner transition requires — that much is established from source.
Whether steps 3–5 completed before the remint in this particular run is a
**race** the source cannot settle; that is what P19 corroborates. What makes
the race fatal rather than transient is step 6: a pull-only exchange with a
single-shot admission has no way back.

**Correcting r3 on the coverage gap.** r3 said the rotation test “edits
`functions.mjs` and asserts the backend pid is unchanged,” and named “a schema
successor is untested” as the leading hypothesis. Both were off. The test
(`packages/snapback-cli/expo-dev-loop.test.mjs`, label *“supervised binding
rotation after functions edit”*) also verifies the rotated binding in the next
exchange, waits for Metro to serve the successor bundle, and drives a **fresh**
successor boot. And the rotation predicate is
`successor.identity.descriptor !== descriptor.identity.descriptor`, which a
functions edit changes exactly as a schema edit does — so schema-vs-functions
was never the discriminator. The real hole is narrower and worse: **no test
holds an already-running browser arm across a successor.**

**Evidence this run does not carry.** The retained receipts are suite and
choreography JSON only; no `snapback dev --json` event stream was kept, and the
mismatch diagnostic's `mismatches[]` payload was not dumped. So the run cannot
say whether `binding-rotated` fired, with which descriptor, or which side of
the predicate was stale. That is what [P19](#inventory-every-snapback-attributed-item)
records — **as corroboration, not as a prerequisite**. r3 made it a blocker;
round 3 refuted that, and the repair proceeds on the located mechanism.

`snapback dev` stdin was `/dev/null` (`/proc/<pid>/fd/0`), so the stdin
JSON control channel could not send reload/restart. The lane correctly
refused `pkill`. See F7 for what that does and does not establish.

The product rule this run violates stands regardless of root cause: a
legal successor in the same owner must not turn the web arm into a
different app. LLP 0302's fail-closed gate is the right idea against a
*wrong* backend; here the client was refused against the *right* one.

### F2. Familiar greened by surviving Metro death, not by a paved successor

**Cluster:** generate / Metro.
**Attribution:** snapback-defect (Metro death) plus luck (restart recooked
the binding).
**Confidence:** high. *Audited.*

Familiar M1→M2 and M2→M3 both killed the lifecycle owner with
`SNAPBACK_EXPO_METRO_EXITED` (Metro watch ENOENT on a codegen `.tmp-*`
directory). The lane restarted the same `snapback dev` against existing
`dev.sqlite3` with no reseed. Account rows survived. The restart issued a
fresh binding for the current descriptor, so Familiar never saw F1's
mismatch.

That is not a paved loop. The prompt forbids destructive reseed and
pattern-kills; a Metro crash that forces an owner restart is how
Familiar accidentally reached a coherent identity. Explicit's Metro
stayed alive, so Explicit kept the predecessor binding.

Note the symmetry with [Historical contrast](#historical-contrast):
Diary 0106 and Diary 0113 reached their greens the same way. Owner
restart after a descriptor change is the only route with a Clique
track record.

CI inheritance (`CI=true`) also disables Metro watching. Familiar unset
it (`env -u CI`). 0.1.25 work already found `CI=1` as a watcher killer
(LLP 0307 T1, closed tickets); the supervised arm strips `CI` from its
own Metro child (`expoMetroChildEnvironment`). The codegen-tmp ENOENT is
a distinct mechanism: generate writes a watched temp path, Metro panics,
owner exits.

### F3. Supervised Expo web mints a session that hides the password UI

**Cluster:** provider / mint.
**Attribution:** snapback-defect.
**Confidence:** high. *Audited, with one r3 correction.*

Supervised `snapback dev --expo --expo-platform web` injects only
`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` (`expoMetroChildEnvironment`,
`packages/snapback-cli/expo-dev.mjs`) and mints an ambient session.
Adopting that mint hid `sm-auth-email`. Signing it out crashed the
provider with `SNAPBACK_AUTH_SESSION_EXPIRED`.

Familiar's working landing was a URL-first `SnapbackProvider` built from
the supervisor bootstrap's `binding.target.origin`, ignoring the minted
bearer. The familiar profile page does not say this.

**r3 correction — the missing variable is not the defect.** The r1/r2
text framed this as “no `EXPO_PUBLIC_SNAPBACK_URL` is injected.” Under a
completed supervised rendezvous, LLP 0302 §4 makes `url` **ignored** by
construction, and §5 says the library reads no environment at all. The
binding's own `target.origin` already *is* the backend origin — which is
exactly what Familiar reconstructed by hand. Injecting the variable would
change nothing observable. The defect is the **ambient mint**: created
eagerly, adopted by default, and not recoverable by signing out. The
absent variable is at most a discoverability papercut, and the honest
repair is the mint's lifecycle plus a familiar-page paragraph.

Two standing decisions bound anything in this area and must be named by
any repair: LLP 0223 (“auto-inject, do not auto-write” — no durable
`.env` copy) and LLP 0262 D2 (the dev-identity bearer never enters
`EXPO_PUBLIC_*`). A credential-free origin does not violate D2; say so
rather than leaving it to be re-litigated.

Convex's `ConvexProvider` is one object. This split is Snapback-specific
and cost Familiar the first hour of M1.

### F4. Presence: the generation fence is real; the package split is not established

**Cluster:** ephemeral / presence.
**Attribution:** snapback-defect (fence); **unverified** (package split).
**Confidence:** high for the fence; **low** for the import rule.

**The fence (high confidence, audited).** `touch()`
(`packages/snapback-react/implementation.mjs`) unconditionally runs
`activity.generation += 1`, resets `admittedGeneration` to `null`, and
re-admits — so a per-keystroke `touch()` starts a new presence generation
and cancels the in-flight publish of the episode. Per-keystroke `touch()`
therefore never lands a typing row in time for the frozen 2s appearance
check. Familiar published once on typing start and idle-stopped locally,
then isolated `MessageComposer` so Playwright `pressSequentially` of a
45-character run id dropped from ~2.7s to ~1.4s. Typing greened at
`visibleMs ~1261ms`.

**Implementation note (2026-08-26).** The preceding paragraph describes the
published 0.1.27 subject of this research, not the current tree. P6 / Track D
now keeps one generation per episode, coalesces changed values after the
in-flight publish settles, and discards queued work at every episode boundary.

**The package split (r3 downgrade).** The r1/r2 text asserted that
`@expo/snapback-expo`'s `useSnapbackActivityPresence` *requires*
`SnapbackExpoLifecycleContext` and therefore cannot run under a URL-first
provider. The audit does not support that:

- `packages/snapback-expo/activity-presence.mjs` resolves
  `lifecycleContext?.source ?? await resolveSnapbackExpoLifecycleSource(lifecycleContext?.environment ?? null)`.
  The context is optional; absence falls through to the shared resolver.
- On web that resolver reaches `resolveDefaultAppState`
  (`packages/snapback-expo/app-state.web.mjs`), which imports
  `react-native-web`'s `AppState` — present in any Expo web app.
- LLP 0257 *requires* the bare-provider fallback, and
  `issues/20260825-ruling-3-vs-llp-0257-background-withdrawal.md` records
  that the shipped facade follows it: “the facade currently does work
  under a bare `SnapbackProvider`.”
- The lane never observed a refusal. Its run-log (1787660792) shows it
  decided from reading `index.d.mts`, and its own final report labels the
  row **agent-error**.

What is genuinely established is narrower: the familiar page does not say
which import to use on URL-first web, and the gated-vs-ungated difference
is undocumented. Whether the facade actually fails in that composition is
**open** and is [P20](#inventory-every-snapback-attributed-item). The
guide text landed on 2026-08-25 for this finding, and LLP 0310.000
Ruling 3's package boundary, both rest on the unverified half — that is
what produced the standing LLP 0257 conflict, and it should be resolved
by the P20 re-test, not by an owner ruling on an untested premise.

Convex hit the same instrument clock at ~3.2s and recorded
instrument-failure. Same check, different product outcome: Snapback's
fence made the first attempt structurally late; React render cost made
the second attempt late; isolating the composer made the third attempt
green. Convex had no generation fence but also no cheap composer.

### F5. Guide drift is still charging orientation

**Cluster:** docs.
**Attribution:** snapback-defect (guide).
**Confidence:** high. *Audited.*

Named misses in this run:

1. Familiar briefs/start packets still said `_generated/`. 0.1.27 refuses
   that directory and emits `generated/`. The directory mismatch itself
   was closed for codegen (issue
   `closed/20260815-familiar-codegen-generated-directory-mismatch.md`);
   the **guide spelling** is now corrected on `main` — every surviving
   occurrence under `guide/` teaches it as a refused alias.
2. `snapback guide SNAPBACK_AUTH_STALE_RESULT` pointed at an unrelated
   assets page.
3. Diagnose-a-binding-identity-mismatch does not describe a same-owner
   successor (F1). Note that the *adjacent* section, “Know what the
   supervisor owns,” already documents the remint — the two sections do
   not cross-reference, which is part of why the lane read the refusal as
   unrecoverable.
4. Familiar page does not document F3's mint behavior or F4's
   gated-vs-ungated presence difference. The F4 import guidance that
   landed 2026-08-25 is pending the P20 re-test.
5. The supervised control route (F7) is not documented anywhere in
   `guide/`.

Orientation is inside the Clique clock. Wrong first pages are not free.

### F6. Explicit grammar papercuts are real and not the M2 killer

**Cluster:** authoring grammar.
**Attribution:** mix of snapback-defect and by-design strictness.
**Confidence:** medium-high (happened; not causal for the capability-failure).
*Audited.*

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

### F7. The supervised control route exists but is verb-poor and undocumented

**Cluster:** lifecycle / CLI.
**Attribution:** snapback-defect (missing verbs, missing docs).
**Confidence:** high. **r3 rewrite — the r1/r2 framing was wrong.**

Grok launched `snapback dev` with stdin `/dev/null` (setsid, no TTY), so
the **stdin** control verbs could not be delivered. The r1/r2 text
concluded from this that “an agent lifecycle owner as required by the
Clique prompt cannot” talk to the supervisor. The audit refutes that:

- `SUPERVISED_CONTROL_PATH = '/_snapback/expo/v1/control'`
  (`packages/snapback-cli/expo-dev.mjs`) is a `POST` route on the
  supervised bootstrap listener, authenticated by constant-time
  comparison against the managed admin token
  (`handleBootstrapControl`).
- The supervisor advertises it to its owner as `controlPath` in the
  supervisor descriptor, and `packages/snapback-cli/index.mjs` verifies
  that advertisement.
- It is covered by `packages/snapback-cli/reset-dev-fresh.test.mjs`,
  including the unauthorized and unknown-verb arms.
- It needs no TTY and no stdin.

Two things are actually wrong. First, the **verb set is one entry**:
anything other than `dev-fresh` returns
`SNAPBACK_EXPO_CONTROL_VERB_UNKNOWN` with `supported: ['dev-fresh']`, and
`dev-fresh` is destructive — precisely what the Clique prompt forbids. A
non-destructive `reload-metro` is exactly the verb F1's recovery needed.
Second, the route has **zero occurrences under `guide/`**, so an agent
cannot find it even though its own supervisor descriptor names it.

This is not “agents cannot control the supervisor.” It is “the one
non-destructive thing an agent needs is missing from a control plane it
was never told about.” Any repair must start from the existing route, and
must justify a second control plane if it proposes one.

### F8. Competitor contrast: Expo papercuts are shared; identity is not

**Cluster:** contrast.
**Attribution:** observation.
**Confidence:** high as contrast, not as a ranking. *Audited.*

Shared with Convex/Supabase (not Snapback-owned): RN-web `Link asChild`,
controlled `TextInput` vs Playwright `fill`/`pressSequentially`, kit
`sm-profile` leading with “Edit profile,” feed tabs vanishing after
profile navigation, Linux iOS/Hermes environment-null, Chromium libraries
on 450a, instrument choreography tree not writable.

Snapback-only in this run: F1, F2, F3, F4's fence, F5, F7, and the
reads/writes/codegen.policy fork. Convex's hard M3 miss was the typing
clock plus no TTL primitive. Snapback *has* the TTL primitive and still
almost missed the same clock because of F4's fence.

Supabase was the only competitor with full M1–M3 authoring-green, and the
fastest complete green. That is existence evidence that the Clique bar is
passable on this host and instrument. Explicit's M2 stop is therefore not
“Clique is too hard.”

### F9. Auth dispatcher and profile hydrate are undocumented Snapback seams

**Cluster:** auth / React.
**Attribution:** snapback-defect (undocumented seam); lanes labeled
`agent-error`.
**Confidence:** high that the loops happened; medium that a product API
change is warranted. *Audited.*

Explicit lost `HANDLE_TAKEN` when `SessionShell` remounted `HomeScreen`,
and `setProfile` in the same tick as signup used the stale anonymous
dispatcher. Familiar's profile editor saved an empty handle before
`getMine` seeded. Generated mutations bind the auth identity at hook
call time; auth-gated trees unmount on session change. The start packet
does not say the order. Ticket:
`issues/20260826-guide-gap-signup-dispatcher-and-profile-hydrate.md`
(P17). No new auth API in that ticket.

## Inventory (every Snapback-attributed item)

Status (LLP 0315): **done** = landed in this tree; **in-progress** =
implementation started; **planned, not started** = a ticket and/or LLP
names the work, no code yet (an RFC in Review with no implementation
is this, not in-progress); **not-yet-planned** = no ticket and no LLP
track; **out of bar** = named and refused as a papercut-to-fix. Checked
2026-08-26 against `main`. None of the product-loop rows are published
in 0.1.27.

| ID | Lane | Cluster | Item | Attribution | Disposition | Status |
|---|---|---|---|---|---|---|
| P1 | explicit | identity | `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` after a same-owner successor: the successor graph publication and the backend activation both precede the remint, so a live arm can meet a predecessor binding, be **refused** (nothing is admitted), and never re-exchange | snapback-defect | RFC Track A (I2 boot-admission retry + I1 window narrowing); `issues/20260825-successor-expo-receipt-stale.md` | **implemented 2026-08-26 (not published)** — A2 client retry, A1 supervisor-driven Metro replacement after the remint, A3 live-arm coverage |
| P2 | explicit | lifecycle | supervised control route carries only destructive `dev-fresh`; no `reload-metro`; route undocumented; stdin `/dev/null` closes the stdin channel | snapback-defect | RFC Track E; `issues/closed/20260825-dev-control-channel-requires-stdin.md` | **done (Track E landed on `main`, not published)** — `reload-metro` and `stop-children` on the HTTP route and an owner-bound control socket sharing one verb implementation; `guide/operating/agent-controls.md` documents `controlPath` and every verb |
| P3 | both | generate | `SNAPBACK_EXPO_METRO_EXITED` on codegen `.tmp-*` ENOENT | snapback-defect | RFC Track C; `issues/closed/20260825-metro-exit-on-codegen-tmp.md` | **implemented 2026-08-26 (not published)** |
| P4 | familiar | provider | supervisor mint is boot-eager and adopted by default; hides password UI; signOut → `SNAPBACK_AUTH_SESSION_EXPIRED` | snapback-defect | RFC Track B; `issues/closed/20260825-supervised-expo-web-hides-password-ui.md` | **done (landed `15797fe10`, not published)** — bootstrap returns authority `unavailable`, adoption is an explicit capability-bearing POST, and `EXPO_PUBLIC_SNAPBACK_URL` is injected; familiar-page docs still owed |
| P5 | familiar | presence | the lane read `@expo/snapback-expo`'s presence types and concluded the facade **requires** an Expo lifecycle context a URL-first provider cannot give, so it switched packages. The runtime falls back and probably works (P20) — but the type and doc surface made the wrong reading the natural one, and that is the defect whichever way P20 lands | snapback-defect (discoverability, upgraded from docs-only under the pit-of-success standard) | RFC Track D; `issues/closed/20260825-ruling-3-vs-llp-0257-background-withdrawal.md` closed as "no conflict"; guide corrected | **done 2026-08-26** — P20 answered `works`; the three teaching pages now describe both hooks and their gated/ungated difference |
| P6 | familiar | presence | `touch()` generation-fenced; per-keystroke publish cancels | snapback-defect | RFC Track D; `issues/closed/20260826-activity-presence-one-generation-per-episode.md` | **implemented 2026-08-26 (not published)** |
| P7 | explicit | grammar | inline handler cannot capture a top-level `const` (`SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER`). Hoisting a shared regex to a module const is the ordinary JS move; the grammar refuses it and the lane had to discover that a function declaration is the admitted shape | snapback-defect (recovery, not grammar) — **re-dispositioned in r6**: the refusal may be by design, but a design that refuses the idiomatic spelling owes the reader the admitted one | RFC keeps the grammar with LLP 0108; `issues/closed/20260826-inline-handler-free-identifier-recovery.md` | **implemented 2026-08-26 (not published)** — the diagnostic names the admitted rewrite; `guide/backend/handler-runtime.md` and the expo-chat start packet warn first |
| P8 | explicit | grammar | durable custody unavailable on Node `memory` | snapback-defect | `issues/closed/20260825-guide-gap-memory-platform-durable-custody.md` | done (docs on main) |
| P9 | explicit | assets | `defineCommand` max one asset | known | existing `issues/20260815-finish-media-happy-path.md` / LLP 0239 | planned, not started (out of 0310.000 bar) |
| P10 | both | guide | `_generated/` still in packets; 0.1.27 refuses it | snapback-defect | `issues/closed/20260825-guide-gap-generated-directory-spelling.md` | done (docs on main; re-verified r3) |
| P11 | familiar | guide | `SNAPBACK_AUTH_STALE_RESULT` lookup hits assets page | snapback-defect | `issues/closed/20260825-guide-gap-stale-result-lookup.md` | done (docs on main) |
| P12 | explicit | guide | successor-mismatch diagnosis missing; the mismatch page does not cross-reference the remint the adjacent section documents | snapback-defect | `issues/20260826-guide-gap-same-owner-successor-mismatch.md` (independent of Track A) | done (landed `7bbb3b0bd`, not published) |
| P13 | familiar | env | inherited `CI=true` disables Metro watch | environment / known | already closed 0307 T1; supervised Metro also strips `CI` | done |
| P14 | both | ceremony | `reads`/`writes`/`refusals`, two authoring profiles | product | out of this RFC's repair bar | out of bar |
| P15 | familiar | auth | profile editor saved empty handle before `getMine` | snapback-defect (was agent-error) | folded into P17 | done (landed `c80a35f0c`, not published; same ticket as P17) |
| P16 | both | instrument | no `sm-nav-chats`; typing clock includes `pressSequentially` | instrument | genuinely outside Snapback's control — the instrument owns its own test IDs and its frozen clock, and no Snapback change would have prevented this | out of bar |
| P17 | both | auth | signup/profile save races the authenticated dispatcher; remount drops `HANDLE_TAKEN` | snapback-defect (undocumented seam) | `issues/closed/20260826-guide-gap-signup-dispatcher-and-profile-hydrate.md` | done (landed `c80a35f0c`, not published) |
| P18 | familiar | auth | the lane set conversations/members/messages `public-read` to make its queries reachable, and said in its own diary this was “not a production ACL.” A capable agent knowingly shipping a posture it calls wrong is a signal that the reachable-and-correct shape was too hard to reach | snapback-defect (authoring surface) — **re-dispositioned in r6** from “out of bar” under the pit-of-success standard | not this program's repair bar, but `issues/20260826-membership-scoped-query-reachability.md` now asks the design question rather than dismissing the row: what is the paved way to make a membership-scoped query reachable without widening the read posture? | planned, not started |
| P19 | explicit | identity | **reproduce** a schema successor under supervised `--expo --expo-platform web` with the `--json` stream retained, and record whether `binding-rotated` fired and what the next exchange carried | investigation | corroborates P1 (not a prerequisite — r4); settles which side of the predicate was stale; `issues/20260826-probe-successor-binding-rotation-json-stream.md` | planned, not started |
| P20 | familiar | presence | **re-test** `@expo/snapback-expo` `useSnapbackActivityPresence` under a bare URL-first `SnapbackProvider` on web; the “requires the Expo lifecycle context” premise is unverified and contradicted by the shipped fallback | investigation | settled Ruling 3's package boundary (there is none) and the LLP 0257 conflict; `tests/probes/expo-presence-bare-provider-20260826/`; `issues/closed/20260826-probe-expo-presence-facade-bare-provider.md` | **done 2026-08-26 — `works`** |

No row this program should fix is **not-yet-planned**, but two rows —
P19 and P20 — are investigations rather than repairs. **P20 gates** Ruling 3's
package boundary. **P19 gates nothing**: it corroborates a defect the source
already establishes, and settles which side of the mismatch predicate was
stale. Both were not-yet-planned when the r3 audit found them, and were
ticketed in the same landing. P17 was the
equivalent gap in the first inventory (observed, labeled agent-error, not
ticketed).

## Work to do

Implementation map, reconciled with `main` on 2026-08-26. Everything in the
first three sections is now landed; what remains is listed under
[Still open](#still-open). None of it is published — the Clique run measured
published 0.1.27, and every repair below post-dates that pin.

### Investigations — both run

| Do | Item | Result |
|---|---|---|
| Probe | **P20** — bare-provider facade presence on web | **`works`**. `tests/probes/expo-presence-bare-provider-20260826/`. No `SNAPBACK_EXPO_ACTIVITY_LIFECYCLE_UNAVAILABLE`, gated admission opened, one publish, with no lifecycle context in the tree. Ruling 3 rules **no package boundary**; LLP 0257 stands unamended; the conflict ticket closed as "no conflict"; the three teaching pages corrected. Kept as a standing regression test |
| Probe | **P19** — schema successor under supervised `--expo`, `--json` retained | `tests/probes/successor-binding-rotation-20260826/`. Samples **both** sides of the `admitAppBindingV1` predicate through the transition, so it settles the one thing the retained lane evidence could not: which side was stale. Not a gate — the ordering defect was already established from source |

### Landed — product

| Item | Track | Where |
|---|---|---|
| Generate must not kill Metro: codegen stages the candidate graph, its materialization copy, and its rollback backups outside the project root | C (P3) | `packages/snapback-codegen/{index,review-surface}.mjs`; `issues/closed/20260825-metro-exit-on-codegen-tmp.md` |
| `reload-metro` and `stop-children` on `POST /_snapback/expo/v1/control`, plus an owner-bound control socket sharing one verb implementation | E (P2) | landed on `main` ahead of this reconciliation; `issues/closed/20260825-dev-control-channel-requires-stdin.md` |
| A supervised-dev mismatch is retryable at boot admission instead of terminal (I2), with the attempt bound derived from the activation request budget rather than a round number | A (P1) | `packages/snapback-expo/provider.mjs` |
| After the remint publishes the successor binding, the supervisor drives a Metro child replacement through the shared control lane, so the live arm re-imports and re-exchanges promptly (I1) | A (P1) | `packages/snapback-cli/expo-dev.mjs`. **Narrows** the window; LLP 0310.000's open obligation W2 (the residual activation window) stands |
| One `touch()` generation per typing episode, with a session-epoch fence so idle expiry discards queued work | D (P6) | `packages/snapback-react/implementation.mjs`; `issues/closed/20260826-activity-presence-one-generation-per-episode.md` |
| Mint on demand, explicit adoption, sign-out to the password UI | B (P4) | `15797fe10`; `issues/closed/20260825-supervised-expo-web-hides-password-ui.md` |
| The free-identifier refusal names the admitted rewrite | — (P7) | `packages/snapback-codegen/inline-handlers.mjs`; `issues/closed/20260826-inline-handler-free-identifier-recovery.md` |

### Landed — guide

| Item | LLP 0310 item |
|---|---|
| Same-owner successor on the binding-identity-mismatch diagnose page | P12 (`7bbb3b0bd`) |
| Signup → wait for the authenticated dispatcher / seeded profile | P17, including P15 (`c80a35f0c`) |
| `controlPath` and every control verb, on both planes | P2 (`guide/operating/agent-controls.md`) |
| Supervised mint behavior and the binding origin on the familiar page | P4 |
| Both presence hooks and their gated/ungated difference, in place of a package boundary | P5 / P20 |
| The inline-handler capture rule, on the handler-runtime page and in the expo-chat start packet | P7 |
| `_generated/` spelling; `SNAPBACK_AUTH_STALE_RESULT` lookup; `memory` durable custody | P10, P11, P8 |

### Still open

| Item | Why it is still open |
|---|---|
| Publication | Nothing above is in published 0.1.27. The repairs reach agents only on the next publication (LLP 0041 posture: publish rapidly and often) |
| LLP 0310.000 W2 — the residual activation window | I1 narrows it; the RFC records closing it as an open obligation, and it needs the arm-side seam A2's acceptance row names |
| B1 against the landed Track B code | The RFC's row was written against its own text, not the implementation that shipped at `15797fe10` |
| The LLP 0258 D5 precedence obligation | Track B's explicit-adoption row shipped without a recorded D5 amendment. Whether it needs one is a question for LLP 0258's owner about shipped code |
| **P18** — membership-scoped query reachability | Needs a design owner. `issues/20260826-membership-scoped-query-reachability.md`. The declarative path exists and is documented (`.visibility({ kind: 'membership', … })` on `guide/auth/protecting-data.md` and `guide/backend/familiar-profile.md`), so the live question is narrower than "does it exist": why did an agent that went looking not reach it |
| **P9** — `defineCommand` max one asset | Other program: LLP 0239 / `issues/20260815-finish-media-happy-path.md` |

### Out of bar

P14 (ceremony) and P16 (instrument) stay out, on the reasons recorded in the
inventory rather than on a label.

## Confidence and non-claims

- High: the observations in P1, P3, P4, P6, P10–P12, P17 happened as
  described in hash-backed reports.
- High: F1's *artifact* correction (the `extra` receipt is not the admit
  operand), F7's route existence, and F4's fallback reading — all three
  re-checked at named symbols on `main` and independently confirmed by both
  round-3 reviewers.
- High: F1's **ordering defect** — the successor graph is published and the
  backend activates before the remint — established from source and confirmed
  by four independent reviews across two model families.
- Inference, not established: the **interleaving** in this particular run.
  Metro HMR and the provider re-boot are asynchronous and unordered against the
  remint, so the source shows a race, not a trace. P19 settles it.
- Inference, not established: **which side** of the mismatch predicate the lane
  observed as stale. The retained evidence names the M1 identity from the Expo
  `extra`, not from a bootstrap response, and no `mismatches[]` payload was
  dumped. P19 settles it.
- Open: F4's package-split premise (P20).
- **Withdrawn:** the r1/r2 claim of a regression versus 0.1.24/0.1.25.
  The cited diaries do not support it. Anything downstream of that claim
  — including the suggestion that LLP 0302's landing is implicated —
  is withdrawn with it.
- Not claimed: that Familiar is faster than Explicit, that 0.1.27 is
  worse on wall than 0.1.25, or that weakening LLP 0302 admission is the
  fix.

## Open questions

1. ~~Why did the shipped `rotateBindingAfterLoad` remint not reach the web
   arm on a schema successor?~~ **Answered in r4, refined in r5:** it fires
   after both the successor graph publication and the backend activation, so a
   live arm can refuse against the predecessor binding and never re-exchange.
   P19 remains open to corroborate the interleaving and to settle which side of
   the predicate was stale.
2. Should the supervisor's non-destructive control verbs live on the
   existing `/_snapback/expo/v1/control` route, or does something require
   a second, socket-based plane?
3. Does the `@expo/snapback-expo` presence facade actually fail under a
   bare URL-first `SnapbackProvider` on web? (P20.)
4. Is `touch()` generation fencing load-bearing for presence correctness,
   or can a typing heartbeat reuse one generation?

Those are ruled, or explicitly held open, in LLP 0310.000.

## Revision history

- 2026-08-26 (r7) — round-6 punch-list delta. Correction pass: narrowed the
  Summary's "located in source" to the ordering defect (the run's interleaving
  stays inferred), aligned the work map with LLP 0310.000's withdrawal of the
  publish-before-activate reordering and its demotion of mint adoption to an
  LLP 0258 D5 obligation, and fixed a markdown heading that had been appended
  to the preceding paragraph. No new content.
- 2026-08-26 (r6) — round-5 dual review (both families NOT READY). Actually
  removed the "client admitted a binding naming the M1 descriptor" clause from
  the P1 inventory row, which r5's revision note claimed to have fixed but did
  not — `admitAppBindingV1` refuses and admits nothing. Narrowed "root cause
  located" to the ordering defect, keeping the run's causal interleaving
  inferred. Removed the withdrawn I1 ordering from the work map. Adopted the
  author's **pit-of-success standard** for agent-error attribution and
  re-dispositioned P5 (upgraded to a discoverability defect), P7 and P18
  (both moved off "out of bar" into named obligations), with P16 kept out of
  bar on an explicit reason rather than a label.
- 2026-08-26 (r5) — round-4 dual review (one family READY on this document,
  one NOT READY). Corrected the P1 inventory row, which still asserted the
  stale predicate side as fact after the narrative had demoted it to inference,
  and which said the client "admitted" a binding when `admitAppBindingV1`
  refuses. Removed the leftover claim that both probes gate design. Restated
  F1's concurrency as a race the source cannot settle, with the publication
  point corrected to `generateApp`. Fixed `fallback`/`status: 'error'`
  terminology.
- 2026-08-26 (r4) — round-3 dual review (both families NOT READY on this
  document). Both families located F1's root
  cause from source, retiring r3's "unlocated" framing and unblocking P1 from
  P19. Held "which side of the predicate was stale" open as inference rather
  than audited fact. Corrected r3's description of the rotation test's coverage
  and retired the schema-vs-functions hypothesis. Narrowed the historical claim
  from "never been proven on a Clique clock" to "none of the cited baselines."
  **This revision is unreviewed:** the cluster's round budget was exhausted by
  round 3.
- 2026-08-26 (r3) — source audit against `main` and against the cited
  diaries. Withdrew the 0.1.24/0.1.25 regression claim and added the
  [Historical contrast](#historical-contrast) table. Re-attributed F1
  from the config-plugin extra to the supervisor-issued binding, named
  the shipped `rotateBindingAfterLoad` remint and its functions-only test
  coverage, and marked the root cause unlocated. Rewrote F7 around the
  shipped `/_snapback/expo/v1/control` route. Downgraded F4's package
  split to unverified and kept its fence at high confidence. Corrected
  F3's framing from a missing env variable to the ambient mint. Added
  P19 and P20 and filed their probe tickets.
- 2026-08-26 — work-to-do map (ticket-only vs RFC). Filed P12, P6, and
  P17 tickets. Reclassified P15 as the Familiar half of P17. Added F9
  and P18 (out of bar). Inventory Status column (LLP 0315 vocabulary)
  from earlier the same day.
- 2026-08-25 — initial Draft from the grok 4.6 xhigh 0.1.27 Clique
  diaries.
