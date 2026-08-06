# Build log — rematch-convex (WhatsApp-shaped demo on Convex + Expo)

START_EPOCH: 1786044851  (Thu Aug  6 12:34:11 PDT 2026)
1786044860 [phase] env check: node v25.9.0, npm 11.12.1. Ports 3210/3211 (convex local defaults) OCCUPIED by other work; 8081/8082/8095/4287/8788/8789 also off-limits per brief. Will override ports.
1786044960 [phase] scaffold done: create-expo-app blank-typescript + convex@1.43.0 installed. Knowledge: convex CLI bundle grep showed choosePorts auto-detects free ports from 3210, and CONVEX_AGENT_MODE=anonymous is the documented non-interactive/anonymous path (found in cli.bundle.cjs help text for 'convex init'). No cloud login needed.
1786045025 [phase] backend code written (schema/chat/seed). Starting anonymous local deployment: CONVEX_AGENT_MODE=anonymous npx convex dev --once
1786045056 [note] local backend is child of 'convex dev' — dies when CLI exits. Keeping a background 'convex dev' as the live backend. seed:run returned {seeded:true, users:4}.
1786045217 [phase] client written (App.tsx, src/ChatApp.tsx, src/hooks.ts, src/storage.ts); tsc clean on first try. Starting expo web on 8097 + installing playwright.
1786045371 [correction-loop 1] (framework constraint, my design hit it) Convex values forbid non-ASCII object keys — emoji-keyed reactions record rejected at runtime with 'Field name ❤️ has invalid character'. Learned from server error message. Fix: reactions as array. 
1786045474 [phase] running UI online proofs (playwright, two clients)
1786045514 [phase] backend STOPPED for offline cold-start proof
1786045530 [phase] offline proof 6/6 PASS. Backend restarted. Exporting iOS Hermes bundle.
1786045598 [phase] proofs complete: API 16/16 (x2, incl. after backend restart — sqlite persistence held), UI online 13/13, offline cold-start 6/6. iOS Hermes export verified (magic c61f bc03, 1.8MB hbc). Screenshots spot-checked visually: bubbles/replies/reactions/typing header/offline banner all correct.
1786045598 [correction-loops] total 2 runtime + 1 self-caught: (1) framework-constraint: emoji keys invalid in Convex values -> reactions array; (2) framework-behavior: local backend exits with CLI after --once -> persistent background convex dev; (3) self-caused: mangled check() in ui-offline.mjs, caught on read-through before running.
END_EPOCH: 1786045598  (Thu Aug  6 12:46:38 PDT 2026)
TOTAL_SECONDS: 747 (~12 min)
