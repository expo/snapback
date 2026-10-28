# Crate-touching commits reach main without the source-scan tests

Status: Open
Date: 2026-10-28
Scope: landing practice for `snapback4/crates/**` changes made directly on main; source-scan and census test targets.

`4199a38cd3` ("stop synchronous owners after terminal G6 admission loss", landed
directly on main after Integration 28's final evidence) added
`pub fn admission_watch(&self) -> impl Fn() -> bool + Send + Sync + use<>`.
`snapback4::store_handle_census` lexes core and CLI source. Its `bindings()`
read the `use` of the precise-capturing bound as a use declaration and looped
forever, with unbounded memory. In the 0.4.44 Linux publication suite the target
grew to the unit's 80 GB cap and was OOM-killed after 1,382 s; alone it reached
25 GB in 28 s. It had taken 0.5 s before. `87fb2ecef4` fixed the census
tokenizer. Had that hang reached the M5, which has no memory cap, it could have
taken the shared laptop down.

The census, guide/diagnostics registries, inventory and other source-scan
targets are cheap (seconds). A commit that touches `snapback4/crates/**` should
run them before landing, even when its own affected selection is a single
crate. Ideally `affected.mjs` always selects the source-scan targets for crate
changes, and they run with a wall-clock and memory cap so a hang fails fast.
