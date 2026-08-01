# LLP 0143 Expo push notification seam review — Codex family

## Round 1 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-08-01
**Redaction:** not redacted
**Method:** full round-1 — independent review per LLP 0005; reviewer directed to verify Expo push API citations, the never-claims list, token custody vs LLP 0053, egress-seam + LLP 0028/0070 composition, the a1expo-f5 hosted gate, and the motivating tickets (a4expo-f1, A4 EXPO-09); read-only sandbox in a fresh worktree of origin/main at a8dcb148, blind to fable artifacts
**Target SHA-256:** `16ec3b562c4ff9b8a595ce07d6f6c337b933cf68f21f9ed406adf065225bacf7`
**Instruction SHA-256:** `3c6d8c33feb2d492ae45712f7cb605339408d705f67f66f5944e160c36aee908`
**Status:** completed (first attempt, no retry needed)

### Verbatim review

## Overall assessment

**Verdict: NOT READY.**

I verified the exact requested bytes before review:

`16ec3b562c4ff9b8a595ce07d6f6c337b933cf68f21f9ed406adf065225bacf7`

I did not read any `llp/reviews/*.fable.md`.

The central decision is good: an Expo integration seam, distinct from LLP 0045’s eventual first-class notifications capability, is the right-sized response. However, several implementation-defining invariants remain contradictory or unresolved. Most importantly: the Expo API description contains concrete errors; the ledger cannot represent per-token outcomes safely; crash/idempotency semantics are unspecified; token rotation and authority binding are incomplete; and deferred work does not inherit user authority as claimed.

## Strengths

- The seam/capability distinction is disciplined and avoids competing with LLP 0045.
- Keeping token bytes outside app-readable rows and resolving principals to tokens host-side is the correct custody direction.
- The ticket → receipt distinction and names such as `handedToExpoAt` and `expoAcceptedAt` accurately reflect Expo’s boundary.
- Current-tree claims are well grounded:

  - `ctx.fetch → host.fetch` is implemented and action-gated under `SNAPBACK_OUTBOUND_ACTIONS` in [src/runtime.rs](</Users/ccheever/projects/snapback/src/runtime.rs:2169>).
  - The client terminal-auth observation surfaces exist in [packages/snapback-client/index.mjs](</Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5211>).
  - The generated manifest still reports `notifications: false` in [the local capability manifest](</Users/ccheever/projects/snapback/schemas/capability.manifest.local-dev-sqlite-ibex.json:191>), and the guide retains the explicit design-only GAP in [guide/capabilities.md](</Users/ccheever/projects/snapback/guide/capabilities.md:51>).
- Keeping hosted availability Missing is honest.
- The proposed local fixture can satisfy the intent of `EXPO-09-PUSH`, which asks only for a push boundary or explicit GAP, not physical-device delivery.

## Concerns

