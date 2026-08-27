# Clique lane run-log

lane_id=grok-pocketbase
model=grok
effort=grok xhigh
backend=pocketbase-0.39.9/0.27.3
start=1787853118

2026-08-27T14:51:58Z knowledge-lookup source=fixture: created run-log.md with lane id, model, effort, backend pin, start epoch. Working only in this lane directory; instrument is read-only via instrument/ symlink.

2026-08-27T15:00:00Z knowledge-lookup source=web: PocketBase 0.39.9 darwin_arm64 release asset, serve --http, superuser create, JSVM migrate/routerAdd/cronAdd, autodate fields must be declared, record.refreshTokenKey() for logout revocation.

2026-08-27T15:01:00Z provision: downloaded pocketbase_0.39.9_darwin_arm64.zip; binary reports pocketbase version 0.39.9. Pin JS SDK 0.27.3 via npm.

2026-08-27T18:22:29Z server pocketbase PID=12797 then 60615 bind=127.0.0.1:48140 dir=./pb_data (durable serve --dev). attribution=environment: first serve died when killed to restart --dev.

2026-08-27T18:28:00Z workaround attribution=backend-defect: PocketBase JSVM hook callbacks do not close over file-scope functions (handlers recompiled in isolated pb.js). Eval api.js inside each routerUse/cron/file callback. evidence=dev log ReferenceError bodyOf is not defined.

2026-08-27T18:33:49Z M1 start. Register/login custom routes working; built-in users auth collection + refreshTokenKey logout planned.

2026-08-27T18:35:00Z M1 suite green (7/7 suite-required). Seed starter-m1.log idempotent after register-on-duplicate-login.

2026-08-27T18:40:00Z M2 suite green 22/22 after starter-m2 seed.

2026-08-27T18:41:00Z M3–M5 suites green after starter-m3 (messaging, media, search/view-once API).

2026-08-27T18:46:00Z M6 suite green: custom-client-demo + sample-50 adapter (50/50). Push view-once preview Photo verified as bob.

2026-08-27T18:48:00Z M8 suite green after normalizing PocketBase created timestamps (space vs T) for UTC day buckets.

2026-08-27T19:00:00Z correction attribution=environment: vendor/social-ui/node_modules/react duplicated React; AuthForm crashed. Removed nested node_modules.

2026-08-27T19:20:00Z M1 choreography green. M2 choreography green after shell FeedTabs, aria-valuetext, video poster.

2026-08-27T19:42:00Z scale replay (48142, CLIQUE_REPLAY_MODE=1) 10% checkpoint ~1426s; died ~28k actions. probes-p10 many 400s.

2026-08-27T20:00:00Z M3–M8 choreography application misses (receipts, media send, search-offline, dual-offline). Recorded aborted not green. Native Hermes export dist/ios/*.hbc. iOS simulator proofs absent.

2026-08-27T20:05:00Z essay.md then scores.json then final-report.md. sequencing honored.

end=1787859509
