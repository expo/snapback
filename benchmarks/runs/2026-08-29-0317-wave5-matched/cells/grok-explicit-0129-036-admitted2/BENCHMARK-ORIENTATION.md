# Benchmark orientation — grok-explicit-0129-036-admitted2

Generated for lane kind `snapback-web-clique`. All links use the lane-local
`instrument/` snapshot link so their bytes stay stable across run
layouts; never resolve a missing item against a live checkout.

## Scope and contract

- Build Clique for `M1`, `M2`, `M3`, `M4`, `M5`, `M6`, `M8`, in order, as a web-only Expo Router lane.
- Backend/profile: Snapback `snapback-explicit-v1`; package pin: `@expo/snapback-*@0.1.29`.
- Interaction proof uses two browser contexts and the frozen choreography.
- Device launch, Simulator proof, EAS delivery, and generic scaffold substitution are out of scope.
- Instrument pin: `social-messenger@0.3.6-m8`; choreography: `0.3.6-m8`; applicability: `0.3.0-m8`.
- Product behavior: [social-messenger brief](instrument/briefs/social-messenger.md) (snapshot `briefs/social-messenger.md`).
- Shared names, IDs, determinism, and fixture grammar: [coordination contract](instrument/tools/social-messenger/CONTRACT.md) (snapshot `tools/social-messenger/CONTRACT.md`).

## Assertion applicability

Map every in-scope `suite-required` assertion to a test. Choreography,
simulator, and grader assertions retain their declared executors. Details:
[assertions.json](instrument/schema/social-messenger/assertions.json) (snapshot `schema/social-messenger/assertions.json`) and
[applicability.json](instrument/schema/social-messenger/applicability.json) (snapshot `schema/social-messenger/applicability.json`).

| Milestone | Scope | Suite | Choreo | Grader | Simulator |
| --- | --- | ---: | ---: | ---: | ---: |
| M1 | Accounts and profiles | 7 | 3 | 3 | 0 |
| M2 | Posts and the follow graph | 22 | 5 | 0 | 0 |
| M3 | Messaging core | 7 | 8 | 0 | 0 |
| M4 | Media messages, reactions, edit/delete | 5 | 5 | 2 | 0 |
| M5 | Ephemeral, chat config, search | 6 | 2 | 4 | 0 |
| M6 | Offline writes, push seam, custom-client API | 5 | 7 | 1 | 0 |
| M8 | Insights, digest, and multi-device offline | 6 | 7 | 5 | 0 |

## Fixture entrypoints

- Personas: [personas.json](instrument/fixtures/social-messenger/personas.json) (snapshot `fixtures/social-messenger/personas.json`).
- Replay grammar: [action-schema.json](instrument/fixtures/social-messenger/action-schema.json) (snapshot `fixtures/social-messenger/action-schema.json`); use the app's write path.
- Inputs: [starter-m1.log](instrument/fixtures/social-messenger/starter-m1.log) (snapshot `fixtures/social-messenger/starter-m1.log`), [starter-m2.log](instrument/fixtures/social-messenger/starter-m2.log) (snapshot `fixtures/social-messenger/starter-m2.log`), [starter-m3.log](instrument/fixtures/social-messenger/starter-m3.log) (snapshot `fixtures/social-messenger/starter-m3.log`). M4, M5, M6, M8 have no separate starter logs; continue from the M3 state and exercise their product actions through the app write path per the brief.
- Media: [media/manifest.json](instrument/fixtures/social-messenger/media/manifest.json) (snapshot `fixtures/social-messenger/media/manifest.json`).
- UI kit: [ui/](instrument/tools/social-messenger/ui) (snapshot `tools/social-messenger/ui`); preserve component contracts and `sm-*` vocabulary.
- two-client web proof: [choreography/](instrument/tools/social-messenger/choreography) (snapshot `tools/social-messenger/choreography`).

## Required lane outputs

- `run-log.md`, `coverage-manifest.json`, and `receipts/<milestone>/`.
- `diary.md`, `essay.md`, and `final-report.md`.
- `lane-report.json`: preserve `orientation`; join the harness-native
  `firstProductEdit` snapshot and deterministic preflight warnings.
- `first-product-edit.json`: stamp immediately before the first product edit
  and pass it to the metering joiner.

## Start now

Skill allowlist: `snapback-authoring`. Create `run-log.md`,
record the M1 boundary, scaffold only the `snapback-web-clique` path, and make the
first product edit. Open linked detail only for its assertion, fixture, or a
structured refusal.
