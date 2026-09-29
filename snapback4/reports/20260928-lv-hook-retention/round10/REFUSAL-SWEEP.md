# Round 10 — one refusal-construction sweep

Scope: handwritten TypeScript in `packages/snapback4/src`, including raw clients, facade, device adapters, mock and server worker SDK. Searched `code`, `denied`, refusal assignments and `new ServerError`, then enumerated object literals and constructor calls with the installed TypeScript parser. Generated wasm bindings do not construct SDK Refusal envelopes. This is a report artifact, not a new check or registry.

All six unevaluated construction sites reaching raw query publication now use the existing private Symbol helper: five in mixed search, one in online request encoding. The helper is exported internally as `sdkRefusal`; the public Refusal shape and diagnostic text are unchanged. Two are decoder/response validation, four are SDK admission/input/allowance failures. Actual device/server denials remain unmarked evaluated evidence for every code. Lifecycle boundaries deliberately withdraw independently. Other SDK diagnostics below belong to write, action, effect, auth, residency or mock APIs and do not enter raw query reconciliation; adding query-provenance markers there would not repair this pattern.

The sweep found no further instance of an unmarked unevaluated SDK failure entering raw query publication. It stops here. Existing terminal schema-401 handling, write-outcome codecs and worker action/effect failures are listed, not redesigned. No fresh audit of those separate protocols is claimed.

`refusal-constructors.json` contains all 157 syntax matches with exact source, line and disposition: 154 outside-helper refusal constructions, two shared helper constructions, and one non-Refusal action-settlement field. Propagating `denied`/`why` without constructing a new refusal preserves its existing origin; it is not an additional construction site.

