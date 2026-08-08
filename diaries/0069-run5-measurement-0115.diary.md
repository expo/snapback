# Diary 0069: Run 5 — four lanes on 0.1.15, zero framework defects

**Date:** 2026-08-08
**Method:** benchmarks/ harness (first run executed from the committed
harness — lane prompts instantiated from `benchmarks/lanes/*` +
`briefs/messaging.md`; one extraction papercut noted below). Same brief,
machine, model, serial discipline as runs 0065/0066/0068.

## The table

| Metric | S-bare (web) | S-skill (web) | S-native (sim) | Convex |
|---|---:|---:|---:|---:|
| Wall | 29m35s | **19m00s** | 25m14s | 10m18s |
| Tokens | 212,072 | 201,268 | 249,556 | 89,793 |
| Loops (framework) | 6 (~2) | 7 (**0 backend**) | 8 (**0 framework**) | 1 (0) |
| Wall ratio | 2.87x | 1.84x | 2.45x | 1x |
| Token ratio | 2.36x | 2.24x | 2.78x | 1x |

Series (skill lane): wall 26m22s → 19m00s; tokens 328.9k → 226.0k →
201.3k. Convex also posted its best-ever run (10m18s / 89.8k — previous
band 12.5–16.6m / 101–113k).

## Reading it

**The absolute trend is unambiguous; the ratio is inside the noise.**
Every Snapback lane posted its best-ever wall and tokens, and — for the
first time in five runs — **zero framework defects appeared in any
Snapback lane's loop list**: the skill lane's entire backend passed
codegen and typecheck first-try, the native lane had zero failed
`snapback` invocations, and offline cold boot worked first-try in all
three lanes through the paved cached-binding lane. But Convex's own run
improved even more (−38% wall), so the ratio moved 1.59x → 1.84x wall /
2.00x → 2.24x tokens. With N=1 per config and a demonstrated ±30%
per-lane variance band, ratio movement of this size is not a signal in
either direction — exactly LLP 0186 OQ2's point. Claiming the trend
either way requires the N≥3 protocol; the harness now exists to run it.

**The papercut layer held.** The 0.1.15 template defaults did what they
were built to do: the bare lane no longer builds sessions custody,
offline registration, or upload plumbing (29.6m vs 41.5m yesterday), and
the skill lane spent its time on product UI. The remaining friction is
knowledge-shaped, not defect-shaped — see residue.

**Where remaining tokens go:** Convex's lane again consumed zero
documentation (prior familiarity), while Snapback lanes still read the
guide and, at the edges, package source. The orientation gap is now the
dominant term, as predicted; it shrinks with training-data presence, not
engineering.

## Residue (ticketed round 3)

1. **expo-chat template lacks web platform/deps** (`react-dom`,
   `react-native-web`, `@expo/metro-runtime`, `"web"` in platforms) —
   both web lanes' longest single loop, two runs running.
2. **`ctx.db` verb set is undocumented** — the native lane extracted
   `query/withIndex/eq/collect/take/delete` from runtime binary strings;
   the mutations guide page shows only insert/patch.
3. **Headless client call shape ambiguity** — `{ args: {...} }` nesting
   vs the guide's flat-reading snippet.
4. **Simulator-proof recipe gaps** — the guide's plutil deep-link recipe
   fails on dotted keys (plistlib works); Expo Go onboarding-sheet
   dismissal; collect the headless-simulator tricks in one place.
5. **verify-config authoring contract** lives only in `verify.mjs`
   source (second run finding this).
6. **Offline env coupling discoverability** — the bare lane still
   excavated `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` from package
   source (the skill lane got it from trap 12 — the skill works, the
   guide anchor is still missing).
7. Harness papercut: the brief's "Lane-prompt block" heading carries a
   parenthetical the README's extraction instructions don't mention.

## For the ratchet

Standing numbers (N=1): skill-web 1.84x wall / 2.24x tokens. The correct
next W1 step is not another single run but the N≥3 repeat protocol on
this exact configuration to establish the variance band before any
public claim; the equal-proof-bar brief remains the strongest published
chart candidate.
