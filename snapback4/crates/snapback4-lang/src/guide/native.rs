//! The native card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Native jobs and reads: the app's Rust, hosted as wasm, metered like a job

Native jobs and queries run the application's Rust as metered WebAssembly.
Use them for computations that need floats, vectors or Rust libraries.

```quarry
job rescore(): native                    -- the body is snapback/native/, in Rust
schedule rescoreEvery every 5m: rescore  -- fired like any job
query personalize(first: int): native    -- a read: on the server as the viewer, on a device over its rows
```

`module!` names its jobs and reads; check also verifies every declared read.

```rust
// snapback/native/src/lib.rs
use snapback4_native::{Chunk, Ctx, Next, Order, Result, from_row, json, row_of};
mod schema { include!("../../generated/native.rs"); }
use schema::*;
snapback4_native::module! { jobs: [rescore], reads: [personalize] }

fn rescore(ctx: &Ctx, chunk: &Chunk) -> Result<Next> {
    let page = ctx.scan(tables::POSTS, indexes::posts::BY_ID, &[], Order::Asc, 100, chunk.state.as_ref())?;
    for row in page.rows {
        let post: Posts = from_row(row)?;
        let votes = ctx.maintained(maintains::POST_SCORE, &[json!(post.id)])?;
        let age_hours = (chunk.now - post.at) as f64 / 3_600_000.0;
        let score = (votes as f64 * 10.0 - age_hours.powf(1.5)).round() as i64;
        ctx.upsert_by(tables::RANKED, indexes::ranked::BY_POST, &[json!(post.id)], row_of(&Ranked { id: String::new(), post_id: post.id, score, at: post.at })?)?;
    }
    Ok(match page.next { Some(state) => Next::Again(state), None => Next::Done })
}

fn personalize(ctx: &Ctx, args: &Json) -> Result<Json> {
    let viewer = ctx.viewer()?;
    let page = ctx.scan(tables::RANKED, indexes::ranked::BY_SCORE, &[], Order::Desc, 50, None)?;
    let mut items: Vec<(i64, Json)> = Vec::new();
    for row in page.rows {
        let ranked: Ranked = from_row(row)?;
        let seen = ctx.lookup(tables::SEEN, indexes::seen::BY_READER_POST, &[json!(viewer), json!(ranked.post_id)])?.is_some();
        items.push((ranked.score - if seen { 1000 } else { 0 }, json!({ "postId": ranked.post_id, "seen": seen })));
    }
    items.sort_by_key(|(weight, _)| -*weight);
    Ok(Json::Array(items.into_iter().map(|(_, item)| item).collect()))
}
```

**A native read is the twin** (LLP 3000.005 §9): `query name(args):
native` runs the same Rust on the server as the viewer — every `Ctx` read
under the viewer's rules and the read meter, `complete` from the meter —
and on a native device (the Expo module, Exact2's hosts, the `snapback4
device` process) over the rows it holds, with the device's words (a page at
the horizon is `complete: false`); the same rows give the same answer,
floats included (`wasmi` is built deterministic). The client fetches the
module from `/native.wasm` once per digest (`/schema` names it) and
installs it on the device, which keeps it, so a cold start offline answers
native reads too. The web device carries no wasm host (with one its wasm
doubled, to 648 KB gzip) and says so; the client then asks the server, as
it does for a device without the module. A native read cannot write,
returns no cursor (page by your own arguments) and returns the value model
(ints, not floats: round a score); `api.ts` types its result `unknown`. A
mutation cannot be native: a device predicts Quarry and the server replays
it.

One chunk per call, one transaction per chunk, under the job ceilings
(guide bounds): the job returns `Next::Again(state)` to be called again with
that state after the chunk commits — a scan's `next` is the natural state,
so a crash resumes at the next page as a Quarry `for` sweep resumes by its
cursor — or `Next::Done`. Every `Ctx` read and write is the interpreter's
own on the chunk's transaction (`get`, `lookup`, `maintained`, `scan`,
`mint`, `insert`, `insert_if_absent`, `update`, `upsert`, `upsert_by`,
`delete`): rules pass for the system, validation, constraints, maintains
and partition events apply, the meter counts, and so the ordinary query and
`sync` serve what the job wrote. The first refusal — a bound, a constraint,
a bad value — parks the job with it (`snapback4 doctor` lists runs); a panic
parks it as E_NATIVE_TRAP with the panic's text; 2,000,000,000 units of
fuel per chunk (about 90,000 per host call) is the step ceiling, so the row
ceilings bind first. Native reads get 200,000,000 fuel units. Each instance
bounds its memory and table within the existing heap allowance; bridge buffers,
answers and logs also have byte bounds. A queued native job binds the exact wasm
bytes: changing or removing the module parks it with E_JOB_GENERATION before
another chunk can use its saved state. Legacy native runs without that binding
also park; already committed chunks remain committed. Identical bytes resume.
For a trap, fix the module and run `snapback4 check`; inspect the committed
chunks before queueing a replacement job. The failed chunk rolled back.
The module imports one host function and nothing else: no clock, no randomness,
no network — `chunk.now` is the host's — so a native job runs under the simulator
like any job. Quarry still declares
the table, its rules and its `sync`; a mutation cannot be native,
because a device predicts Quarry and the server replays it. Anything
that needs the network stays outside and writes into a table the job
reads. A query, not a mutation, can be native too (LLP 3000.005 §9).

## Operations

`snapback/native/` is a Cargo package the app owns — `crate-type =
["cdylib"]`, its own `[workspace]`, a dependency on `snapback4-native` —
and `snapback4 check` writes `snapback/generated/native.rs` (a constant
per table, index and aggregate view; a `serde` struct per table), builds the
package for `wasm32-unknown-unknown` into `snapback/generated/native.wasm`
(cold about ten seconds, then a cargo no-op), and refuses if a declared
job is not one the module implements. `dev` rebuilds on every save under
`snapback/`; `deploy` ships the module with the release; `run <job>` runs
it here; `doctor` says whether the module and the toolchain are in place.

## Refusals

E_NATIVE means a native declaration or loaded module cannot perform the
requested operation. For example, `mutation rescore(): native` is invalid:
use `job rescore(): native` for chunked writes or `query rescore(): native`
for a read that never writes. Declare the matching function in the app's
`module!` registry and provide `snapback/native/Cargo.toml`. Run
`snapback4 check` to build and validate the module; the message lists missing
exports or load failures. A native query cannot call a write host function.

E_NATIVE_TOOLCHAIN means the native build cannot find Cargo or the
`wasm32-unknown-unknown` target. For example, a Rust install with only the
host target cannot build `snapback/native/`. Put Cargo on PATH and run
`rustup target add wasm32-unknown-unknown`, then `snapback4 check` from the
app. This builds the application's native module, not JavaScript in the
data plane.

E_NATIVE_BUILD means the native crate could not be built or its generated
files could not be written or loaded.
For example, a Rust field access left behind after a Quarry column rename
no longer matches `snapback/generated/native.rs`. Fix the Rust source using
the generated names and rerun `snapback4 check`. The diagnostic includes
the compiler's output tail; run its printed Cargo command by hand to see
the full error. If no wasm was produced, declare `crate-type = ["cdylib"]`;
if the message names a filesystem failure, repair that path's permissions.
Do not edit the generated schema to hide the mismatch."##;
