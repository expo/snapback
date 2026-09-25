//! Real host reads with no Quarry body: dependencies must come from execution.
use snapback4_native::{Ctx, Json, Order, Result, json};

snapback4_native::module! { reads: [native_cards, native_held, native_large] }

fn native_cards(ctx: &Ctx, args: &Json) -> Result<Json> {
    let viewer = ctx.viewer()?;
    let page = ctx.scan("feedFeed", "byReaderPage", &[json!(viewer)], Order::Desc, 20, None)?;
    let original = ctx.get("posts", args["postId"].as_str().unwrap_or("old"))?;
    Ok(json!({ "rows": page.rows, "original": original, "cursor": args["c"] }))
}

fn native_held(ctx: &Ctx, args: &Json) -> Result<Json> {
    native_cards(ctx, args)
}

fn native_large(ctx: &Ctx, args: &Json) -> Result<Json> {
    let mut answer = native_cards(ctx, args)?;
    // Under the raw guest bridge limit, over the engine's canonical tagged
    // output limit. Both limits stay unchanged for a published result.
    answer["padding"] = json!(vec!["x".repeat(500); 2048]);
    Ok(answer)
}
