//! A native job which records the operation clock in a timed row.

use snapback4_native::{Chunk, Ctx, Next, Result, json};

snapback4_native::module! { jobs: [publishTimed] }

#[allow(non_snake_case)]
fn publishTimed(ctx: &Ctx, chunk: &Chunk) -> Result<Next> {
    let mut row = json!({
        "kind": "native",
        "opensAt": 150,
        "observedAt": chunk.now,
    })
    .as_object()
    .cloned()
    .expect("a row");
    row.insert("id".into(), json!(ctx.mint()?));
    ctx.insert("releases", row)?;
    Ok(Next::Done)
}
