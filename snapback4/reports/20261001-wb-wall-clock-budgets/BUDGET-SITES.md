# Explicit timeout options

All original option sites in the scoped tree. Line numbers refer to the starting commit.

`incidental-guard` options now use `hangBudget(work)` (or the shared guarded fixture); pre-existing work-scaled guards and deliberate timing inputs remain. See AUDIT.md for implicit browser limits, polling functions, races, timing assertions and observation windows.

| File:line | Original option | Classification |
|---|---|---|
| `packages/snapback4/test/acquisition.test.mjs:154` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:186` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:205` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:220` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:248` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:271` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:321` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:335` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:367` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:461` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:491` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:517` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:540` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:572` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:601` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/acquisition.test.mjs:650` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:64` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:80` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:100` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:113` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:179` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:195` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:206` | `timeout: 35_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:211` | `timeoutMs: elapsed` | clock-data-instrumentation-or-source-text |
| `packages/snapback4/test/admit-before-identity.test.mjs:217` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:237` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:269` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:298` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:340` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:374` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:429` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:466` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:512` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:577` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/admit-before-identity.test.mjs:710` | `timeout: 120_000` | incidental-guard |
| `packages/snapback4/test/answer-row-authority.test.mjs:64` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/answer-row-authority.test.mjs:125` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/answer-withdrawal.test.mjs:88` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/answer-withdrawal.test.mjs:207` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/answers-stay-react.test.mjs:71` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/answers-stay-react.test.mjs:109` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/app-global-attempts.test.mjs:12` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-global-attempts.test.mjs:60` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-global-attempts.test.mjs:80` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-global-attempts.test.mjs:98` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-global.test.mjs:19` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/app-global.test.mjs:59` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-global.test.mjs:72` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-handles.test.mjs:11` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-handles.test.mjs:31` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-handles.test.mjs:69` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-handles.test.mjs:89` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-local-outcomes.test.mjs:16` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-local-outcomes.test.mjs:61` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-local-receipts.test.mjs:15` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-local-session.test.mjs:12` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-local-session.test.mjs:35` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-outcomes.test.mjs:30` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-receipts.test.mjs:8` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-session-model.test.mjs:10` | `timeout: Math.max(240_000, count * 2000)` | work-scaled-guard |
| `packages/snapback4/test/app-session-model.test.mjs:258` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/app-state.test.mjs:12` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-state.test.mjs:34` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-state.test.mjs:68` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/app-state.test.mjs:103` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-state.test.mjs:122` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-state.test.mjs:152` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app-state.test.mjs:171` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:14` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:60` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:91` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:110` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:134` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:163` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:232` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:264` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:298` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:327` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:375` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:396` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:442` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:466` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:497` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:515` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:541` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:581` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:622` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:678` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:704` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:729` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:771` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:817` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:849` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:877` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:921` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:941` | `timeoutMs: 5000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:1107` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:1138` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:1160` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:1181` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:1217` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:1231` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:1263` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:1282` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:1294` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:1311` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:1338` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:1366` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/app.test.mjs:1395` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/asset-avatars.test.mjs:22` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/asset-avatars.test.mjs:80` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/asset-avatars.test.mjs:117` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/asset-avatars.test.mjs:162` | `timeout: 180_000` | incidental-guard |
| `packages/snapback4/test/asset-avatars.test.mjs:217` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/asset-buffered.test.mjs:14` | `timeout: 25000` | incidental-guard |
| `packages/snapback4/test/asset-lists.test.mjs:102` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/asset-lists.test.mjs:115` | `timeout: 40000` | incidental-guard |
| `packages/snapback4/test/asset-lists.test.mjs:152` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/asset-lists.test.mjs:187` | `timeout: 40000` | incidental-guard |
| `packages/snapback4/test/asset-lists.test.mjs:257` | `timeout: 40000` | incidental-guard |
| `packages/snapback4/test/asset-lists.test.mjs:346` | `timeout: 40000` | incidental-guard |
| `packages/snapback4/test/asset-lists.test.mjs:387` | `timeout: 40000` | incidental-guard |
| `packages/snapback4/test/asset-lists.test.mjs:473` | `timeout: 40000` | incidental-guard |
| `packages/snapback4/test/asset-lists.test.mjs:495` | `timeout: 40000` | incidental-guard |
| `packages/snapback4/test/asset-lists.test.mjs:535` | `timeout: 40000` | incidental-guard |
| `packages/snapback4/test/asset-lists.test.mjs:606` | `timeout: 40000` | incidental-guard |
| `packages/snapback4/test/asset-pressure.test.mjs:18` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/asset-retry.test.mjs:30` | `timeout: 10000` | incidental-guard |
| `packages/snapback4/test/asset-retry.test.mjs:62` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/asset-retry.test.mjs:212` | `timeout: 10000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:122` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:172` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:204` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:274` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:329` | `timeout: 90000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:352` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:383` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:437` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:474` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:499` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:524` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:559` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:586` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:598` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:610` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:623` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:646` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:658` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:668` | `timeout: 90000` | incidental-guard |
| `packages/snapback4/test/bounded-following.test.mjs:729` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:74` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:109` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:128` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:152` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:187` | `timeout: 12_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:267` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:303` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:348` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:418` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:450` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:490` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:520` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:574` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:745` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:772` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:832` | `timeout: 12_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:846` | `timeout: 12_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:900` | `timeout: 12_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:963` | `timeout: 12_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:999` | `timeout: 12_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:1062` | `timeout: 12_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:1089` | `timeout: 12_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:1145` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:1187` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:1220` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:1245` | `timeout: 3000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:1301` | `timeout: 12_000` | incidental-guard |
| `packages/snapback4/test/client-lifecycle.test.mjs:1334` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/client-seams.test.mjs:276` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/client-seams.test.mjs:370` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/client-seams.test.mjs:406` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/client-seams.test.mjs:445` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/client-seams.test.mjs:554` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/client-seams.test.mjs:585` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/client-seams.test.mjs:614` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/client-seams.test.mjs:821` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/client-seams.test.mjs:882` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/client-seams.test.mjs:914` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/client-seams.test.mjs:1013` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/client-seams.test.mjs:1051` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/client-seams.test.mjs:1085` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/close-boundary.test.mjs:54` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/close-boundary.test.mjs:83` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/close-boundary.test.mjs:102` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/close-boundary.test.mjs:115` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/close-boundary.test.mjs:144` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/close-boundary.test.mjs:170` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/column-stream-recovery.test.mjs:47` | `timeout:600000` | incidental-guard |
| `packages/snapback4/test/composed-authority.test.mjs:68` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/delivery-crash.test.mjs:9` | `timeout:15000` | incidental-guard |
| `packages/snapback4/test/delivery-integrated.test.mjs:23` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/delivery-integrated.test.mjs:119` | `timeout:20000` | incidental-guard |
| `packages/snapback4/test/delivery-outbox.test.mjs:21` | `timeout:20000` | incidental-guard |
| `packages/snapback4/test/ephemeral-capability.test.mjs:16` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/ephemeral-capability.test.mjs:46` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/ephemeral-capability.test.mjs:69` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/ephemeral-e2e.test.mjs:10` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/ephemeral-keep.test.mjs:45` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/ephemeral-reclamation.test.mjs:26` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/event-slots.test.mjs:19` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/expiry-retry-watch.test.mjs:75` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/expo-media-storage.test.mjs:39` | `timeout: 180_000` | incidental-guard |
| `packages/snapback4/test/expo-media-storage.test.mjs:47` | `timeout: 40_000` | incidental-guard |
| `packages/snapback4/test/familiar-forms.test.mjs:95` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/first-account.test.mjs:51` | `timeout: 120_000` | incidental-guard |
| `packages/snapback4/test/first-account.test.mjs:64` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/fixtures/identity-recipe/qualify-b1c.mjs:148` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/fixtures/identity-recipe/qualify-b1c.mjs:392` | `drainMilliseconds: 30_000` | incidental-guard |
| `packages/snapback4/test/fixtures/identity-recipe/qualify-b1c.mjs:392` | `closeMilliseconds: 2_000` | incidental-guard |
| `packages/snapback4/test/fixtures/routes.mjs:93` | `timeout:20_000` | incidental-guard |
| `packages/snapback4/test/fixtures/workroom-routes.mjs:91` | `timeoutMs:6000` | incidental-guard |
| `packages/snapback4/test/following-unfollow.test.mjs:23` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/generated-effect-context.test.mjs:168` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/generated-effect-opt-in.test.mjs:14` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/generated-effect-opt-in.test.mjs:27` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:42` | `timeout: 720_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:212` | `timeout: 720_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:234` | `timeout: 720_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:256` | `timeout: 720_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:278` | `timeout: 720_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:311` | `timeout: 720_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:356` | `timeout: 720_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:386` | `timeout: 720_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:421` | `timeout: 720_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:451` | `timeout: 600_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:459` | `timeout: 720_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:494` | `timeout: 720_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:521` | `timeout: 720_000` | incidental-guard |
| `packages/snapback4/test/horizon-boundary.test.mjs:540` | `timeout: 720_000` | incidental-guard |
| `packages/snapback4/test/http-bounds.test.mjs:43` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/identity-invitation-issuance.test.mjs:439` | `timeout: 2000` | incidental-guard |
| `packages/snapback4/test/identity-invitation-issuance.test.mjs:464` | `timeout: 2000` | incidental-guard |
| `packages/snapback4/test/identity-organizations.test.mjs:295` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/identity-profile.test.mjs:33` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/intent-views.test.mjs:35` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/keep-app-model.test.mjs:33` | `timeout: 120_000` | incidental-guard |
| `packages/snapback4/test/keep-device.test.mjs:72` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/keep-device.test.mjs:139` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/keep-incarnation.test.mjs:170` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/keep-reset.test.mjs:20` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/keepalive-browser.test.mjs:5` | `timeout: 45_000` | incidental-guard |
| `packages/snapback4/test/keepalive-headers.test.mjs:104` | `timeout: 25_000` | incidental-guard |
| `packages/snapback4/test/keepalive-reuse.test.mjs:26` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/legacy-receipts.test.mjs:74` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/local-e2e.test.mjs:50` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/local-e2e.test.mjs:129` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/local-e2e.test.mjs:172` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/local-e2e.test.mjs:239` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/local-e2e.test.mjs:297` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/maintained-column-adoption.test.mjs:33` | `timeout: 180000` | incidental-guard |
| `packages/snapback4/test/maintained-columns.test.mjs:28` | `timeout:180000` | incidental-guard |
| `packages/snapback4/test/maintained-columns.test.mjs:52` | `timeout:30000` | incidental-guard |
| `packages/snapback4/test/maintains.test.mjs:20` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/measure-launch.test.mjs:11` | `timeoutMs: 60000` | data-contract |
| `packages/snapback4/test/measure-launch.test.mjs:12` | `timeoutMs: 500` | data-contract |
| `packages/snapback4/test/measure-launch.test.mjs:33` | `timeoutMs: 500` | data-contract |
| `packages/snapback4/test/measure-launch.test.mjs:64` | `timeoutMs: 500` | data-contract |
| `packages/snapback4/test/measure-launch.test.mjs:85` | `timeout: 10000` | data-contract |
| `packages/snapback4/test/mixed-evidence-oracle.test.mjs:42` | `timeout: Math.max(240000, seeds * schedulesPerSeed * 2000)` | work-scaled-guard |
| `packages/snapback4/test/native-e2e.test.mjs:33` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/native-opening.test.mjs:119` | `timeout: 10000` | incidental-guard |
| `packages/snapback4/test/native-smoke.test.mjs:28` | `timeoutMs: 500` | intentional-timeout |
| `packages/snapback4/test/navigation-model.test.mjs:1013` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/node-transport.test.mjs:22` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/one-shot-model.test.mjs:7` | `timeout: 120_000` | incidental-guard |
| `packages/snapback4/test/online-client-model.test.mjs:39` | `timeout: Math.max(180_000, count * 2000)` | work-scaled-guard |
| `packages/snapback4/test/online-intent-store.test.mjs:131` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/online-session.test.mjs:150` | `timeout: 3000` | incidental-guard |
| `packages/snapback4/test/online-session.test.mjs:165` | `timeout: 7000` | incidental-guard |
| `packages/snapback4/test/ordinary-history.test.mjs:70` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/ordinary-history.test.mjs:131` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/ordinary-history.test.mjs:200` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/ordinary-search-oracle.test.mjs:355` | `timeout: 600000` | incidental-guard |
| `packages/snapback4/test/ordinary-search-oracle.test.mjs:393` | `timeout:30000` | incidental-guard |
| `packages/snapback4/test/ordinary-search.test.mjs:135` | `timeout:180000` | incidental-guard |
| `packages/snapback4/test/ordinary-search.test.mjs:242` | `timeout:120000` | incidental-guard |
| `packages/snapback4/test/ordinary-search.test.mjs:273` | `timeout:10000` | incidental-guard |
| `packages/snapback4/test/ordinary-search.test.mjs:310` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/ordinary-search.test.mjs:428` | `timeout:120000` | incidental-guard |
| `packages/snapback4/test/overload-browser.test.mjs:11` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/overload.test.mjs:8` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/overload.test.mjs:62` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/overload.test.mjs:116` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/overload.test.mjs:294` | `timeout: 10000` | incidental-guard |
| `packages/snapback4/test/overload.test.mjs:379` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/overload.test.mjs:425` | `timeout: 10000` | incidental-guard |
| `packages/snapback4/test/overload.test.mjs:456` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/overload.test.mjs:494` | `timeout: 10000` | incidental-guard |
| `packages/snapback4/test/own-keys.test.mjs:37` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/page-authority.test.mjs:84` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/page-authority.test.mjs:112` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/page-authority.test.mjs:150` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/page-authority.test.mjs:163` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/page-authority.test.mjs:178` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/page-authority.test.mjs:195` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/page-authority.test.mjs:216` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/page-authority.test.mjs:233` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/page-authority.test.mjs:249` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/page-observation.test.mjs:39` | `timeout: 45_000` | incidental-guard |
| `packages/snapback4/test/page-observation.test.mjs:50` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/page-ready.test.mjs:31` | `timeout: 45_000` | incidental-guard |
| `packages/snapback4/test/page-ready.test.mjs:143` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/pending-writes.test.mjs:178` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/pending-writes.test.mjs:230` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/pending-writes.test.mjs:263` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/per-row-liveness.test.mjs:54` | `timeout: 4 * 60_000` | incidental-guard |
| `packages/snapback4/test/per-row-retry.test.mjs:61` | `timeout: caseTimeout` | incidental-guard |
| `packages/snapback4/test/per-row-retry.test.mjs:103` | `timeout: caseTimeout` | incidental-guard |
| `packages/snapback4/test/per-row-work.test.mjs:175` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/periphery.test.mjs:23` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/periphery.test.mjs:33` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/periphery.test.mjs:300` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/periphery.test.mjs:463` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/periphery.test.mjs:492` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/periphery.test.mjs:502` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/periphery.test.mjs:507` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/periphery.test.mjs:534` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/presence-composed.test.mjs:45` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/presence-live.test.mjs:38` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/presence-local.test.mjs:72` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/presence-local.test.mjs:92` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/presence-local.test.mjs:109` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/presence-local.test.mjs:139` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/presence-local.test.mjs:165` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/presence-local.test.mjs:180` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/presence-local.test.mjs:208` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/presence-local.test.mjs:234` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/presence-local.test.mjs:262` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/presence-local.test.mjs:291` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/presence-local.test.mjs:312` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/presence-local.test.mjs:334` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/publication-roundtrip.test.mjs:18` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/publication-roundtrip.test.mjs:32` | `timeout: 60_000` | data-contract |
| `packages/snapback4/test/query-publication-session.test.mjs:8` | `timeout: 10000` | incidental-guard |
| `packages/snapback4/test/read-admission-insert.test.mjs:31` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/read-existence-integration.test.mjs:31` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/read-existence-integration.test.mjs:90` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/read-through-provenance.test.mjs:114` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/read-through-provenance.test.mjs:136` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/read-through-provenance.test.mjs:147` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/read-through-provenance.test.mjs:164` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/read-through-provenance.test.mjs:180` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/read-through-provenance.test.mjs:200` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/read-through-provenance.test.mjs:219` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/read-through-upsert.test.mjs:25` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/read-through-upsert.test.mjs:58` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/read-through.test.mjs:8` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/read-through.test.mjs:70` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/read-through.test.mjs:115` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/read-through.test.mjs:159` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/read-through.test.mjs:197` | `timeout:60000` | incidental-guard |
| `packages/snapback4/test/readauth.test.mjs:51` | `timeout:90000` | incidental-guard |
| `packages/snapback4/test/recorded-compatibility.test.mjs:33` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/recorded-compatibility.test.mjs:43` | `timeout:20_000` | incidental-guard |
| `packages/snapback4/test/refresh-behavior.test.mjs:38` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:38` | `timeout: 4000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:82` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:118` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:139` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:164` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:182` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:197` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:211` | `timeout: 4000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:226` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:234` | `timeout: 4000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:279` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:357` | `timeout: 4000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:442` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:524` | `timeout: 10000` | incidental-guard |
| `packages/snapback4/test/release-activation.test.mjs:545` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/repair-b-overflow.test.mjs:114` | `timeout: 90000` | incidental-guard |
| `packages/snapback4/test/repair-b-round7.test.mjs:28` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/repair-b-round7.test.mjs:84` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/repair-b-round7.test.mjs:115` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/repair-b-round8.test.mjs:4` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/repair-b-round9.test.mjs:65` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/repair-b.test.mjs:27` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/repair-b.test.mjs:118` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/repair-b.test.mjs:166` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/repair-b.test.mjs:227` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/repair-b.test.mjs:282` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/residency.test.mjs:122` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/residency.test.mjs:148` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/residency.test.mjs:169` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/residency.test.mjs:180` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/residency.test.mjs:223` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/residency.test.mjs:248` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/residency.test.mjs:260` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/residency.test.mjs:284` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/retained-history.test.mjs:119` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:15` | `timeout:25_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:53` | `timeout:25_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:72` | `timeout:70_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:84` | `timeout:25_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:101` | `timeout:25_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:121` | `timeout:40_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:163` | `timeout:30_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:190` | `timeout:25_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:211` | `timeout:25_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:228` | `timeout:25_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:242` | `timeout:25_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:265` | `timeout:25_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:278` | `timeout:75_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:303` | `timeoutMs:30_000` | incidental-guard |
| `packages/snapback4/test/routes.test.mjs:311` | `timeoutMs:30_000` | incidental-guard |
| `packages/snapback4/test/row-keyed-view.test.mjs:167` | `timeout: 90000` | incidental-guard |
| `packages/snapback4/test/schema-capabilities.test.mjs:93` | `timeout:20_000` | incidental-guard |
| `packages/snapback4/test/schema-capabilities.test.mjs:128` | `timeout:120_000` | incidental-guard |
| `packages/snapback4/test/schema-capabilities.test.mjs:275` | `timeout:120_000` | incidental-guard |
| `packages/snapback4/test/server-check.test.mjs:57` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/server-clock-browser.test.mjs:9` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/server-clock-browser.test.mjs:88` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/server-clock-browser.test.mjs:140` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/server-clock-browser.test.mjs:187` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/server-clock-live.test.mjs:13` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/server-clock-recovery.test.mjs:86` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/server-clock-regressions.test.mjs:78` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/server-e2e.test.mjs:59` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/server-e2e.test.mjs:142` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/server-e2e.test.mjs:183` | `timeout: 70_000` | incidental-guard |
| `packages/snapback4/test/server-e2e.test.mjs:250` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/server-e2e.test.mjs:330` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/server-e2e.test.mjs:353` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/server-e2e.test.mjs:376` | `timeout: 25_000` | incidental-guard |
| `packages/snapback4/test/server-e2e.test.mjs:458` | `timeout: 60_000` | incidental-guard |
| `packages/snapback4/test/server-e2e.test.mjs:588` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/server-e2e.test.mjs:679` | `timeout: 25_000` | incidental-guard |
| `packages/snapback4/test/server-runtime.test.mjs:369` | `timeout: 3000` | incidental-guard |
| `packages/snapback4/test/server-runtime.test.mjs:546` | `timeout:3000` | incidental-guard |
| `packages/snapback4/test/server-runtime.test.mjs:595` | `timeout:3000` | incidental-guard |
| `packages/snapback4/test/social-browser.test.mjs:16` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/social-browser.test.mjs:227` | `timeout: 3000` | incidental-guard |
| `packages/snapback4/test/social-browser.test.mjs:350` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/social-browser.test.mjs:400` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/social-browser.test.mjs:509` | `timeout: 120_000` | incidental-guard |
| `packages/snapback4/test/social-browser.test.mjs:619` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/social-browser.test.mjs:623` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/social-browser.test.mjs:646` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/social-browser.test.mjs:668` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/social-browser.test.mjs:725` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/social-starter.test.mjs:41` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/social-starter.test.mjs:122` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/social-starter.test.mjs:224` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/store-reset-reconnect.test.mjs:94` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/store-reset-reconnect.test.mjs:110` | `timeout: 45000` | incidental-guard |
| `packages/snapback4/test/store-reset-reconnect.test.mjs:145` | `timeout: 45000` | incidental-guard |
| `packages/snapback4/test/store-reset-reconnect.test.mjs:159` | `timeout: 45000` | incidental-guard |
| `packages/snapback4/test/store-reset-reconnect.test.mjs:196` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/store-reset-reconnect.test.mjs:224` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/store-reset-reconnect.test.mjs:246` | `timeout: 30000` | incidental-guard |
| `packages/snapback4/test/store-reset.test.mjs:83` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/store-reset.test.mjs:120` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/store-reset.test.mjs:151` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/store-reset.test.mjs:175` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/subscription-pressure-device.test.mjs:11` | `timeout:20000` | incidental-guard |
| `packages/snapback4/test/subscription-pressure-e2e.test.mjs:18` | `timeout: 60000` | incidental-guard |
| `packages/snapback4/test/subscription-pressure-round1.test.mjs:75` | `timeout:30000` | incidental-guard |
| `packages/snapback4/test/subscription-pressure-round1.test.mjs:153` | `timeout:20000` | incidental-guard |
| `packages/snapback4/test/subscription-pressure-round1.test.mjs:179` | `timeout:15000` | incidental-guard |
| `packages/snapback4/test/subscription-pressure-round2.test.mjs:11` | `timeout:20000` | incidental-guard |
| `packages/snapback4/test/subscription-pressure-scopes.test.mjs:20` | `timeout:20000` | incidental-guard |
| `packages/snapback4/test/supervised-workers.test.mjs:25` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/supervised-workers.test.mjs:132` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/sync-after-call.test.mjs:52` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/sync-after-call.test.mjs:68` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/sync-after-call.test.mjs:79` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/sync-after-call.test.mjs:87` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/sync-after-call.test.mjs:107` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/sync-after-call.test.mjs:114` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/sync-after-call.test.mjs:136` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/sync-after-call.test.mjs:167` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/sync-generation.test.mjs:122` | `timeout: 90000` | incidental-guard |
| `packages/snapback4/test/sync-generation.test.mjs:356` | `timeout: 90000` | incidental-guard |
| `packages/snapback4/test/sync-generation.test.mjs:411` | `timeout: 90000` | incidental-guard |
| `packages/snapback4/test/sync-generation.test.mjs:441` | `timeout: 90000` | incidental-guard |
| `packages/snapback4/test/sync-generation.test.mjs:474` | `timeout: 90000` | incidental-guard |
| `packages/snapback4/test/sync-overflow.test.mjs:140` | `timeout: 240000` | incidental-guard |
| `packages/snapback4/test/sync-overflow.test.mjs:195` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/sync-overflow.test.mjs:217` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/sync-overflow.test.mjs:239` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/sync-overflow.test.mjs:355` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/sync-overflow.test.mjs:381` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/sync-scale.test.mjs:100` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/sync-scale.test.mjs:125` | `timeout: 15000` | incidental-guard |
| `packages/snapback4/test/sync-scale.test.mjs:145` | `timeout: 10000` | incidental-guard |
| `packages/snapback4/test/timeline-delivery.test.mjs:5` | `timeout:240000` | incidental-guard |
| `packages/snapback4/test/transport-http.test.mjs:75` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/transport-http.test.mjs:133` | `timeout: 40_000` | incidental-guard |
| `packages/snapback4/test/transport-http.test.mjs:201` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/transport-http.test.mjs:253` | `timeout: 18_000` | incidental-guard |
| `packages/snapback4/test/transport-http.test.mjs:298` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/transport-outcomes.test.mjs:21` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/typing-expiry.test.mjs:28` | `timeout: 4 * 60_000` | incidental-guard |
| `packages/snapback4/test/unread-range.test.mjs:70` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/unread-range.test.mjs:140` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/unread-range.test.mjs:156` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/unread-range.test.mjs:184` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/unread-range.test.mjs:204` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/unread-range.test.mjs:244` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/unread-range.test.mjs:258` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/unread-range.test.mjs:272` | `timeout: 120000` | incidental-guard |
| `packages/snapback4/test/upload-lifetime.test.mjs:59` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/upload-lifetime.test.mjs:77` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/upload-lifetime.test.mjs:107` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/upload-lifetime.test.mjs:133` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/upload-lifetime.test.mjs:167` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/upload-lifetime.test.mjs:188` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/upload-lifetime.test.mjs:214` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/upload-lifetime.test.mjs:244` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/upload-lifetime.test.mjs:281` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/upload-lifetime.test.mjs:297` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/upload-retry.test.mjs:154` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/web-admission-review.test.mjs:14` | `timeout: (54 + 2) * scenarioTimeout` | incidental-guard |
| `packages/snapback4/test/web-admission-review.test.mjs:51` | `timeout: scenarioTimeout` | incidental-guard |
| `packages/snapback4/test/web-admission-review.test.mjs:339` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/web-admission-review.test.mjs:385` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/web-admission-review.test.mjs:389` | `timeout: 3000` | incidental-guard |
| `packages/snapback4/test/web-admission-review.test.mjs:423` | `timeout: 3000` | incidental-guard |
| `packages/snapback4/test/web-admission-review.test.mjs:462` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/web-admission-review.test.mjs:481` | `timeout: 3000` | incidental-guard |
| `packages/snapback4/test/web-admission-review.test.mjs:570` | `timeout: 3000` | incidental-guard |
| `packages/snapback4/test/web-admission-review.test.mjs:589` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/web-admission-review.test.mjs:601` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/web-admission-review.test.mjs:1140` | `timeout: 5000` | incidental-guard |
| `packages/snapback4/test/web-admission-review.test.mjs:1309` | `timeout: 3000` | incidental-guard |
| `packages/snapback4/test/web-pages.test.mjs:6` | `timeout:120000` | incidental-guard |
| `packages/snapback4/test/web-pages.test.mjs:86` | `timeout:120000` | incidental-guard |
| `packages/snapback4/test/web-pages.test.mjs:132` | `timeout:120000` | incidental-guard |
| `packages/snapback4/test/web-receipt-upgrade.test.mjs:29` | `timeout: 90_000` | incidental-guard |
| `packages/snapback4/test/web-review.test.mjs:9` | `timeout: 120_000` | incidental-guard |
| `packages/snapback4/test/web-session-authority.test.mjs:10` | `timeout: 120_000` | incidental-guard |
| `packages/snapback4/test/web-session-authority.test.mjs:175` | `timeout: 3000` | incidental-guard |
| `packages/snapback4/test/web-start.test.mjs:42` | `timeout: 120_000` | incidental-guard |
| `packages/snapback4/test/witness-preparation.test.mjs:275` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/witness.test.mjs:9` | `timeoutMs: 1000` | incidental-guard |
| `packages/snapback4/test/witness.test.mjs:34` | `timeoutMs: 1000` | incidental-guard |
| `packages/snapback4/test/witness.test.mjs:59` | `timeoutMs: 10` | intentional-timeout |
| `packages/snapback4/test/witness.test.mjs:85` | `timeoutMs: 1000` | incidental-guard |
| `packages/snapback4/test/worker-ledger-contention.test.mjs:13` | `timeout:10_000` | incidental-guard |
| `packages/snapback4/test/worker-ledger-contention.test.mjs:110` | `timeout:5_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:113` | `timeout:1500` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:249` | `timeout: 35_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:285` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:303` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:322` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:362` | `timeout:25_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:376` | `timeout:10_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:406` | `timeout: 35_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:426` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:458` | `timeout: 10_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:477` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:501` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:537` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:551` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/worker-regressions.test.mjs:565` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:61` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:221` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:318` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:337` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:384` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:423` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:444` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:472` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:505` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:514` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:540` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:632` | `timeout: 30_000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:717` | `timeout: 20_000` | incidental-guard |
| `packages/snapback4/test/worker.test.mjs:813` | `timeout: 15_000` | incidental-guard |
| `packages/snapback4/test/write-authority.test.mjs:71` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/write-authority.test.mjs:96` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/write-authority.test.mjs:129` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/write-authority.test.mjs:147` | `timeout: 20000` | incidental-guard |
| `packages/snapback4/test/write-ids.test.mjs:130` | `timeout: 120000` | incidental-guard |
