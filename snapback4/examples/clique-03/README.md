# Clique 0.3 integration

A 134-line Quarry backend combines declared Following, maintained-column
Trending, received-like/reply totals, post-day totals and cursor-paged threads.
Six application tables are its only authored storage. The engine owns the
timeline, attribution and count maintenance.

From `snapback4/`, use Node 24 and the local Rust toolchain:

```sh
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$PATH
cargo build -p snapback4
(cd examples/clique-03 && ../../target/debug/snapback4 check --json)
node --test examples/clique-03/census.test.mjs
SNAPBACK4_CLIQUE_BACKEND=/tmp/clique-backend.json cargo test -p snapback4-lang --test clique_03 -- --nocapture --test-threads=1
SNAPBACK4_CLIQUE_BACKEND=/tmp/clique-backend.json node --test examples/clique-03/fence.test.mjs
```

The crate test defaults to a reduced, deterministic projection of the committed
`benchmarks/fixtures/social-messenger/` pack, version `0.2.2-m8`. It keeps the
starter users, scale users 1–62 and the three named scale probes (500, 900,
901), matching follow edges, five posts per scale author, and actions whose
parents survive. This still crosses the 51-follower promotion threshold.

The full fixture is explicit:

```sh
SNAPBACK4_CLIQUE_FULL=1 SNAPBACK4_CLIQUE_BACKEND=/tmp/clique-backend.json cargo test -p snapback4-lang --test clique_03 application_fixture -- --exact --nocapture --test-threads=1
```

On the shared integration machine, sample `uptime` before that command: wait
for the one-minute load to be below 12, but start after at most 30 minutes of
waiting. Record the waiting samples and starting/ending load. Run serially.

Both modes replay social actions through real operations, with one synthetic
arrival-clock second per log action. IDs come from the fixture; repost events
use distinct caller-supplied event IDs. Messaging, media and profile-edit
features are outside this app's scope. Registration uses the fixture principal
as its display name. The full mode checks the pack's 1,008 authors, 5,921 edges,
48,224 posts, 5,008 likes, 2,004 replies and 1,004 reposts before adding targeted
ranking/cursor/lifecycle cases.

The independent model checks every Following and Trending cursor page, all
profiles' received totals and post-day counts, and threads with 45 deliberately
reversed, equal-time reply IDs. The app begins without `likeCount` and reply
attribution, activates both over its populated store, and has a native device
adopt and reacquire. Offline writes survive two native process lifetimes;
posting predicts, follow/unfollow queue, and settlement matches the server.
The separate fence test verifies the actual npm 0.2.33 artifacts by integrity
and checks that both its native and WASM devices refuse this app before
prediction. It uses the existing published-artifact cache, downloading if needed.

The tests print JSON measurements prefixed `CLIQUE_`. See the
[integration report](../../reports/20260923-integration.md) for results,
measurement boundaries and the original blocker resolved by `dced7a791`.
