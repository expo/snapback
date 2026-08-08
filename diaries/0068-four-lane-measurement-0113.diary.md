# Diary 0068: Four-lane measurement on 0.1.13 — the fix layer's referendum

**Date:** 2026-08-07
**Method:** same brief, discipline, machine, and model as diaries 0065/0066
(serial cold-context lanes, harness token metering, published surfaces
only). New this run: the native-carrier lane (iOS Simulator, headless
`simctl`, deep-link drive channel) and a same-day Convex control.

## The table

| Metric | S-bare (web) | S-skill (web) | S-native (skill) | Convex |
|---|---:|---:|---:|---:|
| Wall | 41m32s | 26m22s | 37m36s | 16m36s |
| Tokens | 254,535 | 225,992 | 263,873 | 113,207 |
| Loops (framework) | 13 (~4) | 9 (3) | 6 (1) | 5 (1) |
| Wall ratio vs Convex | 2.50x | **1.59x** | 2.27x | 1x |
| Token ratio vs Convex | 2.25x | **2.00x** | 2.33x | 1x |

## The series (skill-equipped lane vs Convex)

| Run | Basis | Wall ratio | Token ratio |
|---|---|---:|---:|
| Diary 0058 | in-checkout, Codex | 2.32x | unmeasured |
| Diary 0065 | npm 0.1.10, bare | 2.94x | 3.26x |
| Diary 0066 | npm 0.1.12 | 4.57x | 2.95x |
| **Diary 0068** | **npm 0.1.13** | **1.59x** | **2.00x** |

## Reading it

**The seven-fix layer worked.** Yesterday's structural wall regression
reversed completely: the web carrier that both 0066 lanes fought is
simply paved (Expo web, image e2e, and offline retained render all
first-try in every lane), the supervised offline receipt-fallback worked
first try on BOTH carriers, and framework-caused loops fell from 7-8 per
lane to 1-3 — every survivor is a papercut, not a wall. The bare lane
halved its wall time and cut tokens 25% against yesterday on the same
brief.

**The native carrier holds.** All seven proofs ran on the simulator with
zero web fallbacks, and the lane's verdict is quotable: "the promised
golden path holds on the simulator; a first-time agent's real risk is
environment noise, not the framework" — its single longest detour was an
Apple emoji-rendering bug in the iOS 26.3 simulator runtime (26.5 is
fine), with Snapback proven byte-clean in the hunt.

**What the remaining ~2x tokens is.** Not walls: it is (a) residual
orientation cost against Convex's total training-data familiarity (the
Convex lane again consumed zero documentation), and (b) deeper proof
surface — the Snapback lanes register real verify profiles and prove
platform retention with honest facts, while the Convex lanes hand-roll a
~60-line cache their own reports describe as "not a real sync story"
(offline writes would be lost). The scoring rubric, not the ratchet,
is where that asymmetry gets credited.

**The bare/skill distinction is collapsing by design.** The scaffold now
ships the skill, so even the bare lane read it post-scaffold; the skill
lane's remaining edge (~36% wall) is pre-scaffold routing — template
choice, sessions-before-uploads, schema-shaping traps. As the templates
absorb those defaults, the two lanes should converge.

## Residue found this run (ticketed 2026-08-07, round 2)

1. **expo-chat template gaps**: omits `expo-crypto` (the headline offline
   capability silently stays in-memory unless the guide page is read) and
   ships upload UI in dev mode where uploads cannot work (the exact
   contradiction the skill warns about, now embedded in the template).
2. **`createAssetClient` root-export mismatch** — declared in the root
   `.d.mts`, absent from the root `.mjs`.
3. **`session mint --ready-file` still demands `SNAPBACK_ADMIN_TOKEN`**
   despite holding the ready file.
4. **Sessions-mode non-session clients** (admin/inspect) need
   `authClientProtocol: 1` + `custody: 'anonymous-public'` together — hit
   by two lanes, spelled out nowhere as a pair.
5. **Skill gaps round 2** (six lines): headless commands live at
   `app.commands.*`; the root-export gap; supervisor reclaim-on-exit
   semantics for "stop backend, keep client" proofs; verify-config
   authoring pointer; the sessions client-construction pair; `dev --expo`
   never launches a device.

Recurring environment note, not a Snapback defect: Metro's file watcher
is blind under `/private/tmp` (three runs now) and `CI=1` silently
disables watching — both cost stale-bundle loops in multiple lanes.

## For the W1 ratchet

New standing numbers, published-consumer basis, 0.1.13: **skill-web
1.59x wall / 2.00x tokens** (primary), bare-web 2.50x / 2.25x, native
2.27x / 2.33x. First native-carrier baseline established. The
publication-gate question from LLP 0186 W1 is now live rather than
theoretical: these are numbers one could publish with the fairness notes
attached. Remaining W1 work unchanged: formalize the harness under
`benchmarks/`, add the CRUD and media briefs, and the Supabase/PocketBase
/Postgres lanes.