1. **MATERIAL — Several Expo API claims are inaccurate.**

   `getExpoPushTokenAsync()` returns `Promise<ExpoPushToken>`, an object whose `.data` field contains the string; it does not directly return an `ExponentPushToken[...]` string. `projectId` is optional in the API, defaults from Expo configuration, and is recommended explicitly—not unconditionally required as stated at [LLP 0143 lines 107–113](</Users/ccheever/projects/snapback/llp/0143-expo-push-notification-seam.rfc.md:107>). [Expo SDK reference](https://docs.expo.dev/versions/v56.0.0/sdk/notifications/)

   `DeviceNotRegistered` can occur in either a push ticket or a receipt, but D1/D3 retire only on a receipt. HTTP 4xx failures are not collectively “safely retryable”: Expo calls malformed HTTP 400 requests permanent, while 429 and 5xx receive backoff. Missing enhanced-security authorization produces request error `UNAUTHORIZED`, not an `InvalidCredentials` receipt. Expo currently recommends checking receipts after about 15 minutes and clears them after 24 hours. [Expo sending documentation](https://docs.expo.dev/push-notifications/sending-notifications/)

   **Resolution:** Replace the prose with an explicit ticket/request/receipt error matrix, including retry class, retirement action, and persisted diagnostic. Correct the token return shape and `projectId` wording.

2. **MATERIAL — The attempt/idempotency state machine is not crash-safe.**

   An attempt row cannot simply be recorded “at the moment of the Expo POST” as proposed at [lines 223–229](</Users/ccheever/projects/snapback/llp/0143-expo-push-notification-seam.rfc.md:223>). The design needs to say what happens when the process crashes:

   - before durable attempt reservation;
   - after reservation but before transmission;
   - after Expo accepts bytes but before the ticket is persisted;
   - while persisting some tickets from a batch.

   Expo provides best-effort handoff and can duplicate downstream attempts. A `dedupeKey` cannot make an ambiguous POST safely repeatable without provider-side idempotency.

   **Resolution:** Define durable pre-send reservation, claim/fence ownership, canonical payload-and-audience binding, divergent-key reuse refusal, post-response settlement, ambiguity, retention/tombstones, and recovery after every crash point. State explicitly that ambiguous retries may duplicate notifications.

3. **MATERIAL — One aggregate attempt row cannot model Expo’s per-message protocol.**

   The RFC chunks up to 100 token messages but gives the attempt one scalar state. A batch can contain ticket success, ticket `DeviceNotRegistered`, other ticket errors, later receipt success, later receipt errors, and missing receipts simultaneously. One row cannot both become `expo-accepted` and retire only the affected token. This also makes D5’s “exactly one attempt row” incompatible with a multi-guest send.

   **Resolution:** Separate intent/dedupe chain, HTTP batch attempt, and per-token provider-message attempt. Ticket IDs, receipt state, error classification, and token retirement must live at the per-token level; aggregate status must be a derived projection.

4. **MATERIAL — Token custody is incomplete against LLP 0053 and Expo’s rotation model.**

   LLP 0053 treats logout, expiry, and admin session revocation as authority transitions requiring client-wide deletion ([LLP 0053](</Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:426>)). LLP 0143 does not pin:

   - the installation identity or its behavior under store reset;
   - the exact authority/session generation that owns a registration;
   - atomic server-side retirement on logout, expiry, and admin revocation;
   - races between one session’s logout and another session’s re-registration;
   - Expo token rotation while the app is running.

   Expo explicitly provides `addPushTokenListener` because a token can roll and the old token then becomes invalid. [Expo notifications reference](https://docs.expo.dev/versions/v56.0.0/sdk/notifications/)

   Registry identity also needs Expo project/application/environment scope; `(principal, installation)` alone cannot safely support multiple Expo projects or distinguish incompatible token domains.

   Finally, Expo’s example ticket error text can echo the token. Persisting a raw “ticket error” would violate custody even if operator inspection hides registry rows.

   **Resolution:** Resolve installation identity now; bind each registration to app/EAS project, installation generation, principal, and authority/session ownership; specify transactional replacement and terminal retirement; integrate token-change registration; and allowlist persisted provider fields so raw messages, requests, responses, and tokens never enter logs or ledgers.

5. **MATERIAL — Authorization does not compose with the landed scheduling semantics.**

   “Known principal” is not recipient authorization. It only prevents raw-token spray. The RFC relies on a conventional nested `requireRole` call without defining a platform-enforced relationship between that authorization decision and the later send.

   The one-off surface actually landed as mutation-only `ctx.jobs.enqueue(...)`, not an action-callable `ctx.scheduler.runAfter(...)`; see [LLP 0070](</Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:212>). Its shipped slice executes callees as system authority, and `producerPrincipal` is provenance rather than execution permission. Thus “send in an hour” does not inherit the initiating user’s authority as D2 implies.

   **Resolution:** Specify separate authority modes:

   - immediate client-triggered action;
   - cron/system action;
   - `ctx.jobs.enqueue` from an authorized mutation followed by a system action.

   Pin whether recipient authorization is captured transactionally, revalidated at attempt time, or represented by a narrow server-issued grant. Define generated audience resolvers and denial behavior rather than relying on arbitrary principal IDs.

6. **MATERIAL — The activation and read contracts are underspecified.**

   D6 promises zero registry/ledger/runtime cost when an app “declares nothing push-shaped,” but no declaration enables the seam or binds:

   - Expo project identity;
   - provider endpoint and access-token configuration;
   - eligible actions and their `uses` grants;
   - permitted audience resolver;
   - ledger read projection and row authorization;
   - retention limits.

   The suite-overridable provider endpoint is especially sensitive because it receives bearer-shaped push tokens. An app-controlled or production-available override becomes token exfiltration.

   **Resolution:** Add a concrete source declaration and generated manifest shape. Pin production to Expo’s endpoint; make overrides operator-owned, test-profile-only, preferably loopback-only, and unavailable to app arguments. Define the privacy-bounded ledger read contract.

7. **MATERIAL — `a1expo-f5` is broader than the hosted gate described here.**

   D4 says hosted is blocked until the executor can hold config and egress. The actual ticket says the hosted target lacks sessions/native authentication and requires hosted session routes plus a production broker/delivery path reachable from mobile clients ([a1expo-f5](</Users/ccheever/projects/snapback/issues/20260801-0137-a1expo-f5-hosted-mobile-gap.md:7>)). Without hosted native auth, authenticated token registration cannot work even if action egress does.

   **Resolution:** Define the hosted availability conjunction: hosted native authentication/session entry, authenticated registry operations, provider config custody, action egress, durable receipt polling, and a hosted conformance receipt. Keep the capability Missing until all pass.

8. **should-fix — The never-claims list is good but incomplete.**

   Delivery, display, interaction/read, and OS permission state are correctly excluded. It should also normatively disclaim:

   - exactly-once send and duplicate suppression;
   - cross-recipient or cross-intent ordering;
   - delivery latency, availability, and SLA;
   - continued token validity/current registration;
   - “sent” as a synonym for anything beyond the named ticket/receipt state.

   The phrase that products may render “invitations sent” at [lines 237–245](</Users/ccheever/projects/snapback/llp/0143-expo-push-notification-seam.rfc.md:237>) weakens the otherwise careful vocabulary.

   **Resolution:** Extend the normative list and require UI projections to preserve `handed to Expo`/`accepted by APNs or FCM`, or explicitly label “sent” as product copy not backed by a delivery fact.

9. **detail — Receipt limits and cadence should be pinned.**

   Expo permits up to 100 messages per send request and up to 1,000 receipt IDs per receipt request. Polling “within roughly a day” is too loose given the current recommendation and 24-hour clearing behavior.

   **Resolution:** Pin receipt chunking, initial delay, bounded retry schedule, missing-receipt terminal rule, and retention separately from Expo’s receipt availability window.

## Motivating tickets

- **`a4expo-f1`:** Yes, the design dissolves the design-ownership gap and matches the closed ticket’s intended resolution. Implementation plus the acceptance witness is still required to produce an actual mobile boundary.
- **`EXPO-09-PUSH`:** The proposal defines a credible local non-GAP witness, but the check cannot flip until registry, provider fixture, per-token ledger, receipt upgrade, authorization refusal, and retirement execute through the packaged client.
- **`a1expo-f5`:** No. LLP 0143 correctly should not dissolve it. The RFC must describe the complete gate accurately and continue reporting hosted Missing.

## Next step

Revise D1–D5 around a normalized per-token ledger, crash-safe send protocol, exact installation/authority identity, ticket-and-receipt error matrix, and trigger-specific authorization. Then run a Codex-family re-review against the revised hash before author acceptance.

LLP 0005 calls for this actual review to be saved as `llp/reviews/0143-expo-push-notification-seam.codex.md`. I could not create that artifact because this workspace is read-only.

*(Runner note: the verbatim body above is unaltered except that file citations the reviewer emitted as absolute paths into the disposable review worktree are mechanically rewritten to the equivalent paths under /Users/ccheever/projects/snapback/ to avoid dead worktree links; raw output is preserved in the session capture.)*