| File:line | Code | Origin and disposition |
| --- | --- | --- |
| `actions.ts:10` | `"E_ACTION_UNKNOWN"` | SDK action preflight (operation kind / JSON arguments); action result only. |
| `actions.ts:14` | `"E_INPUT"` | SDK action preflight (operation kind / JSON arguments); action result only. |
| `admission-authority.ts:45` | `"E_AUTH"` | Write admission scope/session boundary; no query replacement. |
| `admission.ts:15` | `"E_ADMISSION"` | Durable write admission/storage failure; failed write only. |
| `app-client.ts:32` | `"E_CLIENT"` | App session-storage verification failure (32), or write JSON preflight (229); app scope check / write only. |
| `app-client.ts:229` | `"E_INPUT"` | App session-storage verification failure (32), or write JSON preflight (229); app scope check / write only. |
| `app-journal.ts:25` | `"E_STORE_REPLACED"` | Store replacement (25), absent write-receipt input (72), or storage warning (114, 118); journal/write lifetime only. |
| `app-journal.ts:72` | `"E_WRITE_RECEIPT_EXPIRED"` | Store replacement (25), absent write-receipt input (72), or storage warning (114, 118); journal/write lifetime only. |
| `app-journal.ts:114` | `"E_CLIENT"` | Store replacement (25), absent write-receipt input (72), or storage warning (114, 118); journal/write lifetime only. |
| `app-journal.ts:118` | `"E_CLIENT"` | Store replacement (25), absent write-receipt input (72), or storage warning (114, 118); journal/write lifetime only. |
| `app-online.ts:63` | `write.why.code` | Write receipt projection (63, 269), write session precondition (140, 145), or unknown write admission (177); write-only. |
| `app-online.ts:140` | `"E_AUTH"` | Write receipt projection (63, 269), write session precondition (140, 145), or unknown write admission (177); write-only. |
| `app-online.ts:145` | `"E_AUTH"` | Write receipt projection (63, 269), write session precondition (140, 145), or unknown write admission (177); write-only. |
| `app-online.ts:177` | `"E_STORE"` | Write receipt projection (63, 269), write session precondition (140, 145), or unknown write admission (177); write-only. |
| `app-online.ts:269` | `why.code` | Write receipt projection (63, 269), write session precondition (140, 145), or unknown write admission (177); write-only. |
| `app-revocations.ts:25` | `"E_CLIENT"` | Session revocation-storage warning; app auth lifetime. |
| `app.ts:58` | `code` | App auth/configuration/storage failure (58, 73), session replacement (66), superseded app call (228), unreachable replacement backend (451), or logout precondition (705); app identity lifetime, not raw query reconciliation. |
| `app.ts:66` | `"E_AUTH"` | App auth/configuration/storage failure (58, 73), session replacement (66), superseded app call (228), unreachable replacement backend (451), or logout precondition (705); app identity lifetime, not raw query reconciliation. |
| `app.ts:73` | `"E_CLIENT"` | App auth/configuration/storage failure (58, 73), session replacement (66), superseded app call (228), unreachable replacement backend (451), or logout precondition (705); app identity lifetime, not raw query reconciliation. |
| `app.ts:228` | `"E_CLOSED"` | App auth/configuration/storage failure (58, 73), session replacement (66), superseded app call (228), unreachable replacement backend (451), or logout precondition (705); app identity lifetime, not raw query reconciliation. |
| `app.ts:451` | `"E_OFFLINE"` | App auth/configuration/storage failure (58, 73), session replacement (66), superseded app call (228), unreachable replacement backend (451), or logout precondition (705); app identity lifetime, not raw query reconciliation. |
| `app.ts:705` | `"E_AUTH"` | App auth/configuration/storage failure (58, 73), session replacement (66), superseded app call (228), unreachable replacement backend (451), or logout precondition (705); app identity lifetime, not raw query reconciliation. |
| `asset-lifetime.ts:17` | `"E_ASSET_UNKNOWN"` | Explicit SDK grant invalidation after authority/scope/deadline evidence; intentionally withdraws the asset. |
| `auth.ts:15` | `"E_AUTH"` | Auth-helper missing/invalid-session preflight; SignIn result only. |
| `client.ts:361` | `"E_AUTH"` | Client/session/store boundary; explicit withdrawal or auth/asset helper result, independent of evaluated-query origin. |
| `client.ts:362` | `"E_CLOSED"` | Client/session/store boundary; explicit withdrawal or auth/asset helper result, independent of evaluated-query origin. |
| `client.ts:367` | `code` | Client/session/store boundary; explicit withdrawal or auth/asset helper result, independent of evaluated-query origin. |
| `client.ts:438` | `"E_AUTH"` | Client/session/store boundary; explicit withdrawal or auth/asset helper result, independent of evaluated-query origin. |
| `client.ts:469` | `"E_AUTH"` | Client/session/store boundary; explicit withdrawal or auth/asset helper result, independent of evaluated-query origin. |
| `client.ts:534` | `"E_INPUT"` | SDK JSON request preflight; now marked admission. |
| `client.ts:592` | `"E_AUTH"` | Client/session/store boundary; explicit withdrawal or auth/asset helper result, independent of evaluated-query origin. |
| `client.ts:1048` | `"E_AUTH"` | Client/session/store boundary; explicit withdrawal or auth/asset helper result, independent of evaluated-query origin. |
| `client.ts:1056` | `"E_AUTH"` | Client/session/store boundary; explicit withdrawal or auth/asset helper result, independent of evaluated-query origin. |
| `client.ts:1080` | `"E_AUTH"` | Client/session/store boundary; explicit withdrawal or auth/asset helper result, independent of evaluated-query origin. |
| `client.ts:1117` | `"E_AUTH"` | Client/session/store boundary; explicit withdrawal or auth/asset helper result, independent of evaluated-query origin. |
| `device-restore.ts:11` | `"E_STORE_RESTORE"` | Detected store restore; terminal scope withdrawal. |
| `ephemeral.ts:5` | `"E_OFFLINE"` | Signal-lane connectivity (5), closed scope (49), input validation (122), or queue admission limit (128); mutation signal only. |
| `ephemeral.ts:49` | `"E_CLOSED"` | Signal-lane connectivity (5), closed scope (49), input validation (122), or queue admission limit (128); mutation signal only. |
| `ephemeral.ts:122` | `"E_INPUT"` | Signal-lane connectivity (5), closed scope (49), input validation (122), or queue admission limit (128); mutation signal only. |
| `ephemeral.ts:128` | `"E_RATE_LIMIT"` | Signal-lane connectivity (5), closed scope (49), input validation (122), or queue admission limit (128); mutation signal only. |
| `http-response.ts:26` | `'E_OFFLINE'` | Shared marked transport/decoder helper (excluded from outside-helper findings). |
| `http-response.ts:29` | `'E_HTTP_RESPONSE'` | Shared marked transport/decoder helper (excluded from outside-helper findings). |
| `identity-runtime.ts:65` | `denied.code` | Server worker identity action validation / response failure or forwarded engine refusal; no browser query reconciliation. |
| `identity-runtime.ts:80` | `"E_OIDC_MINT"` | Server worker identity action validation / response failure or forwarded engine refusal; no browser query reconciliation. |
| `identity-runtime.ts:88` | `"E_OIDC_RECIPE"` | Server worker identity action validation / response failure or forwarded engine refusal; no browser query reconciliation. |
| `identity-runtime.ts:90` | `"E_OIDC_RECIPE"` | Server worker identity action validation / response failure or forwarded engine refusal; no browser query reconciliation. |
| `identity-runtime.ts:94` | `"E_OIDC_RECIPE"` | Server worker identity action validation / response failure or forwarded engine refusal; no browser query reconciliation. |
| `identity.ts:147` | `"E_OIDC_RECIPE"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:153` | `"E_OIDC_CONFIG"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:156` | `"E_OIDC_CONFIG"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:160` | `"E_OIDC_CONFIG"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:164` | `"E_OIDC_CONFIG"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:167` | `"E_OIDC_CONFIG"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:169` | `"E_OIDC_CONFIG"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:173` | `"E_OIDC_CONFIG"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:178` | `"E_OIDC_CONFIG"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:179` | `"E_OIDC_CONFIG"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:180` | `"E_OIDC_CONFIG"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:194` | `"E_OIDC_PROVIDER"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:217` | `"E_OIDC_PROVIDER"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:236` | `"E_OIDC_PROVIDER"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:253` | `"E_OIDC_PROVIDER"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:285` | `"E_OIDC_EXCHANGE"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:293` | `"E_OIDC_EXCHANGE"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:349` | `"E_OIDC_BINDING"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:371` | `"E_OIDC_TRANSACTION"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:385` | `"E_OIDC_CALLBACK"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:389` | `"E_OIDC_CALLBACK"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:393` | `"E_OIDC_CALLBACK"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:396` | `"E_OIDC_REPLAY"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:402` | `"E_OIDC_REPLAY"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:498` | `"E_OIDC_EXCHANGE"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:508` | `"E_OIDC_TRANSACTION"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `identity.ts:549` | `"E_OIDC_HANDOFF"` | Server worker identity configuration, provider metadata, verified claims, transaction, callback, exchange or handoff refusal; evaluated identity-action path, not client read publication. |
| `local-assets.ts:36` | `"E_OFFLINE"` | No offline retained bytes (36) or superseded credential download (220); asset result only, not a row/asset-absence revocation. |
| `local-assets.ts:220` | `"E_AUTH"` | No offline retained bytes (36) or superseded credential download (220); asset result only, not a row/asset-absence revocation. |
| `local-backend.ts:28` | `"E_AUTH"` | HTTP 401 schema-discovery rejection; existing terminal auth boundary, not an evaluated query result. |
| `local-delivery.ts:75` | `"E_STORE_REPLACED"` | Detected store replacement/restore sentinel; delivery rejected and scope withdrawn independently. |
| `local-delivery.ts:79` | `"E_STORE_RESTORE"` | Detected store replacement/restore sentinel; delivery rejected and scope withdrawn independently. |
| `local-search.ts:37` | `"E_BOUND"` | SDK coordinator allowance exhaustion; now marked admission. |
| `local-search.ts:160` | `"E_INPUT"` | Device response missing search ledger; now marked decoder. |
| `local-search.ts:175` | `"E_INPUT"` | SDK cursor decoding/input rejection; now marked admission. |
| `local-search.ts:178` | `"E_INPUT"` | SDK cursor shape/input rejection; now marked admission. |
| `local-search.ts:263` | `"E_INPUT"` | HTTP search overlap response validation; now marked decoder. |
| `local-sync.ts:46` | `"E_INPUT"` | Literal used only to recognize the old server sync parser response; never published as a constructed refusal. |
| `local.ts:342` | `"E_CLOSED"` | Closed/session boundary (342, 372, 431, 432, 456, 465, 1282, 1336, 1337); unknown write response/admission (1151, 1251) is write-only. |
| `local.ts:342` | `"E_AUTH"` | Closed/session boundary (342, 372, 431, 432, 456, 465, 1282, 1336, 1337); unknown write response/admission (1151, 1251) is write-only. |
| `local.ts:372` | `"E_AUTH"` | Closed/session boundary (342, 372, 431, 432, 456, 465, 1282, 1336, 1337); unknown write response/admission (1151, 1251) is write-only. |
| `local.ts:431` | `"E_CLOSED"` | Closed/session boundary (342, 372, 431, 432, 456, 465, 1282, 1336, 1337); unknown write response/admission (1151, 1251) is write-only. |
| `local.ts:432` | `"E_AUTH"` | Closed/session boundary (342, 372, 431, 432, 456, 465, 1282, 1336, 1337); unknown write response/admission (1151, 1251) is write-only. |
| `local.ts:456` | `"E_CLOSED"` | Closed/session boundary (342, 372, 431, 432, 456, 465, 1282, 1336, 1337); unknown write response/admission (1151, 1251) is write-only. |
| `local.ts:465` | `"E_AUTH"` | Closed/session boundary (342, 372, 431, 432, 456, 465, 1282, 1336, 1337); unknown write response/admission (1151, 1251) is write-only. |
| `local.ts:1151` | `"E_STORE"` | Closed/session boundary (342, 372, 431, 432, 456, 465, 1282, 1336, 1337); unknown write response/admission (1151, 1251) is write-only. |
| `local.ts:1251` | `"E_STORE"` | Closed/session boundary (342, 372, 431, 432, 456, 465, 1282, 1336, 1337); unknown write response/admission (1151, 1251) is write-only. |
| `local.ts:1282` | `"E_AUTH"` | Closed/session boundary (342, 372, 431, 432, 456, 465, 1282, 1336, 1337); unknown write response/admission (1151, 1251) is write-only. |
| `local.ts:1336` | `"E_CLOSED"` | Closed/session boundary (342, 372, 431, 432, 456, 465, 1282, 1336, 1337); unknown write response/admission (1151, 1251) is write-only. |
| `local.ts:1337` | `"E_AUTH"` | Closed/session boundary (342, 372, 431, 432, 456, 465, 1282, 1336, 1337); unknown write response/admission (1151, 1251) is write-only. |
| `mock-ephemeral.ts:34` | `"E_OP"` | Labelled mock signal evaluator: unknown op, callback exception or invalid ephemeral write; no real-client read reconciliation. |
| `mock-ephemeral.ts:46` | `"E_CLIENT"` | Labelled mock signal evaluator: unknown op, callback exception or invalid ephemeral write; no real-client read reconciliation. |
| `mock-ephemeral.ts:50` | `"E_QUARRY_EPHEMERAL"` | Labelled mock signal evaluator: unknown op, callback exception or invalid ephemeral write; no real-client read reconciliation. |
| `mock.ts:94` | `"E_OP"` | Labelled mock evaluation/handler lookup or mock auth/asset state; not the production server/device publication path. |
| `mock.ts:95` | `"E_AUTH"` | Labelled mock evaluation/handler lookup or mock auth/asset state; not the production server/device publication path. |
| `mock.ts:119` | `link === "offline" ? "E_OFFLINE" : "E_AUTH"` | Labelled mock evaluation/handler lookup or mock auth/asset state; not the production server/device publication path. |
| `mock.ts:123` | `"E_ACTION_UNKNOWN"` | Labelled mock evaluation/handler lookup or mock auth/asset state; not the production server/device publication path. |
| `mock.ts:126` | `"E_ACTION_FAILED"` | Labelled mock evaluation/handler lookup or mock auth/asset state; not the production server/device publication path. |
| `mock.ts:154` | `"E_OP"` | Labelled mock evaluation/handler lookup or mock auth/asset state; not the production server/device publication path. |
| `mock.ts:155` | `"E_AUTH"` | Labelled mock evaluation/handler lookup or mock auth/asset state; not the production server/device publication path. |
| `mock.ts:197` | `"E_ASSET_UNKNOWN"` | Labelled mock evaluation/handler lookup or mock auth/asset state; not the production server/device publication path. |
| `mock.ts:207` | `"E_AUTH"` | Labelled mock evaluation/handler lookup or mock auth/asset state; not the production server/device publication path. |
| `mock.ts:208` | `"E_AUTH"` | Labelled mock evaluation/handler lookup or mock auth/asset state; not the production server/device publication path. |
| `online-delivery.ts:31` | `typeof json.store_id === "string" && store && json.store_id !== store ? "E_STORE_REPLACED" : "E_STORE_RESTORE"` | Store replacement/restore sentinel after identity evidence; rejected delivery, explicit scope withdrawal. |
| `residency.ts:14` | `"E_STORE"` | Residency device-call/storage failure, thrown as an exception; not a query observation. |
| `server-context.ts:31` | `"E_ACTION_CLOSED"` | Server action closed/deadline/lease/cancel/status lifetime or forwarded refusal; action context only. |
| `server-context.ts:38` | `why.code` | Server action closed/deadline/lease/cancel/status lifetime or forwarded refusal; action context only. |
| `server-context.ts:43` | `"E_ACTION_DEADLINE"` | Server action closed/deadline/lease/cancel/status lifetime or forwarded refusal; action context only. |
| `server-context.ts:49` | `why.code` | Server action closed/deadline/lease/cancel/status lifetime or forwarded refusal; action context only. |
| `server-context.ts:74` | `why.code` | Server action closed/deadline/lease/cancel/status lifetime or forwarded refusal; action context only. |
| `server-context.ts:97` | `"E_ACTION_LEASE"` | Server action closed/deadline/lease/cancel/status lifetime or forwarded refusal; action context only. |
| `server-context.ts:99` | `"E_ACTION_CANCELLED"` | Server action closed/deadline/lease/cancel/status lifetime or forwarded refusal; action context only. |
| `server-context.ts:101` | `status.errorCode ?? "E_ACTION_LEASE"` | Server action closed/deadline/lease/cancel/status lifetime or forwarded refusal; action context only. |
| `server-context.ts:104` | `"E_OFFLINE"` | Server action closed/deadline/lease/cancel/status lifetime or forwarded refusal; action context only. |
| `server-context.ts:137` | `closedWhy.code` | Server action closed/deadline/lease/cancel/status lifetime or forwarded refusal; action context only. |
| `server-effect-context.ts:40` | `"E_EFFECT_CLOSED"` | Server effect closed/lease/cancel/status/transport lifetime or forwarded refusal; effect context only. |
| `server-effect-context.ts:47` | `why.code` | Server effect closed/lease/cancel/status/transport lifetime or forwarded refusal; effect context only. |
| `server-effect-context.ts:54` | `why.code` | Server effect closed/lease/cancel/status/transport lifetime or forwarded refusal; effect context only. |
| `server-effect-context.ts:68` | `"E_OFFLINE"` | Server effect closed/lease/cancel/status/transport lifetime or forwarded refusal; effect context only. |
| `server-effect-context.ts:75` | `json.denied.code` | Server effect closed/lease/cancel/status/transport lifetime or forwarded refusal; effect context only. |
| `server-effect-context.ts:78` | `"E_OFFLINE"` | Server effect closed/lease/cancel/status/transport lifetime or forwarded refusal; effect context only. |
| `server-effect-context.ts:86` | `"E_EFFECT_LEASE"` | Server effect closed/lease/cancel/status/transport lifetime or forwarded refusal; effect context only. |
| `server-effect-context.ts:88` | `"E_EFFECT_CANCELLED"` | Server effect closed/lease/cancel/status/transport lifetime or forwarded refusal; effect context only. |
| `server-effect-context.ts:90` | `status.errorCode ?? "E_EFFECT_LEASE"` | Server effect closed/lease/cancel/status/transport lifetime or forwarded refusal; effect context only. |
| `server-effect-context.ts:100` | `"E_OFFLINE"` | Server effect closed/lease/cancel/status/transport lifetime or forwarded refusal; effect context only. |
| `server-effect-context.ts:119` | `"E_OFFLINE"` | Server effect closed/lease/cancel/status/transport lifetime or forwarded refusal; effect context only. |
| `server-effect-context.ts:129` | `closedWhy.code` | Server effect closed/lease/cancel/status/transport lifetime or forwarded refusal; effect context only. |
| `server-json.ts:10` | `code` | Server action JSON/label validation and ServerError refusal constructor; never enters client query reconciliation directly. |
| `server-json.ts:28` | `code` | Server action JSON/label validation and ServerError refusal constructor; never enters client query reconciliation directly. |
| `server-json.ts:75` | `code` | Server action JSON/label validation and ServerError refusal constructor; never enters client query reconciliation directly. |
| `server-routes.ts:46` | `"E_ROUTE_RESULT"` | Server route result validation; action/route path only. |
| `server-steps.ts:45` | `"E_STEP_INPUT"` | Server action step input mismatch or parked ambiguous outcome; step lifetime only. |
| `server-steps.ts:52` | `"E_STEP_PARKED"` | Server action step input mismatch or parked ambiguous outcome; step lifetime only. |
| `server.ts:84` | `"E_SERVER_CONFIG"` | Server worker configuration, handler/generation/secret or private route argument validation; action runtime only. |
| `server.ts:86` | `"E_SERVER_CONFIG"` | Server worker configuration, handler/generation/secret or private route argument validation; action runtime only. |
| `server.ts:94` | `"E_SERVER_HANDLERS"` | Server worker configuration, handler/generation/secret or private route argument validation; action runtime only. |
| `server.ts:97` | `"E_SERVER_HANDLERS"` | Server worker configuration, handler/generation/secret or private route argument validation; action runtime only. |
| `server.ts:106` | `"E_SERVER_HANDLERS"` | Server worker configuration, handler/generation/secret or private route argument validation; action runtime only. |
| `server.ts:114` | `"E_SERVER_HANDLERS"` | Server worker configuration, handler/generation/secret or private route argument validation; action runtime only. |
| `server.ts:126` | `"E_SECRET_MISSING"` | Server worker configuration, handler/generation/secret or private route argument validation; action runtime only. |
| `server.ts:138` | `"E_ACTION_GENERATION"` | Server worker configuration, handler/generation/secret or private route argument validation; action runtime only. |
| `server.ts:165` | `"E_ROUTE_RESULT"` | Server worker configuration, handler/generation/secret or private route argument validation; action runtime only. |
| `session-authority.ts:15` | `"E_CLIENT"` | Session-storage warning; app auth authority lifetime. |
| `web-receipts.ts:13` | `write.why.code` | Projection of a device write receipt for persistence; no read refusal crosses this codec. |
| `web-worker-device.ts:29` | `"E_AUTH"` | Worker credential misuse refusal thrown at the device transport boundary (29); projected write receipt (104). HTTP query decoding stays on the page. |
| `web-worker-device.ts:104` | `write.why.code` | Worker credential misuse refusal thrown at the device transport boundary (29); projected write receipt (104). HTTP query decoding stays on the page. |
| `web.ts:349` | `write.why.code` | Projection of a device write receipt for persistence; no read refusal crosses this codec. |
| `worker.ts:197` | `code` | Not a Refusal: optional error-code field in an action settlement envelope. |
| `writes.ts:33` | `code` | Write submission validation (33) or projection of a write receipt (114); write-only. |
| `writes.ts:114` | `write.why.code` | Write submission validation (33) or projection of a write receipt (114); write-only. |
