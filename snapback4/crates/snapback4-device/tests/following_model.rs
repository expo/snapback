//! A seeded Following device/server model, including delayed receipts and sync.
mod common;
use common::{Host, Memory, Sqlite, args, id, snapshot_pages, stream_page};
use snapback4_core::{Context, Value, WriteState};
use serde_json::json;

const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/following-view.q");

fn model<H: Host>(mut host: H) {
    for seed in 1..=12u64 {
        let (mut server, backend) = common::compile(SOURCE);
        let mut device = host.open(&format!("seed-{seed}"), Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut server, "bob", 1000).iter().enumerate() {
            device.apply(page, i == 0).unwrap();
        }
        let mut rng = seed;
        let mut follows = [false; 3];
        let mut posts: Vec<String> = Vec::new();
        let mut reposts = std::collections::BTreeSet::new();
        let mut trace = Vec::new();
        for step in 0..100 {
            rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
            let actor = (rng as usize / 7) % 3;
            let author = ["alice", "carol", "bob"][actor];
            let (op, viewer, input) = match rng % 5 {
                0 | 1 if actor < 2 => {
                    follows[actor] = !follows[actor];
                    (if follows[actor] { "follow" } else { "unfollow" }, "bob", args(&[("actor", id(author))]))
                }
                2 | 3 if !posts.is_empty() => {
                    let post = &posts[(rng as usize / 11) % posts.len()];
                    let op = if reposts.remove(post) { "unrepost" } else { reposts.insert(post.clone()); "repost" };
                    (op, "bob", args(&[("postId", id(post))]))
                }
                _ => {
                    let post = format!("post-{seed}-{step}"); posts.push(post.clone());
                    ("post", author, args(&[("postId", id(&post)), ("parentId", Value::Null)]))
                }
            };
            trace.push(format!("{viewer} {op} {input:?}"));
            let now = 1000 + step;
            let from = server.seq().unwrap();
            let queued = if viewer == "bob" {
                Some(device.admit(serde_json::from_value(json!({
                    "id":format!("write-{seed}-{step}"), "seq":step+1, "op":op,
                    "viewer":viewer, "args":snapback4_core::wire::map_to_json(&input), "now":now, "predictable":true,
                })).unwrap()).unwrap())
            } else { None };
            let mut context = Context::new(viewer, input).at(now);
            if let Some(q) = &queued { context = context.with_ids(q.new_ids.clone()); }
            let out = server.mutate(op, queued.as_ref().map(|q| q.id.as_str()), context).unwrap();
            assert!(matches!(out.state, WriteState::Sent { .. }), "seed {seed} step {step}: {out:?}\n{trace:#?}");
            let committed = server.seq().unwrap();
            if rng & 8 != 0 { while server.run_timeline_chunk(now).unwrap().is_some() {} }
            if rng & 16 != 0 { if let Some(q) = &queued { device.settle(&q.id, Some(committed)).unwrap(); } }
            let page = stream_page(&mut server, "bob", from);
            assert!(!page.more);
            device.apply(&page, false).unwrap();
            if rng & 16 == 0 { if let Some(q) = &queued { device.settle(&q.id, Some(committed)).unwrap(); } }
            // Compare the entire delivered feed, not only its first page. Cursors
            // and timestamps are independently produced on server and device.
            let mut cursor = None;
            loop {
                let online = server.query("cards", Context::new("bob", args(&[("c", cursor.as_ref().map(|c: &String| Value::String(c.clone())).unwrap_or(Value::Null))])).at(now)).unwrap();
                let local = device.query("cards", "bob", &json!({"c":cursor}), now).unwrap();
                assert_eq!(local.data, online.data, "seed {seed} step {step}\n{trace:#?}");
                assert_eq!(local.complete, online.complete, "seed {seed} step {step}");
                assert_eq!(local.next, online.next);
                cursor = online.next;
                if cursor.is_none() { break; }
            }
        }
    }
}

#[test] fn following_model_memory() { model(Memory::new()); }
#[test] fn following_model_sqlite() { model(Sqlite::new("following-model")); }
