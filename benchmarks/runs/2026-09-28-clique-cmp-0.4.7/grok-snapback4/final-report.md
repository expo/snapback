# Clique × snapback4@0.4.7 — final report

lane id: grok-clique-snapback4-20260928  
model: grok-4.6  
effort: xhigh  
backend: snapback4-0.4.7  
instrument: social-messenger@0.3.6-m8  

## Clocks

| | epoch seconds | ISO (approx) |
|---|---|---|
| start | 1790586756 | 2026-09-28T09:12:36Z |
| end | 1790597138 | 2026-09-28T12:05:38Z |
| total wall | 10382 s (~2.88 h) | |

Token accounting: null (Grok advisory; caps inapplicable).

## Wall by milestone (from run-log)

| Milestone | start epoch | first-green / terminal | wall s | status |
|---|---|---|---|---|
| M1 | 1790586756 | 1790588610 | 1854 | `green` |
| M2 | 1790588610 | 1790590400 | 1790 | `green` |
| M3 | 1790590400 | 1790596563 (no green) | 6163 | not green: suite pass, choreography fail (not cap-exhausted) |
| M4 | 1790596563 | 1790596576 suite; choreo fail | ~20 suite + later choreo | suite pass; choreography fail |
| M5 | 1790596576 | 1790596593 suite; choreo fail | bundled with M4–M8 suite | suite pass; choreography fail |
| M6 | 1790596576 | suite 1790596593; scale 1790596989–1790597057 | scale 68 s this attempt | suite pass; choreography fail; scale attempted |
| M8 | 1790596576 | suite 1790596593; choreo ~1790597116 | bundled | suite pass; choreography fail |
| M7 | — | — | — | `not-run` (separate fresh session) |

M3–M8 were **attempted**. They are **not** `capability-failure` (4 h cap not hit) and **not** `blocked-by-M3` in the sense that suites still ran; they are **not** `green` because required choreography failed. Scoring should treat green-bar as fail-closed.

## Suite and choreography

| Milestone | suite | choreography | green bar |
|---|---|---|---|
| M1 | PASS `artifacts/suite-m1.json` | `artifacts/choreo-m1.jsonl` green=true | yes |
| M2 | PASS `artifacts/suite-m2.json` | `artifacts/choreo-m2.jsonl` green=true | yes |
| M3 | PASS (also in later suite-m8) | `artifacts/choreo-m3.jsonl` green=false | no |
| M4 | PASS | `artifacts/choreo-m4.jsonl` green=false | no |
| M5 | PASS | `artifacts/choreo-m5.jsonl` green=false | no |
| M6 | PASS | `artifacts/choreo-m6.jsonl` green=false | no |
| M8 | PASS `artifacts/suite-m8.json` | `artifacts/choreo-m8.jsonl` green=false | no |

Coverage: `coverage-manifest.json` format `clique-coverage-manifest.v1`, rewritten by `scripts/acceptance.mjs` for m1–m8 suite-required IDs.

## Correction loops (attribution)

| Loop | attribution | evidence |
|---|---|---|
| expo-router 6 vs SDK 57 | agent-error | package.json pin `expo-router@57.0.21` |
| `server.ts` `import.meta` under CJS | agent-error | `snapback/server.mts` |
| `view public` vs `read <- allow` | package README/guide | schema views |
| RN-web `accessibilityValue` ≠ `aria-valuetext` | agent-error / RN-web gap | vendor kit patches |
| Playwright file input | agent-error | ComposerBar/WebFile poll |
| Always-on composer stealing `sm-compose-input` | agent-error | PostComposer home-only |
| Following-tab viewer-repost | agent-error | `myFollows` filter |
| Accidental `pkill` of 56400 | agent-error | run-log; restarted lane PIDs only |
| ChatSettings add button | agent-error | `onPressAddMember` |
| `EnsureProfile` unmount on loading | agent-error | `src/AuthGate.tsx` keep-alive |
| Extra group member Erin blocks aggregate receipts | fixture + engine exactness | seed post-step remove Erin |
| Scale `--fresh` upload unreachable after 10% | environment / snapback4 `--fresh` | `artifacts/scale-replay-receipt.json` |

