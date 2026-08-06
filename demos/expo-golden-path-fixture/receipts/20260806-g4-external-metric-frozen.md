# LLP 0176 G4 external-consumer ceremony metric — frozen before measurement

**Frozen:** 2026-08-06 12:12:11 PDT (epoch `1786043531`)  
**Status:** proposed metric, author sign-off pending  
**Measurement target:** a clean external repository created after this receipt
at `/Users/ccheever/projects/snapback-g4-external`  
**Authority:** LLP 0176 §G4 and OQ5; this receipt proposes a measurement shape
but does not settle OQ5.

At freeze time the target directory has not been created and no G4 install,
scaffold, source authoring, generation, or runtime command has been run. This
file fixes the counting rules and comparison baseline before any result is
known.

## Primary metric: cumulative author-action vector

Report the cumulative vector `C/F/D` and its sum `A = C + F + D` at each
milestone:

- `C` — **commands typed:** each distinct shell command submitted to create,
  configure, install, generate, run, diagnose, or repair the external app.
  Repeating a command counts again. A compound shell line counts each
  independently useful program invocation, so command chaining cannot lower
  the score. Read-only evidence capture after a milestone does not change that
  milestone's already-frozen count.
- `F` — **files hand-edited:** each distinct application/backend/configuration
  file whose contents an external author must choose or modify. Generated
  files, lockfiles, installed packages, receipts, screenshots, and the action
  ledger do not count. Revisiting a previously counted file does not add a
  second `F`; the diagnostic time and repeated commands still expose rework.
- `D` — **author decisions:** a choice among materially plausible alternatives
  not selected by the guide or scaffold. Examples include choosing an
  undocumented package set, inventing an auth/bootstrap seam, selecting a
  workaround after a refusal, or deciding which generated identity is
  canonical. Purely following an explicit guide instruction is not a
  decision. Each decision is named in the final receipt; judgment is never
  inferred from command count alone.

The vector, not only `A`, is primary: `4/12/1` and `12/4/1` expose different
product friction even though both sum to 17.

## Milestones and clock

- `t0`: immediately before the first command that creates or initializes the
  external directory.
- `m1 — first rendered live query`: the first simulator/emulator screen render
  whose data came from the generated surface over a current live Snapback
  query. A static seed in source, headless-only response, loading state, or
  retained-only row does not qualify.
- `m2 — first committed image send`: an Expo picker image is passed to the
  generated `commands.send`, the command reports proved `committed`, the live
  query delivers the new message, and the delivered image renders. Upload-only,
  mutation-only, optimistic-only, or operator-seeded bytes do not qualify.
- Wall clock is secondary and uses monotonic/epoch timestamps captured at
  `t0`, `m1`, and `m2`. Waiting on dependency downloads, code generation,
  backend boot, Metro, and the selected simulator/emulator remains included;
  subsequent cross-platform repetition and closure checks are reported
  separately.

The external repository retains a chronological action ledger. The final
receipt reports raw events and the derived `C/F/D` counts so the measurement
can be recounted under a later author-ratified OQ5 rule.

## Guarantees ledger: no omitted-guarantee discount

Each row finishes as `proved`, `present but not independently proved`,
`missing`, or `not applicable`. Anything other than `proved` remains visible
beside the ceremony number.

| Guarantee held constant | Required G4 evidence |
| --- | --- |
| Settled Sessions auth | Schema settles Sessions mode; supervisor mints and provider adopts an ordinary session; no admin/impersonation bearer enters app code. |
| Loopback-only listeners | Every supervisor-owned host listener is enumerated as loopback; Android uses verified port forwarding/reverse only. |
| Typed contracts and one descriptor | Codegen emits and the app consumes the generated descriptor/surface/command types; no string operation mirror or second app model. |
| Retained cold boot | After one current query, a cold app relaunch can render the retained snapshot with truthful retained/connection facts; this does not claim offline mutation or local handler execution. |
| Truthful command residue | Success is called committed only after mutation settlement; a finalized-then-refused probe reports the public command task's actual `inferred`/`unknown` unattached fact and never fabricates rollback or safe deletion. |

The iOS simulator and Android emulator rows are explicitly **NOT an LLP 0064
claim**. No physical-device evidence path exists for this run.

## Bakeoff baseline frozen before G4 measurement

The requested Diaries 0058/0059/0060 do not contain a retrospectively
recountable `C/F/D` action ledger or milestone split, so no synthetic action
count will be invented. The comparison will use their recorded facts and name
the asymmetry:

| Source | Recorded comparison fact available before G4 | Asymmetry versus this metric |
| --- | --- | --- |
| Diary 0058, Relay Room bakeoff | Full Snapback lane `26m03s`, Convex lane `11m15s`; 1,202 vs 868 hand-authored source/test lines and 14 vs 13 files. Convex records `bun add convex` and one `convex dev --configure new --once --project relay-room-bakeoff`; the Snapback narrative records scaffold/install/codegen/bootstrap/manual-load work but not a complete command ledger. | Full-app completion, debugging, proofs, bundles, offline acceptance, and ticket filing—not `m1`/`m2`; LLP/guide orientation was excluded and mostly Snapback-specific; file/line proxies are not author actions. |
| Diary 0059, Tandem bakeoff | Shared UI 881 lines; Snapback backend/adapter 602 lines plus 138-line trusted launcher; Convex backend/adapter 424 lines. Both behavioral suites were 8/8; both paid EAS ad hoc builds completed. | No wall-clock or command log; shared UI and seeds/tests are counted differently; paid EAS builds exceed G4's stage-only boundary; neither result is a physical-device interaction receipt. |
| Diary 0060, orchestration diary | Two agents each ran roughly 15–20+ minutes; it records worktree/rebase/push ceremony and says the orchestration agent did not rerun either app. | This is orchestration/landing evidence, not an app-authoring lane, and has neither per-stack milestone timing nor author-action counts. |

Diary 0058 also states its comparison favored Snapback by excluding a shared,
mostly Snapback-specific orientation phase. G4 includes guide-driven decisions
in `D` when the guide does not determine the external path, but does not count
the pre-`t0` orientation commands themselves.

## Claim boundary

This receipt freezes only a proposed measurement method. It makes no claim
that published 0.1.10 contains the documented surface/command shape, that G4
passes, that an EAS build ran, that an Expo release artifact was produced, or
that LLP 0064 is satisfied.
