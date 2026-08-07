# G2 S1 fleet lane (g0-js-lane c7a8b9031): pre-landing review findings + delta branch

**Filed:** 2026-08-06
**Context:** Two concurrent sessions executed LLP 0176 G2 / LLP 0179 S1 today.
The `g0-js-lane` session's `c7a8b9031` (`feat(codegen,react,expo): conversation
surface + useSurface`) is the adopted S1 base — an independent adversarial
review (fresh worktree, all gates run) confirmed its core proofs are real:
registry delegation with strict snapshot identity, presence identity refusal
at the `surfaceOptions()` chokepoint, no fabricated `data`, param/authority
replacement fencing, complete binding map, commands closed. This ticket is the
coordination channel for what that review found **must land with or
immediately after it** — addressed to the session that owns `g0-js-lane`, from
the session that owns `g2s1/codegen` (the superseded parallel codegen lane,
retained as salvage).

## Landing blockers found at c7a8b9031

1. **Fresh-checkout CI breakage (high).** `surface.test.mjs:19`,
   `snapback-expo/provider.test.mjs:23`, and `exact-result-types.fixture.ts`
   read gitignored `demos/expo-golden-path-fixture/snapback/generated/*`
   (`.gitignore:14`). All suites are green only after regenerating the demo
   artifacts; on any fresh clone/CI they are red. Needs a committed fixture
   snapshot inside the packages or a pretest generate step.
2. **`check-generated-artifacts` red (high).** The S1 `define.mjs` change
   rotates generated identity corpus-wide; `c7a8b9031` refreshed only
   comparator/push-seam/golden-path. `demos/latency-kanban` fails
   `TRUSTED_COMPOSITION_ACTIVATION_INVALID` and needs an activation rebind;
   the rest of the demo corpus needs the refresh. (Gate was already red at
   `e32f35eb3` for a different staleness — refresh cures both.) Do the
   refresh against the landing HEAD, not a stale base, or it will chase main.
3. **Budget refusal missing (medium, RFC conformance).** LLP 0179 §Binding is
   not authorization refusal #7 (member/budget limits) is unimplemented; the
   commit message's "budget … ride[s] the existing validation lane" is an
   overclaim (it also lists budgets as deferred).
4. **Fixture-less refusal codes (medium).** `_PARAMETER_TYPE_MISMATCH`,
   `_REQUIRED_INPUT_UNBOUND`, `_REFERENCE_UNKNOWN`,
   `_MEMBER_CLASS_UNSUPPORTED` (incl. the commands refusal) have no negative
   fixtures.
5. **No surface-free emission-stability test (medium).** Nothing pins that a
   surfaceless app still emits unchanged `app.d.ts` text and `surfaces: {}`.
6. **Headless owner wording (low).** LLP 0179 §Headless says
   `client.surface(...)`; shipped as `provider.surface` /
   `observeSnapbackSurface` in `snapback-react` per the existing
   observer-seam precedent. One registry, one owner — fine — but 0179 needs a
   wording reconciliation or a client-side alias at G2 close-out.
7. **Bundle ratchet context.** The react-external +35% step
   (`issues/20260806-client-bundle-ratchet-red-on-main.md`) is pre-existing
   (measured at `167a9e080`, an ancestor), but `c7a8b9031` adds ~411 lines to
   `snapback-react/index.mjs` and compounds it. The disposition that issue
   requests should be obtained at landing.

## Delta branch (being built now)

Branch `g2s1/delta-on-fleet` (worktree `snapback-wt/g2-delta`), on top of
`c7a8b9031`, ports from the superseded `g2s1/codegen` lane and adds: budget
enforcement (`SNAPBACK_SURFACE_BUDGET_EXCEEDED` + numeric constants),
hermeticity fix for item 1, negative fixtures for item 4, stability test for
item 5. Item 2 (corpus refresh + rebind) is deliberately left for landing
time against the landed HEAD. If the `g0-js-lane` session prefers to absorb
any of these into its own landing, take them — coordinate by editing this
ticket; the delta session will rebase around whatever has landed.

## Resolution criteria

Close when S1 + delta are on main with all four package suites green from a
fresh checkout, `check-generated-artifacts` green, and the budget refusal
implemented with a fixture. Move to `issues/closed/` with landing SHAs.

## Addendum 2026-08-06 (llp0187-finish run): all three wedged activations enumerated

The `TRUSTED_COMPOSITION_ACTIVATION_INVALID` refusal noted above for
`demos/latency-kanban` also affects `demos/triage-graph` and
`demos/zero-bakeoff/apps/contention-calendar` — verified failing identically
on pristine `origin/main` (b0332f82b), so `check-generated-artifacts` and the
review-surface index check cannot run green from any fresh checkout until all
three activations are rebound. The llp0187-finish artifact-rotation commit
excluded these three backends and verified the review surface over the
remaining roots; whoever performs the rebind should re-run the full
unexcluded gate.

## Resolution 2026-08-06 (delta landing run)

`g2s1/delta-on-fleet` rebased onto `origin/main` and landed. Items 1–5 are
resolved; items 6 and 7 are re-homed rather than closed here (see below).

### What landed

Landed SHAs on `origin/main` (rebased onto `ded064bfd`, pushed 2026-08-06):

| commit | what |
| --- | --- |
| `9b0531de3` | item 1 — hermetic surface fixture `packages/snapback-react/fixtures/conversation/app/snapback` |
| `c7aa4eae5` | item 3 — `SNAPBACK_SURFACE_BUDGET_EXCEEDED` + five ceilings, five negative fixtures |
| `6d6fe7d04` | items 4 and 5 — the five fixture-less surface refusals, plus the surfaceless-emission pin |
| `bc9320ba5` | registers `guide-pointer.test.mjs` in the canonical test inventory (a separate main red, inherited from `6da170bf1`) |
| `4d38a23df` | item 2 — trusted-composition activation rebind for the three wedged backends |
| `e2a2d2dfc` | this close-out |

### Rebase resolution (item 1 vs. main's G2 work)

`main` gained `b0332f82b` (G2 falsification checkpoint) and `ec49b1d27`
(descriptor-mode cold retained boot) after `c7a8b9031`. `b0332f82b` rewrote
Relay Room's backend and rewrote `surface.test.mjs`,
`provider.test.mjs`, and `exact-result-types.fixture.ts` against the new shape
(`messagesForConversation`, `addReaction`, `sendText`, typing with an authored
`displayName`, retained/refusal cases). Git merged the delta textually with no
conflict markers, but the result was semantically broken: the tests asserted
the new Relay Room shape against a fixture built from the pre-`b0332f82b`
shape. The resolution preserves both intents — the fixture backend was
re-authored to mirror the conversation half of Relay Room (five tables, five
reads, `sendText`/`sendReply`/`addReaction`/`removeReaction`, the
`messageImageUpload` asset lane, typing with `displayName`) and its closure
regenerated, so main's new test bodies run verbatim against a committed,
fresh-clone-safe closure. It omits only Relay Room's demo-local receipt-notes
lane and the `sendImage` JS mutation, which no package suite exercises. No
delta hunk was dropped as redundant.

### Item 5's premise was wrong, and the correction matters

The ticket said "nothing pins that a surfaceless app still emits **unchanged**
`app.d.ts` text". That is not what happened: the S1 grammar made the surface
type block unconditional, so a surfaceless app's `app.d.ts` moved from
`export type SurfaceDescriptor = never;` to the full
`SurfaceMemberDescriptor`/`SurfaceDescriptor` preamble with an empty
`GeneratedAppSurfaces` body. Every committed `app.d.ts` in the corpus rotated
once. `20dfe3460` therefore pins the **post-S1** shape rather than asserting
non-rotation. Confirming evidence: the surfaceless Contention Calendar closure
gains exactly that block in `3ac8fe2fc` (`app.d.ts` +26/-6), and the
surfaceless Team Chat and push-seam closures took the same rotation on `main`
at `482bdabc0`. So the corpus refresh covered surfaceless apps too — the three
wedged activations were the only holdout.

### Item 2 — how the rebind was done

Not by hand-editing JSON. Following
`issues/closed/20260803-p3-triage-successor-app.md`: bootstrap linked and
handler-VM-qualified the current source, codegen produced the unactivated
manifest pair, `snapback composition-activation-prepare` minted a server-owned
key in a task-local database and prepared the successor for each backend's own
deployment id, and ordinary codegen validated and published it. Task-local
databases and private keyrings were deleted; only the public activations and
review manifests are retained. Deployment ids, target profiles, and auth modes
are unchanged. The **full unexcluded** `./scripts/check-generated-artifacts`
then exits 0.

### Gate results at the landed tip

- `bun run --cwd packages/snapback-react test` — 0 (includes the
  `exact-result-types.fixture.ts` strict `tsc` check)
- `bun run --cwd packages/snapback-expo test` — 0
- `bun run --cwd packages/snapback-client test` — 0
- `bun run --cwd packages/snapback-codegen test` — 0
- `node scripts/check-package-test-inventory.mjs` — 0 (218 declared test files)
- `./ref-check --verbose` — 0 (188 LLP docs, 3410 refs, 0 errors)
- `./scripts/check-generated-artifacts` — 0

One honest caveat on "green from a fresh checkout": the three package suites
this ticket's item 1 named are now hermetic, but
`packages/snapback-codegen/data-tier-corpus.test.mjs:57` reads gitignored
`demos/all-aboard/snapback/generated/functions.manifest.json`, so the codegen
suite alone is still red on a clone until `check-generated-artifacts` has run
once. That dependency is pre-existing and unrelated to S1; it is re-homed to
`issues/20260806-data-tier-corpus-fresh-clone-nonhermetic.md`, which also
corrects an assumption made in passing during this run (the obstacle to a
package-local mirror is `CODEGEN_IMPORT_UNRESOLVED`, not
`CODEGEN_IMPORT_OUTSIDE_IDENTITY_ROOT` — `REPO_ROOT` is an allowed identity
root).

### Items 6 and 7 stay open, elsewhere

- **Item 6 (LLP 0179 §Headless wording).** Unresolved by design: this is a
  documentation reconciliation, not a landing blocker. It belongs to the **G2
  close-out doc commit** — 0179 §Headless still says `client.surface(...)`
  while the shipped owner is `provider.surface` / `observeSnapbackSurface` in
  `snapback-react`. Owner: whoever writes the G2 close-out.
- **Item 7 (client bundle ratchet).** Already tracked at
  `issues/20260806-client-bundle-ratchet-red-on-main.md`, which is explicit
  that the baseline must not be rolled forward without an attribution ruling.
  This landing adds no new client bytes beyond what `c7a8b9031` already
  contributed, and takes no position on the disposition. Owner: Charlie
  (author decision pending). Cross-referenced, not duplicated.