## Native artifacts

- iOS Hermes export: `artifacts/hermes-m1` … `hermes-m8` (`_expo/static/js/ios/entry-*.hbc`). Web/JS bundle, not a simulator proof.
- Simulator: `artifacts/simulator-status.json` — Apple simulators/Xcode unavailable on Linux x86_64; m6/m8 `pass: null`, not faked.

## Scale replay

- Adapter: `scripts/scale-replay.mjs` + `scripts/replay-adapter.mjs` (`idFrom("clique:"+label)`).
- Clock: start=1790596989 end=1790597057 (68 s this attempt; prior attempt also hit 10%).
- Backend: `snapback4 dev --port 56403 --fresh --replay` (also tried 56402).
- Fixture log sha256: `b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9` (matches `fixtures/scale-log.sha256`).
- Verification: **10% checkpoint prefix sha matched** `f1f4abf9f2178b039c44db6b3acb17d4e0019faad81f8839339ad6b26467dbba` at settledPrefix=24777. Then `upload media/img-04.png: the server is unreachable`. **pass=false**, failedActions=1, 50% and full corpus **not** reached.
- Evidence: `artifacts/scale-replay-receipt.json`, `artifacts/scale-replay.json`.

## Resolved pins

- `snapback4@0.4.7`
- `snapback4-expo@0.4.7`
- expo `57.0.22`, `expo-router@57.0.21`, react 19.2.3, RN 0.86.3

## Hand-authored line counts (approx, `wc -l`)

| file | lines |
|---|---|
| snapback/schema.q | 642 |
| scripts/acceptance.mjs | 686 |
| src/ConversationView.tsx | 411 |
| scripts/replay-adapter.mjs | 299 |
| src/ProfileScreen.tsx | 159 |
| scripts/scale-replay.mjs | 137 |
| src/ChatSettingsScreen.tsx | 128 |
| src/ComposerBar.tsx | 121 |
| src/PostCard.tsx | 118 |
| src/Thread.tsx | 114 |
| src/AuthGate.tsx | 87 |
| API.md | 61 |
| other src/app/scripts | rest of ~4198 |

Vendor kit under `vendor/social-ui` includes lane a11y patches (aria-valuetext). Instrument copies (choreography, fixtures, metering) are not counted as Clique product.

## PIDs (this session, lane-only)

- Backend 56400: 2610070 (LISTEN), worker ~2610308, wrappers 2610020/2610062. Earlier: 2064663/2064898, 1286565/1286732.
- Expo 56401: 3772505 (later), 1601505 (earlier).
- Scale 56402/56403: 4010954, 3918330, 3939174 (killed after attempts).
- Kill policy: only these PIDs, never pkill/killall.

## Candid gaps

1. **Green bar after M2 is suite-only.** Choreography for M3–M8 did not pass. Root causes mixed: AuthGate remount, RN-web a11y, inverted lists, group roster vs receipt function, ChatRail query load.
2. **No iOS simulator.** Hermes `.hbc` is not native proof.
3. **Scale replay did not finish.** 10% invariant prefix matched; media upload against `--fresh` died. Full `expectedState` (1008 users, 100015 messages) unverified.
4. **`N_NEVER_COMPLETE` on `groupNamed`**, **`N_EPHEMERAL_SERVER` on typing queries**, **`N_SYNC_ORDER` on several searches** — platform notes, not silent.
5. **Erin** in starter group vs 3-person choreography receipts — fixture vs engine exactness.
6. **Digest** scheduled `every 2m` and push JSONL exist; M8 live insights choreography did not observe an unliked Alice post for Bob.

## M7

`not-run` as required.

end=1790597138
