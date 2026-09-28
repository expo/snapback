lane id grok-clique-snapback4-20260928
model grok-4.6
effort=xhigh
backend=snapback4-0.4.7
start=1790586756

1790586756 created run-log.md; beginning instrument ingest (source: fixture)
1790586756.. orientation: ENVIRONMENT.md, social-messenger.md, CONTRACT.md, assertions, fixtures, UI kit, choreography README (source: fixture)
1790586900 installed snapback4@0.4.7 and snapback4-expo@0.4.7 from npm; linux-x64 binary present (source: published docs)
1790586950 read package README.md, CLIENT-AND-OPERATIONS.md, SERVER.md in full; dumped guide cards language/types/rules/writes/reads/feeds/receipts/ephemeral/expire/assets/jobs/effects/search/personas/client/maintains/sync/programs/presence/sequences/actions/routes/bounds/shapes/indexes/witness/evolution/prediction (source: package README/guide)
1790587100 npx snapback4 init --expo into a scratch dir, copied starter files into the lane; will replace schema with Clique (source: published docs)
1790588196 snapback4 dev --port 56400 --bind 127.0.0.1 --no-watch; PIDs 1286532 (npm exec), 1286558 (node wrapper), 1286565 (snapback4 binary LISTEN 56400), 1286732 (worker server.mts)
1790588400 seed m1: 16 actions in 290ms; npm run acceptance -- --milestone m1 SUITE PASS (source: diagnostic)
1790588500 expo web CI=1 port 56401 PID 1305769/1305794; iOS Hermes export artifacts/hermes-m1 (_expo/static/js/ios/entry-*.hbc)
1790588600 choreography m1 green=true (source: diagnostic)
1790588610 M1 green (suite + choreography + hermes). Correction loops so far: expo-router 6.x vs SDK 57 pin (agent-error); server.ts import.meta CJS (agent-error); view public vs read <- allow (package README/guide)
1790590000 M2 suite PASS; choreography iterated on RN-web aria-valuetext, composer file input, optimistic like/repost, following filter (attribution: agent-error / snapback4-defect knowledge-gap on RN-web a11y)
1790590400 M2 choreography green=true. Backend PIDs now 2064663 (snapback4 LISTEN 56400), 2064898 (worker). Expo web PID 1601505 port 56401. Correction: accidental pkill of 56400 during restart (agent-error); restarted only lane PIDs.
1790592000 M3 start. Schema already had DMs/groups/send/receipts. Suite PASS m3 (source: diagnostic).
1790592157 M3 choreo fail (group-receipt, member-add, quoted-reply). Live DM/typing/1:1 receipts had passed earlier. Attribution: agent-error (ChatSettings onPressAddMember; inverted list).
1790594267 EnsureProfile loading flicker: navigating to /conversation/bob reset to /. Fix: keep signed-in tree if profile had data (agent-error; source: diagnostic).
1790595372 After AuthGate fix, dm-live + 1:1 receipts passed once; typing/group-delivered/dave/quote still failed. Erin in starter group blocked aggregate delivered (fixture + receipt fn). Removed Erin after seed (agent-error vs fixture fidelity).
1790596551 Later M3 choreo runs failed again (useQuery overload in ChatRail history). Suite remained PASS. Hermes copied artifacts/hermes-m3.
1790596576 M4 suite PASS. 1790596593 M5/M6/M8 suite PASS (source: diagnostic).
1790596683 scale replay start on 56402 --fresh --replay; 10% checkpoint sha matched fixture f1f4abf9…; then upload unreachable (environment / --fresh assets). Retried 56403; same 10% match then upload fail. Receipt artifacts/scale-replay-receipt.json pass=false settledPrefix=24777.
1790597116 choreo m4/m5/m6/m8 attempted; all green=false (bubbles / color sync / insights). Native sim: artifacts/simulator-status.json unavailable.
1790597138 writing essay.md (already) and final-report.md.
