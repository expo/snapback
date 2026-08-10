# Diary 0059: Tandem Expo messaging backend bakeoff

**Date:** 2026-08-05
**App:** `demos/tandem-expo-bakeoff`
**Stacks:** Expo SDK 57 + Snapback; Expo SDK 57 + Convex 1.43

## What I built

Tandem is one native-feeling Expo Router product with two independently
implemented backend arms. It opens as Ada's inbox with two one-to-one DMs and
the four-person Design Crew chat. The seed has 12 messages, remote seed images,
reply previews, and aggregated emoji reactions. A conversation supports live
text and image sends, long-press reaction selection, a reply pointer above the
composer and in the resulting bubble, and other-participant typing indicators.
Replies remain ordinary messages in one chronological list; there is no thread
route or thread data model.

The first complete review found a demo-quality hole: every app instance was
initially fixed to Ada, so the typing implementation could pass a direct
backend proof while two humans still could not demonstrate it in the UI. I
added a four-person identity picker to the inbox. Two clients can now select
different seeded members and make the other-participant indicator visible.
That also makes the DM/group seed more useful without pretending this bakeoff
has production identity.

I kept the comparison honest by sharing the presentation code, backend-neutral
types, and interaction behavior only. Each backend has its own schema,
functions, seed, client hook adapter, and acceptance program. I did not inspect
or reuse the other agent's implementation.

The shared UI is 881 lines. Excluding seeds and tests, the Snapback arm is 602
lines for schema, operations, and Expo adapter, plus 138 lines for the trusted
local session/backend launcher. The corresponding Convex schema, functions,
and Expo adapter are 424 lines. Raw lines are a crude measure: the Snapback
side expresses more image-policy and runtime admission, while the Convex side's
typing table and cleanup machinery represent semantics Snapback supplies.

## Snapback experience

The best part was typing state. One ephemeral collection declares the scope,
connection key, and four-second TTL; `useSnapbackPresence` owns connection
identity, refresh, and expiry. The screen contributes only a conversation scope
and current value. The headless proof also checks that typing changes never
advance durable storage, which is a satisfying way to prove this is presence
rather than short-lived database data.

Typed assets were stronger than I expected. The upload definition constrains
JPEG/PNG input to 10 MB, strips metadata, requires thumbnail and display
variants, grants immutable public delivery, and lets the message store a typed
reference. The acceptance test uploads actual PNG bytes through resumable
storage, attaches the returned asset, and fetches the delivered display
variant. That is more policy and evidence than a bare file id.

The asset path was also the largest Snapback frustration. My first public
upload intent passed codegen and reservation, then its TUS transfer failed 403:
the declared owner did not match anonymous transfer authority. The guide's
authenticated examples and native broker seam were individually accurate, but
I did not find the rule stated at the point where a public Expo upload author
would need it. I changed the app to sessions mode and added a narrow
trusted-local broker that mints Ada's ordinary bearer token without sending
Snapback's admin or impersonation capability into the native bundle. That is
the right authority boundary, but it added substantial setup for a demo whose
product requirements did not otherwise include login.

Expo ImagePicker returns a native URI, while the Snapback upload hook wants a
blob-like upload body. `expo/fetch` made the URI-to-Blob bridge work, but this
recipe and the hook's concrete task/result states were not easy to discover in
the Snapback guide. I filed a guide-gap ticket for both asset findings.

Codegen was strict and useful: five tables, five operations, one ephemeral
collection, and no warnings. The local acceptance harness gave very strong
evidence, particularly the durable-version check and negative no-write cases.
The rougher infrastructure moments were that the reusable headless helper
assumes a demo lives directly under `demos/`, so this nested bakeoff initially
resolved the wrong repository root, and a dirty checkout bypasses a prepared
binary and makes acceptance pay Cargo startup cost.

A documentation-only `@ref` comment changed the generated function bundle
identity. Restarting against the existing local SQLite file then correctly
failed with `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`; the dev launcher has no
automatic local migration/reseed path for this case. I preserved the old local
state under ignored `.local-backups/` and re-seeded a fresh store. Strong
deployment pinning is good, but comments changing identity plus manual local
state rollover is surprisingly expensive in an edit/restart loop.

I am uncertain how to score the extra session broker work. Snapback is enforcing
a meaningful asset ownership contract that the anonymous Convex arm does not
have, but a first-party local Expo development identity path still feels more
ceremonious than it should.

