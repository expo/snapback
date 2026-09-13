//! Interview's rescore as a native job (LLP 3000.004 §5 in Rust), and two
//! jobs that misbehave on purpose: `overflow` writes past the chunk's
//! ceiling, `boom` panics. The engine parks each with the reason.

use snapback4_native::{Chunk, Ctx, Next, Order, Result, from_row, json, row_of};

mod schema {
    include!("schema.rs"); // written by the test from `snapback4_lang::emit::rust`
}
use schema::*;

snapback4_native::jobs! { rescore, overflow, clash, boom }

/// One shared `ranked` row per post: votes and comments up, age down, with
/// a float exponent Quarry does not have. A page of 100 posts per chunk;
/// the page's `next` is the chunk's state.
fn rescore(ctx: &Ctx, chunk: &Chunk) -> Result<Next> {
    let page = ctx.scan(tables::POSTS, indexes::posts::BY_ID, &[], Order::Asc, 100, chunk.state.as_ref())?;
    for row in page.rows {
        let post: Posts = from_row(row)?;
        let votes = ctx.maintained(maintains::POST_SCORE, &[json!(post.id)])?;
        let comments = ctx.maintained(maintains::COMMENT_COUNT, &[json!(post.id)])?;
        let age_hours = (chunk.now - post.at).max(0) as f64 / 3_600_000.0;
        let score = (votes as f64 * 10.0 + comments as f64 * 2.0 - age_hours.powf(1.5)).round() as i64;
        ctx.upsert_by(tables::RANKED, indexes::ranked::BY_POST, &[json!(post.id)], row_of(&Ranked { id: String::new(), post_id: post.id.clone(), score, at: post.at })?)?;
    }
    Ok(match page.next {
        Some(state) => Next::Again(state),
        None => Next::Done,
    })
}

/// More rows than a chunk may write: the meter refuses the write past the
/// ceiling and the job parks with `E_BOUND`.
fn overflow(ctx: &Ctx, chunk: &Chunk) -> Result<Next> {
    for n in 0..9_000 {
        ctx.insert(tables::COMMENTS, row_of(&Comments { id: String::new(), post_id: "p".into(), author_id: "dev:alice".into(), body: format!("comment {n}"), at: chunk.now })?)?;
    }
    Ok(Next::Done)
}

/// Two rows under one unique key: the second insert is refused by the
/// constraint, the refusal sticks, the chunk rolls back, the job parks.
fn clash(ctx: &Ctx, chunk: &Chunk) -> Result<Next> {
    for _ in 0..2 {
        ctx.insert(tables::RANKED, row_of(&Ranked { id: String::new(), post_id: "p".into(), score: 1, at: chunk.now })?)?;
    }
    Ok(Next::Done)
}

/// A panic: the hook sends its text to the host, the abort traps, the job
/// parks with `E_NATIVE_TRAP` and the text.
fn boom(_ctx: &Ctx, _chunk: &Chunk) -> Result<Next> {
    panic!("the fixture's boom job panics on purpose")
}
