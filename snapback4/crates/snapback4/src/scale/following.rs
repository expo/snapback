//! An additional protocol certificate; the inbox query certificate is unchanged.
// @ref LLP 3000.026#9-exact-on-demand-history-design-handoff — claim the tested
// server protocol, including its frozen domain, omissions and stalled exception.
use serde::Serialize;
use snapback4_core::{
    Ceilings, engine::following_history::projection, ir::Program, schema::Schema,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct History {
    operation: String,
    declaration: String,
    page_size: usize,
    execution: &'static str,
    guarantee: &'static str,
    cost: &'static str,
    limits: Ceilings,
}
const GUARANTEE: &str = "each page is a correct prefix of the frozen viewer/edge/birth domain; bounded requests continue to completion once post-bound backdated births and follow additions stop obstructing unscanned keys; obstruction checkpoints as stalled, never false exhaustion; oversized cards are named omissions; expiry or authority loss may restart";
const COST: &str = "discovery O(D+F); retained pages O(F/64 + (N+X) log F), plus index seeks and authorized card shaping; no unrelated-author row scan; no follow cap, metered frontier byte quota";
pub(crate) fn certificate(schema: &Schema, program: &Program) -> Option<History> {
    let binding = projection::plan(schema, program)?.binding;
    Some(History {
        operation: program.name.clone(),
        declaration: binding.declaration,
        page_size: binding.page_size,
        execution: "server via useFollowing; offline inbox unchanged",
        guarantee: GUARANTEE,
        cost: COST,
        limits: Ceilings::default(),
    })
}
pub(crate) fn line(schema: &Schema, program: &Program) -> Option<String> {
    certificate(schema,program).map(|_|format!("Following history (useFollowing, server): {GUARANTEE}; {COST}; each request <=8192 examined, 16384 index entries, 8192 probes, 1000000 steps, 16 MiB heap, 1 MiB output, 1024 frontier/lifecycle writes"))
}
