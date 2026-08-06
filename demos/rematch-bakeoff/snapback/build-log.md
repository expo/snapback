# Build Log — rematch-snapback

START_EPOCH: 1786042571 (Thu Aug  6 11:56:11 PDT 2026)

## Phase: Discovery
- [$(date)] Found npm packages: @expo/snapback-cli@0.1.10 (bin: snapback), -client, -react, -codegen, -contract. All published ~20min ago, latest tag.

- [1786042671] Scaffolded 'rematch' via snapback new --template react. Template ships schema.mjs/functions.mjs/seed.json + React client + acceptance tests. AGENTS.md points to served guide + 'snapback guide <query>'.

- [1786042904] Read guide pages (served from dev server on :4287): react-expo, ephemeral-state, assets, offline-and-retention, sessions-and-principals, queries, mutations, your-first-backend. Key decisions:
  - Sessions auth mode (required for in-app asset upload custody); personas minted via 'snapback session mint' behind a local dev broker; app-level identity = user handles in my own users table (principal ids are not seedable).
  - Typing = ephemeral collection scoped by conversationId + useSnapbackPresence.
  - Offline = declarative live queries with auth:'public' + authorityIndependent:true (rqsEligible cold retention); scripted Node file-store cold-start proof per the paved witness pattern.
  - Images = defineAssetUpload intent + useSnapbackAssetUpload + ctx.assets.attach; delivery public-immutable for pasteable <img> URLs.
  - @expo/snapback-expo@0.1.10 IS on npm (guide note about 0.1.9 closure is stale).

- [1786043114] CORRECTION LOOP 1 (framework): 'authorityIndependent: true' live queries force experimental capability single_table_v1; the PUBLISHED runtime target refuses it (SNAPBACK_CAPABILITY_UNSUPPORTED at dev-server start). Embedded capability index admits: "public packages and remote/hosted targets remain structured GAPs" — i.e. framework-native rqsEligible cold retention is not available to npm consumers. Workaround: drop authorityIndependent; implement app-level offline history cache (localStorage/AsyncStorage snapshot of query data) for the cold-start proof. Knowledge source: error string + snapback guide search + reading published @expo/snapback-codegen/index.mjs.

- [1786043803] CORRECTION LOOP 2 (self/docs ambiguity): useSnapbackPresence refused generated api.ephemeral.typing under a manifest-only prepareReactBinding (SNAPBACK_REACT_REFERENCE_INVALID). Fix: pass the generated app descriptor (import { app } from api.mjs) as generatedManifest so binding admission runs in descriptor mode. Found by reading react-binding.mjs admission code in the published client package.
- [1786043803] Expo web boots; playwright(chrome) drives it. Ports 8081/8082 occupied by ANOTHER agent's Metro on this machine — moved to 8095 (logged as environment friction, not framework).

- [1786043995] CORRECTION LOOP 3 (tooling): Metro served a stale full bundle after source edits (HMR pushed but fresh page loads got cached module graph) — masked the descriptor-mode fix; resolved with 'expo start --clear'. Loop 2's descriptor-mode change was still required (manifest-only binding genuinely refused the ephemeral reference on first fresh bundle).

- [1786044143] CORRECTION LOOP 4 (framework): browser TUS upload PATCH blocked by CORS — server's access-control-allow-headers omits upload-offset/tus-resumable/upload-checksum, so Expo-web (no @expo/snapback-vite relay available outside Vite) cannot upload directly to :4287. The guide's paved browser path is the Vite relay; Expo web has no paved relay. Workaround: added a ~60-line HTTP+WS reverse relay to my dev broker (port 8789) that reflects requested CORS headers; web client uses the relay as serverUrl.

- [1786044245] UI PROOF: 10/10 steps PASS via playwright+Chrome on Expo web (seeded render, persona switch, typing both directions, live delivery + typing clear, reply quote, live reactions, picker→TUS upload→attach→render image with public rendition bytes verified, third persona sees history). Screenshots in artifacts/01..10.

- [1786044448] CORRECTION LOOP 5 (self): headless subscribeEphemeral returns a Promise — I used the overlay without await. Fixed.
- [1786044448] CORRECTION LOOP 6 (self/docs): headless liveQuery default transport is 'poll' (manual poll()) — rows never advanced in acceptance; realtime/live-queries.md documents transport:'stream'. Fixed by passing transport:'stream'.
- [1786044448] HEADLESS ACCEPTANCE: 9/9 PASS (identity, seeds, auth refusal, cross-session send, live stream delivery, reply pointer, reaction toggle, typing ephemeral two clients, image upload→attach→public delivery).

- [1786044503] OFFLINE COLD-START PROOF: PASS — persistent Chrome profile primed online, backend stopped, cold relaunch shows offline banner + cached conversation list + full seeded history (screenshots artifacts/11-13). Backend restarted after (same sqlite db, data persisted).

- [1786044738] CORRECTION LOOP 7 (framework paper cut): useSnapbackAssetImage's rendition src is the strict-delivery route (/assets/records/.../bytes/best), which a plain <img> cannot fetch on a sessions server (needs the auth-client protocol header) -> empty image bubbles. Fixed by rendering the pasteable public-immutable URL (/assets/public/<id>/thumb) with an onError retry for the async rendition publication race.
- [1786044738] CORRECTION LOOP 8 (tooling, recurring): Metro file-watching does not pick up edits under this /private/tmp scratchpad (fresh full-bundle requests serve stale graphs); every code change needs an 'expo start --clear' restart. Counted once more here; workaround is standing.
- [1786044738] FINAL UI PROOF: 10/10 PASS with image pixels verified rendering (artifacts/08, 08c). iOS Hermes export: app/dist-ios/_expo/static/js/ios/index-12545884062c5433258ddab8e334b379.hbc (3.7MB, Hermes bytecode magic verified).

END_EPOCH: 1786044764 (Thu Aug  6 12:32:44 PDT 2026)
TOTAL_SECONDS: 2193 (~36 min)