### 2026-08-10 — carry the selected backend origin with broker entry

The original local shell wrote a backend origin into Metro's `.env.local` and
also kept a benchmark-era `http://127.0.0.1:4477` fallback in application
code. That split was easy to miss when the trusted broker continued minting a
healthy session but Snapback selected a different backend port: authentication
succeeded, then binding preparation contacted the stale fallback.

The broker now returns its stack-selected public Snapback origin beside the
ordinary bearer, and the Expo arm constructs `createExternalSessionClient`
from that response. This feels cleaner than asking the app and broker to agree
through two configuration carriers, and it keeps a dynamic port attached to
the same lifecycle owner that minted the session. The remaining manual broker
setup is still more ceremony than Convex's anonymous local path, but the
Snapback boundary is now explicit: bypassing `SnapbackExpoProvider` means the
custom stack owns both authority and origin propagation.

## Convex experience

The happy path was compact. `useQuery` and `useMutation` mapped directly into
the shared adapter, the anonymous local deployment came up without an account,
and storage was a generated upload URL followed by one POST. A real second
client received the inserted group message over WebSocket in the acceptance
proof. Returning storage URLs from the query also kept rendering simple.

Typing indicators exposed the opposite tradeoff from Snapback. I needed a
durable `typingIndicators` table, two indexes, a public mutation, an internal
expiry mutation, one scheduled job per refresh, a nonce guard against stale
jobs, a two-second client keepalive, and explicit cleanup. It works and the test
proves expiry, but the backend must reconstruct ephemeral presence semantics
from durable primitives. The database will also observe this churn even though
typing is not durable product history.

The local CLI had two small surprises. `convex dev --once` deploys functions
and then stops the anonymous backend, so the first post-deploy acceptance run
received connection failures until I kept `convex dev` alive. The agent-mode
flow also still asked whether to link the anonymous deployment. Finally, local
storage URLs use loopback; a physical phone reaching the API through Tuft needs
the adapter to rewrite storage origins to the separate public site tunnel.

Convex is materially faster to get from schema to a conventional live React
app. Snapback is materially clearer for truly ephemeral state and much more
prescriptive for media handling and evidence. Neither arm is a production auth
example: both accept the seeded sender supplied by the client, and the Convex
functions are intentionally anonymous. That keeps the product comparison
focused but means the line-count result must not be read as a security
comparison.

## Expo and device packaging

Expo Router, `expo-image`, ImagePicker, semantic React Native colors, haptics,
and Reanimated made the shared product layer pleasant. Strict TypeScript and
an iOS Hermes production export passed for both arms. The UI needed only thin
differences at each hook boundary.

EAS packaging was the frustrating part. Running EAS from either nested app
resolved the Snapback monorepo's Git root and spent minutes compressing a huge
checkout, even in no-VCS mode and even with a shell-local `.easignore`. I added
minimal native shells and ultimately staged them outside the checkout; the
archives became about 58 KB and uploaded immediately. The shells contain the
same native dependencies/config but deliberately load the real product bundle
from each parent Metro server. This workaround is captured in a repeatable
helper rather than left as terminal lore.

Both ad hoc iOS development-client builds finished successfully on EAS for all
six registered devices. This proves the native shells compile and are
installable; I did not claim a physical-device interaction receipt in this
session:

- Snapback build `8cc22eca-a64d-427a-b7c8-99cd9ef51c6c`
- Convex build `763dd305-ad53-4350-8979-6dc1b007b829`

## Verification

- Snapback runtime bootstrap: linked, launched, handler-VM-qualified, and wrote
  a digest-bound readiness receipt.
- Snapback codegen: passed with no warnings.
- Snapback strict TypeScript: passed.
- Snapback iOS Hermes export: passed (7.1 MB bundle).
- Snapback behavioral acceptance: 8/8 passed, including real typed image
  upload/delivery and ephemeral typing without a durable version advance.
- Convex strict TypeScript: passed.
- Convex iOS Hermes export: passed (5.3 MB bundle).
- Convex behavioral acceptance: 8/8 passed, including real storage
  upload/delivery, WebSocket second-client delivery, and scheduled typing
  expiry.
- Snapback and Convex EAS ad hoc development-client builds: finished.
- Both Metro servers: verified locally and through their Tuft public URLs; the
  served iOS manifests named the correct app and carried the public bundle
  origin.
