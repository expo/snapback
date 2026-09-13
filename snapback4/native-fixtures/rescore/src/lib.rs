//! Interview's rescore as a native job (LLP 3000.004 §5 in Rust), its
//! personalizer as a native read — the same Rust on the server and on a
//! device (LLP 3000.005 §9) — and jobs that misbehave on purpose:
//! `overflow` writes past the chunk's ceiling, `clash` breaks a unique key,
//! `boom` panics. The engine parks each with the reason.

use snapback4_native::{Chunk, Ctx, Json, Next, Order, Result, from_row, json, row_of};

mod schema {
    include!("schema.rs"); // written by the test from `snapback4_lang::emit::rust`
}
use schema::*;

snapback4_native::module! { jobs: [rescore, overflow, clash, boom], reads: [personalize] }

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

/// The viewer's feed: the shared `ranked` page, lifted by the viewer's
/// `affinity`, sunk when `seen`, with the viewer's own vote beside each
/// row. A read, not a job: it runs on the server as the viewer and on a
/// device over the rows it holds, and answers the same either way.
fn personalize(ctx: &Ctx, args: &Json) -> Result<Json> {
    let viewer = ctx.viewer()?;
    let first = args.get("first").and_then(Json::as_u64).unwrap_or(50).clamp(1, 500) as u32;
    let page = ctx.scan(tables::RANKED, indexes::ranked::BY_SCORE, &[], Order::Desc, first, None)?;
    let mut items = Vec::new();
    for row in page.rows {
        let ranked: Ranked = from_row(row)?;
        let seen = ctx.lookup(tables::SEEN, indexes::seen::BY_READER_POST, &[json!(viewer), json!(ranked.post_id)])?.is_some();
        let affinity = ctx.lookup(tables::AFFINITY, indexes::affinity::BY_READER_POST, &[json!(viewer), json!(ranked.post_id)])?.and_then(|row| row.get("score").and_then(Json::as_i64)).unwrap_or(0);
        let mine = ctx.lookup(tables::VOTES, indexes::votes::BY_POST_PRINCIPAL, &[json!(ranked.post_id), json!(viewer)])?.and_then(|row| row.get("direction").and_then(Json::as_i64));
        let weight = ranked.score as f64 + affinity as f64 * 5.0 - if seen { 1000.0 } else { 0.0 };
        items.push((weight, json!({ "postId": ranked.post_id, "score": ranked.score, "seen": seen, "affinity": affinity, "mine": mine, "weight": weight.round() as i64 })));
    }
    items.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    Ok(Json::Array(items.into_iter().map(|(_, item)| item).collect()))
}

