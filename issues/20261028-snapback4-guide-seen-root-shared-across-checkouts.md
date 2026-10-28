# Guide reading history roots at any ancestor with a snapback/ directory

Status: Open
Date: 2026-10-28
Scope: `crates/snapback4/src/guide_seen.rs` (TOK1 bounded builder reading); developer machines and publication hosts.

`guide_seen::render` stores hashes of already-printed guide blocks in
`<root>/.snapback4/guide-seen.json`, where `root` is the nearest ancestor of the
current directory that holds a `snapback/` directory or a package.json that
depends on snapback4. A directory that merely contains a checkout or clone named
`snapback` therefore becomes a guide project root for every unrelated checkout
beneath it.

On the black M5, `~/projects/snapback` (the main clone) makes `~/projects` that
root for every worktree under `~/projects`. The publication worktree, other
agents' lanes and earlier dry runs all share `~/projects/.snapback4/guide-seen.json`
(147 KB on 2026-10-28). The next `snapback4 guide totals` there prints
"already shown: totals, 6 blocks; new: 0 blocks" instead of the section. 0.4.44
Mac dry run 6 failed `wave12-surface.test.mjs` test 2 for exactly this reason. It
reproduced 2/2 alone in the old worktree and passed 3/3 from a worktree outside
`~/projects`. Linux hosts have no such ancestor, so every Linux suite passed.
Main has since made that test pass `--repeat`, but any guide-reading test without
`--repeat`, and any builder who runs `guide` from a directory beside a `snapback`
clone, sees shortened output that depends on unrelated history.

Possible fixes, for whoever owns TOK1: root the history only at an actual app
project (for example a `snapback/schema.q` or a `snapback/` directory beside a
package.json, not any directory named `snapback`); key the history by the
resolved project root plus schema identity; or skip history outside a
recognized app. The publication suite should not depend on host directory
layout.
