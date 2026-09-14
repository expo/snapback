# Muse M4 compact-video provisional attribution

Date: 2026-09-13

Status: provisional public-evidence audit while the Muse builder is still active. This audit ran no probe, changed no builder-lane file, read no private reasoning/model body, and retained no credential-bearing line. Independent grading and the builder's final report remain pending.

## Disposition

The public Muse evidence independently exhibits the same Snapback 4 compact-asset prediction gap recorded from Astra in `issues/20260913-snapback4-video-id-only-prediction-refuses.md`, rather than a distinct upload, MIME, playback, or application-state problem.

The attribution rests on a narrow differential:

1. The isolated M4 run still reports `FAIL m4-a03-settled — video servable server-side` (sequence 23164).
2. A browser UI probe uploads the media but produces zero bubbles and zero settled rows, while the visible application error is `E_FIELD: missing field duration` (sequence 23439).
3. Separate upload probes report `duration=5000` and `type=video/mp4` whether the request begins as `video/mp4` or `application/octet-stream` (sequence 23542). The server-side media probe is therefore supplying the missing fact.
4. A corrected request interception sees the video and poster `/assets` uploads (sequence 23618). A later complete POST trace sees the read queries and both `/assets` requests but no `/m/sendVideo` request (sequence 23717). This supports refusal during local admission/prediction before authoritative mutation HTTP.
5. The pre-workaround lane helper returned only `up.asset.id` (`Read client uploadBlob implementation`, sequence 23464), and the built browser code submitted `clip: { id }`. A later duration-hint probe reports a mutation response containing `result.clip.duration=5000` (sequence 23940; the retained output truncates before the response's terminal fields). The owned source now carries the builder's explicit workaround: `uploadVideo` retains the uploaded duration, and both `ConversationView` and the feed pass `{ id, duration }` when available.

That signature matches Astra's retained differential: documented `{ id }` fails locally with `E_FIELD`, no mutation HTTP is sent, and supplying the upload response's facts lets the mutation proceed. Muse's public investigation therefore supplies independent builder corroboration for the existing ticket. It does not constitute an independent auditor reproduction or grade, and this note does not change the repository ticket.

## Public event provenance

The log prefix inspected was the first 22,503,057 bytes of `/Users/ccheever/clique-sb4-20260913-full-3models/logs/muse-snapback4.ndjson`, through sequence 23990, SHA-256 `584644e375a4eeea5ce490b1ee2b419f0b065845b13ff270a7976f3a9e6241e3`. Each cited output is a `task.lifecycle.output` event whose task id maps to `task_kind=tool.bash` in its `task.lifecycle.proposed` event.

| Sequence | Public task description | Event SHA-256 | Output SHA-256 |
| ---: | --- | --- | --- |
| 23164 | `Run m4 suite alone` | `6655c7561b498608424ec6874adaeedb1ea6b03e4a1f71dd035793b4991b0887` | `bcf0930d633d97340867e38d53585a82b5a3a61611102bb1a5b9f2bd711d7e8e` |
| 23439 | `Run video UI probe with console capture` | `c3190363719dec1b770d3ef063c25e1a05408d77a7aa715ca24c26829c93938e` | `05b4db4fb61246c2a8f26a727b17ba5e80242b30ab208d021f03c99765c8ef39` |
| 23542 | `Compare upload probing by content-type` | `0dbdd1bd3e4358bf6e01a43d449ddad99d5acabb09d69d63c41e00a25088628d` | `fc4b47093249b5bf3388a3b35c14e4ce428809541c2ca310eaef2b900fd5c47b` |
| 23618 | `Fix intercept script and rerun` | `a03a6a3eef0cf169b1558b3a56a983ca13a262d21f522f3497e3f005ea146764` | `4ee9cda044aa0a778c4ef5a14123c35056e6d5f339b91fb128ba0fb840d4f970` |
| 23717 | `Log all POSTs and websockets during send` | `5eb23a84fc3ca9eea872c13f369e626c2e2b9469f082e0722c425b23a054d6e9` | `0a1fb79dfbe8ee3f274baa9cdf553948e828986cf9368d2272b066bd044a4665` |
| 23940 | `Test duration-hint clip ref` | `a7da4c564f0ebe08c9bfec59213bb9d9b8e88e067f41efed859d9b16d4507a84` | `8c8b29f5b4fab09a2cb0b27eb0713aea5a95f7164d658c99295600169aa90282` |

The first interception attempt at sequence 23593 is excluded from the attribution: its probe stopped at `route.fulfill: status: expected integer, got function` before it could observe `sendVideo`.

## Source and prior evidence hashes

Owned Muse lane source snapshots read during the audit:

- `app-host/clique/src/media.ts` — SHA-256 `897051b6af31c0f58de6af174c96945f94c7a693b25593c3b570797528f8c457`
- `app-host/clique/src/components/ConversationView.tsx` — SHA-256 `9352099279721924a4ffa72af51e98adfef435542fb334408a548bf4930d969e`
- `app-host/clique/app/feed.tsx` — SHA-256 `ef7f083ec993665e24f882a12c5e998c2c1328e3c7a7af5b0a81743b0f3a2c8e`
- `snapback/schema.q` — SHA-256 `e2d9f902b1385a7f4cc3c3dac9abf648f04ffa15f51467b956e31797a511a01a`; both `createVideoPost` and `sendVideo` read `clip.duration`
- `tests/m4.mjs` — SHA-256 `90bc0172f033b93052edd31726d2cd28f535b64d7779ec1b813f764474e079f9`

Existing repository ticket SHA-256: `56169b09f0c9edb11a3d7dc3953cfc10078b621100161c8db6d05babb7e2bcd6`.

Astra evidence retained under `/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/evidence/`:

- `m4-video-probe.log` — SHA-256 `6768711c9744ec7f5afb9b0527f9fbf7dcf0549d2f8a367c68dd0047572dc6e3`
- `m4-field-why.txt` — SHA-256 `e32e885395a949bce0ce932b6266b7c7ca3486c8b2e3f32639ec9dc5c576f67c`
- `m4-video-probe2.log` — SHA-256 `a675b5a1274dcd0789986bb985e9036846eb3a91c1eb97c2e30957e1112a68ac`

## Limits

The builder had not rerun M4 after the source-level duration workaround in the inspected prefix, so this audit does not claim the workaround made the suite green. The duration-hint response is truncated after its populated result object, so terminal settlement is inferred from the presence of `result`, not directly shown. The active log and owned lane may continue to advance; the byte-prefix and per-event hashes above bind this observation to the exact evidence inspected.
