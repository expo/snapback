# Clique lane diary — grok-clique-familiar (backend snapback-familiar-0.1.29)

## M1 — Accounts and profiles (GREEN)
What I built: sessions-mode auth on Snapback's built-in password provider, principal→user binding table, ensureMe/updateProfile/userByHandle/me functions in the familiar TS profile, Expo Router web client (auth/gate/profile edit+view/settings), starter-m1 seed replay, acceptance suite, choreography m1 green.

What felt easy: the auth substrate itself — signUpWithPassword/signInWithPassword just worked, and the built-in KDF meant zero hand-rolled hashing. Unique indexes declared right on the schema made handle/email uniqueness a one-liner with a real server-side backstop.

What fought me: three rounds of named refusals — elevated reads can't hide in helper modules; `access.read: 'members'` isn't in the closed union; the familiar profile pins custody to durable-required (headless then needs fake-indexeddb). The platform told me exactly what was wrong every time, which is more than I can say for most backends.

What the familiar profile saved: the whole handler surface is plain TypeScript — I wrote Convex-shaped `query`/`mutation` constructors and the ctx.db builder (withIndex/eq/take/collect) felt immediately natural. What remained Snapback-specific: result contracts (return closed records, not live docs, from mutations), the assets intent system, codegen.policy.json, and the generated `snapback/generated/` graph you must regenerate and never patch.

What was missing: a Familiar-native starter (the packaged template is explicit-profile only), and the guide's familiar page is the only doc — assets/grants/membership pages all show explicit-profile examples, so every media decision required translation.
