# Clique lane run log

lane=grok-explicit-0129-036-admitted2
model=grok-4.6
effort=xhigh
backend=snapback-explicit-0.1.29
host=Charlies-MacBook-Pro-M5Max-Black.local
instrument=social-messenger@0.3.6-m8
instrument-source-revision=eff33c5882fce03edfcd572fb1e0284344a3827d
start=1787988934

## 1787988934 orientation

- Read `clique-explicit.md`, `BENCHMARK-ORIENTATION.md`, and skill `snapback-authoring` (`SKILL.md` only).
- Read instrument brief `instrument/briefs/social-messenger.md` and contract `instrument/tools/social-messenger/CONTRACT.md` (orientation-named product behavior + coordination triggers).
- Snapback CLI already on PATH: `snapback 0.1.29` at `/Users/ccheever/.volta/bin/snapback`.
- Port range reserved: 63200-63299. Will stop only processes started in this lane.

## 1787988963 M1 boundary open

milestone=M1
scope=Accounts and profiles
suite-required=7 choreo=3 grader=3 simulator=0
status=in-progress

## 1787989095 first product edit stamp

Wrote `first-product-edit.json` (at=2026-08-29T07:38:15.000Z, orientationBytes=15330, selectedSkills=[snapback-authoring]).
Served-Guide lookups so far: `templates` (fuzzy), `sessions` (fuzzy), start/index.md, start/expo-chat.md, auth/passwords.md.
Selected template: `expo-chat` (Expo sessions-mode, Expo Router web target).
About to scaffold with `snapback new clique --template expo-chat`.

## 1787996945 close note

M1+M2 suite+choreography green. M3 send/membership write posture blocked. Wrote diary.md, essay.md, final-report.md, correction-loops.json, obligations.json. Dev restarted on fresh sqlite after optional joinedAt migration refusal. Ports 63200/63210 in use by this lane's snapback dev.


## 1787992285 M1 live-profile revision

- Last choreography: `profile-edit-live-visibility` application-missed (Bob never saw Alice's new display name/bio within 25s×3). Session persist and logout already passed.
- Cause: Playwright `.fill()` on RN-web `TextInput` does not update React state, so Save wrote the previous profile. Save also used default queued mutation dispatch.
- Fix: vendor kit `CompatTextInput` (native `<input>`/`<textarea>` on web) plus DOM-value read on Save; `useSnapbackSettledMutation` for `upsertProfile`; profile view always renders `sm-profile`.
- Metro 63210 pid 62051 still serving; backend 63200 still up. Re-running M1 choreography.

## 1787992840 M1 green

- Root cause of live-profile miss: (1) RN-web fill did not update handle, so Save refused INVALID_HANDLE; (2) declarative `defineLiveQuery` on profiles did not push patches while Bob stayed on `/profile/alice`.
- Fix: native web inputs + wait for `getMine` before showing the edit form + `useSnapbackSettledMutation` + `profileByHandle` as `defineJsLiveQuery`.
- Suite already passing. Choreography m1 green (profile-edit-live-visibility ~105ms, session persist, logout). receipts/m1/choreography.jsonl segment green.

## 1787993091 M2 boundary open

milestone=M2
scope=Posts and the follow graph
suite-required=22 choreo=6 grader=0 simulator=0
status=in-progress

## 1788003318 M3 live-cutoff revision

- Cause: Alice page.goto after Remove aborted in-memory pending mutation; Dave still received after-remove. Promote overlay also left dave:admin after re-add.
- Fix: public-read chatCuts plus ConversationView freeze by cutAt; sessionStorage pending-remove flushed from Chrome after navigation; hide composer until remove settles; clear role overlay on remove/add.
- M3 suite already green. Choreography m3 green (runId f625ded3).

## 1788003600 M4 boundary open

milestone=M4
scope=Media messages, reactions, edit/delete
suite-required=5 choreo=5 grader=2 simulator=0
status=green
suite=PASS receipts/m4/suite.json
choreo=PASS runId e1159af3
pid-snapback-dev=64957 metro=97174

## 1788011496 M5 green

milestone=M5
suite=PASS sha256:5e44d15d2ec9f41787fae181dd0bd8f36ffd120425ceed62aeb303d8cd9bef13
choreo=PASS runId bb6411ed-c492-4328-9e02-fc681e3e6230 durationMs=347683.9
notes=view-once without new Alice upload; disappear24hMs=180000; pending locals must not resurrect expired rows; TDZ serverRows hid composer until moved above the effect.

## 1788011802 M6 green

milestone=M6
suite=PASS sha256:3ac9746c9ae9c887e9ed012a578ef344067f02ca602fc979aa0656ac6f97b0d3
choreo=PASS runId 43e7c997-bf0e-4668-afa6-9a9cdab9a47c durationMs=5654.4
notes=push logs via roster+dmPairs; Chrome SuppressErrorOverlay for #error-overlay intercepting sm-convo-send while CDP-offline.

## 1788013339 M8 green

milestone=M8
suite=PASS sha256:3ea3193d12ece2aacb67ad399fc53482aa9161c8ee1d5bd45ee0b69efc2e2b70
choreo=PASS runId 7794ad2f-518e-496e-a17e-c499d35635f9 durationMs=35229.3
notes=ChatDock dm:bob; globalFeed pins Alice actor events; Insights tiles delayed ~2.8s after seed post so likes-received 9→10; dual-offline extras append after server order.

## 1788014547 close

Wrote essay.md then diary.md, correction-loops.json (7 loops), obligations.json, final-report.md. M7 environment-null. Dev still 01a04ce2-e29a-7981-9eb6-ea4e0a7a6a8f on 63200/63210.

end=1788014547
