# the-authoring-loop.md: stale expo-chat auth-mode claim, fossilized 0.1.8/pin-0.1.7 advice, no install line

**Opened:** 2026-08-08 · **Severity:** P1 (documentation correctness — golden path)

Three defects on the golden-path page, two of which actively contradict the
authoring skill:

1. **:51-53 claims the expo-chat starter "deliberately keeps the dev auth
   profile and seeded personas; a production chat adopts sessions auth."**
   The template ships `auth: { mode: 'sessions' }`
   (packages/snapback-cli/templates/expo-chat/snapback/schema.mjs:37,
   switched by 6d5005931 on 2026-08-08, one day after the page's
   `reviewed: 2026-08-07`). SKILL.md:64-66 states the opposite — correctly.
   A cold agent following this page would wrongly flip the schema or skip
   sessions-only upload wiring.
2. **:100-105 says "The registry's `latest` tag now selects the 0.1.8
   closure … pin `0.1.7` when you need the proven closure."**
   guide/published-closure.json records `newestPublished: 0.1.15`
   (2026-08-08); pinning 0.1.7 walks straight into SKILL.md traps 8/9/11
   (paved Expo-web carrier, spread-omit optional inputs, root
   `createAssetClient` all need ≥0.1.13/0.1.15). Replace the hardcoded
   version prose with a pointer to published-closure.json's
   `newestPublished`/`newestQualified` fields and state the
   qualified-vs-fast-path tradeoff without naming a floating "latest".
3. **No entry doc shows how to install the CLI.** The golden path's first
   command is `snapback doctor --json` and the prose says the command
   "ships in `@expo/snapback-cli`", but there is no
   `npm install -g @expo/snapback-cli` / `bunx` line anywhere (grep across
   SKILL.md, index.md, both getting-started pages: zero hits), and the
   install-free `npm create snapback-app` path is described as possibly
   unpublished. One install line in SKILL.md step 1 and at the top of this
   page.

Also minor, same page: the "4. Inspect" section (:275-277) leads with
`cargo run # prints the admin URL` on a page narrated around the packaged
CLI — lead with the `snapback dev`-printed URL and keep `cargo run` as the
contributor variant.

Found by the 2026-08-08 comprehensive docs review (entry-points slice).

## Resolution

Fixed 2026-08-08 (docs-review execution, 1284ae8a5). All four items: the
expo-chat paragraph now states the real sessions-mode default with
supervised auto-mint; the hardcoded 0.1.8/"pin 0.1.7" prose was replaced
with version-agnostic text sourcing `newestPublished`/`newestQualified`
from guide/published-closure.json (so a later publication cannot silently
stale it again); an install line was added to the page top and SKILL.md
step 1; and the Inspect section leads with `snapback admin --ready-file …`
with `cargo run` demoted to a contributor variant.
