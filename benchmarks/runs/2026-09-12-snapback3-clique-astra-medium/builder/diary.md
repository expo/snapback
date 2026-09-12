# Clique / Astra / Snapback 3 diary

1789223246 M1 boundary — see the exact terminal epoch in `evidence/m1-terminal.json`.

I built a partial Expo Router / React Native account and profile application, with the frozen kit left unchanged. Password signup, login, persistent browser sessions, logout, profile creation and editing, server-side handle uniqueness, and live profile reads use the installed S3 client and Quarry backend. The iOS Hermes export exists, but no native runtime behavior was demonstrated. The starter replay stops at the first avatar-bearing profile action. A deliberately separate diagnostic mode installs only textual persona fields for browser verification; it is not a completed starter segment.

The easiest part was the client shape once the backend compiled. One provider, typed operation references, `useQuery`, and mutations with settled receipts were enough for live editing. The frozen browser choreography observed those edits and the browser session lifecycle successfully. Built-in auth removed the need to implement password hashing or token persistence. A small independent API probe also confirmed short-password refusal and server-side logout revocation.

Quarry discovery fought me. The README named the language without giving a complete minimal schema and mutation. The supplemental guide pointed to an example that this cold build was not allowed to read. I used the installed parser sourcemap as an API-discovery source, never an application checkout. I initially declared an explicit id and redundant byId index, then guessed keyed-write syntax incorrectly. Those were first-pass mistakes, not previously completed work that regressed. The compiler's specific implicit-id and duplicate-index messages helped; generic grammar messages did less.

The decisive limitation was not a difficult implementation: the worker refused an image column with S3_CAPABILITY_UNAVAILABLE. The public product README had already disclosed the absence of media, and the diagnostic matched it. I removed that column only from the explicitly partial account app, preserving the failed source and diagnostic separately. I did not encode images into text or add a storage server, because that would replace a platform capability the instructions explicitly required me to assess.

Prior familiarity with React, Expo, browser automation, relational uniqueness, and token APIs saved scaffolding time. I brought no prior Clique implementation or Snapback checkout knowledge into the build. Compared with the backend models I know, S3's query/mutation and resource interfaces felt compact; the narrower runtime made this whole product impossible before those interfaces could be tested against messaging or offline depth.

One completed-work correction loop occurred in validation: my UI exposed only the constraint code, while the browser test expected a meaningful unique-conflict explanation. Inspection showed that S3's receipt already included the useful message. I changed the UI to retain that message, and the duplicate-handle check then passed. Attribution: agent-error, not a backend uniqueness defect.

M1 ends `aborted`, because I stopped before the four-hour cap after establishing an unimplementable mandatory capability. Calling it wall-exhausted capability-failure would misstate the clock. This is treated as a failed prerequisite by the frozen contract.

1789223246 M2 boundary — blocked-by-M1. No posts or follow graph authored, no segment installed, no new bundle or choreography run. Nothing at this step was experienced sufficiently to compare backends.

1789223246 M3 boundary — blocked-by-M1. No messaging authored. Its independence from M2 does not bypass its M1 prerequisite.

1789223246 M4 boundary — blocked-by-M1 transitively through M3. No media-message/reaction/edit implementation attempted.

1789223246 M5 boundary — blocked-by-M1 transitively through M3. No disappearance, view-once, customization, or search implementation attempted.

1789223246 M6 boundary — blocked-by-M1 through its full prerequisite set. No replay adapter, custom-client messaging API, offline-write, or push implementation attempted. Scale execution has no clock because it never started. Native simulator proof is separately unavailable on this Linux host.

1789223246 M8 boundary — blocked-by-M1 via M6. No insights, trending, digest, or multi-device offline implementation attempted. Native simulator proof is separately unavailable on this Linux host. M7 remains explicitly not-run as requested. No additional capability failure was counted for a blocked milestone.
