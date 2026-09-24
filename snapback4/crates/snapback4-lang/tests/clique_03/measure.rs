const WARMUPS: usize = 3;
const SAMPLES: usize = 20;
const RATIO_LIMIT: f64 = 3.0;
use super::*;
pub fn reads(e: &mut Engine, m: &Model) {
    let mut p95s = BTreeMap::new();
    for who in ["u0005", "u0500", "u0901"] {
        let mut times = Vec::new();
        let mut warmups = 0;
        let mut last = None;
        for n in 0..WARMUPS + SAMPLES {
            let start = Instant::now();
            let out = e.query("following", ctx(who, &[], m.now)).unwrap();
            if n >= WARMUPS {
                times.push(start.elapsed().as_secs_f64() * 1000.0);
            } else {
                warmups += 1;
            }
            assert!(out.complete);
            last = Some(out);
        }
        assert_eq!(warmups, WARMUPS);
        times.sort_by(f64::total_cmp);
        p95s.insert(who, p95(&mut times));
        let out = last.unwrap();
        let recipe_examined = if who == "u0901" { 85 } else { 42 };
        assert!(
            out.metered.examined <= 3 * recipe_examined,
            "Following examinations exceed recipe envelope"
        );
        println!(
            "CLIQUE_READ {}",
            json!({"reader":who,"p95_ms":p95(&mut times),"samples":times.len(),"warmups":warmups,"metered":out.metered,"returned":out.data.as_array().unwrap().len()})
        );
    }
    let dense = p95s["u0500"] / p95s["u0005"];
    let celebrity = p95s["u0901"] / p95s["u0005"];
    assert!(
        dense <= RATIO_LIMIT && celebrity <= RATIO_LIMIT,
        "reader ratios: {dense}, {celebrity}"
    );
    println!(
        "CLIQUE_RATIOS {}",
        json!({"dense_sparse":dense,"celebrity_sparse":celebrity,"limit":RATIO_LIMIT})
    );
    let pages: i64 = e
        .store()
        .conn()
        .query_row("PRAGMA page_count", [], |r| r.get(0))
        .unwrap();
    let size: i64 = e
        .store()
        .conn()
        .query_row("PRAGMA page_size", [], |r| r.get(0))
        .unwrap();
    let rows: i64 = e
        .store()
        .conn()
        .query_row("SELECT count(*) FROM r", [], |r| r.get(0))
        .unwrap();
    println!(
        "CLIQUE_STORE {}",
        json!({"sqlite_bytes":pages*size,"physical_rows":rows,"includes":"rows, indexes, partition log, commits, recorded attribution"})
    );
}
pub fn amplification() {
    let separate = APP
        .replace("  likeCount: count likes by postId\n", "")
        .replace("  by byHourLikes: hour(at), likeCount, at, id\n", "");
    let separate = without(&separate, "query trending(")
        + "\nmaintain likeTotals: count likes by postId\n  read <- allow\n";
    for width in [500, 4000] {
        let mut sizes = BTreeMap::new();
        for (label, source) in [("parent", APP), ("separate", separate.as_str())] {
            let mut e = engine(source);
            for who in ["alice", "bob"] {
                sent(
                    &mut e,
                    "register",
                    who,
                    &[("name", text(who))],
                    1,
                    &format!("profile-{who}"),
                );
            }
            sent(
                &mut e,
                "post",
                "alice",
                &[("body", text(&"x".repeat(width)))],
                2,
                "post-0001",
            );
            let from = e.seq().unwrap();
            sent(
                &mut e,
                "like",
                "bob",
                &[("postId", id("post-0001"))],
                3,
                "like-0001",
            );
            let encoded = transport::stream(&mut e, "alice", from, 4);
            let wire: serde_json::Value = serde_json::from_slice(&encoded).unwrap();
            let events = wire["events"].as_array().unwrap();
            assert!(events.iter().all(|r| r["seq"].is_u64()));
            assert!(wire["acknowledged"].is_object() && wire["store_id"].is_string());
            assert_eq!(events.len(), 3);
            let target = if label == "parent" {
                "posts"
            } else {
                "likeTotals"
            };
            let changed = events
                .iter()
                .filter(|r| r["table"] == target)
                .collect::<Vec<_>>();
            assert_eq!(changed.len(), 1);
            assert!(
                events
                    .iter()
                    .all(|r| !r["table"].as_str().unwrap().starts_with("feed")),
                "a mirror must not republish a timeline event"
            );
            sizes.insert(label, encoded.len());
            println!(
                "CLIQUE_AMPLIFICATION {}",
                json!({"mode":label,"body_bytes":width,"stream_wire_bytes":encoded.len(),"aggregate_event_bytes":serde_json::to_vec(changed[0]).unwrap().len(),"events":events.len()})
            );
        }
        let ratio = sizes["parent"] as f64 / sizes["separate"] as f64;
        assert!(ratio.is_finite() && ratio > 1.0);
        println!(
            "CLIQUE_AMPLIFICATION_RATIO {}",
            json!({"body_bytes":width,"parent_separate":ratio})
        );
    }
}

fn p95(samples: &mut [f64]) -> f64 {
    assert_eq!(samples.len(), SAMPLES);
    samples.sort_by(f64::total_cmp);
    samples[(samples.len() * 95).div_ceil(100) - 1]
}

pub fn writes(e: &mut Engine, m: &mut Model, full: bool) {
    let edges = m.check_edges(e.store());
    let followers = |author: &str| edges.iter().filter(|(_, a)| a == author).count();
    let ordinary = m
        .profiles
        .iter()
        .find(|a| followers(a) == 5)
        .expect("ordinary five-follower author")
        .clone();
    let celebrity_followers = followers("u0900");
    if full {
        assert_eq!(celebrity_followers, 900);
    } else {
        assert_eq!(celebrity_followers, 62);
    }
    let ordinary_followers = followers(&ordinary);
    assert_eq!(ordinary_followers, 5);
    println!(
        "CLIQUE_FOLLOWERS {}",
        json!({"stored_edges":edges.len(),"model_edges":m.edges.len(),"edges_equal":edges==m.edges,
        "celebrity_followers":celebrity_followers,"ordinary":ordinary,"ordinary_followers":ordinary_followers})
    );
    let mut values = BTreeMap::new();
    for who in [&ordinary, &"u0900".to_owned()] {
        let mut samples = Vec::new();
        let mut warmups = 0;
        for n in 0..WARMUPS + SAMPLES {
            m.now += 1;
            let key = format!("write-sample-{who}-{n:02}");
            let body = "post acknowledgement sample";
            let start = Instant::now();
            sent(e, "post", who, &[("body", text(body))], m.now, &key);
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            if n >= WARMUPS {
                samples.push(elapsed);
            } else {
                warmups += 1;
            }
            m.posts.insert(
                key.clone(),
                model::Post {
                    author: who.clone(),
                    at: m.now,
                    body: body.into(),
                },
            );
            m.event(&key, &key, who, m.now, false);
        }
        assert_eq!(warmups, WARMUPS);
        let latency = p95(&mut samples);
        values.insert(who.clone(), latency);
        println!(
            "CLIQUE_WRITE {}",
            json!({"author":who,"followers":followers(who),
            "samples":samples.len(),"warmups":warmups,"ack_p95_ms":latency})
        );
    }
    let ratio = values["u0900"] / values[&ordinary];
    assert!(
        ratio <= RATIO_LIMIT,
        "celebrity write ratio {ratio} exceeds {RATIO_LIMIT}"
    );
    println!(
        "CLIQUE_WRITE_RATIO {}",
        json!({"celebrity_ordinary":ratio,"limit":RATIO_LIMIT,
        "celebrity_followers":celebrity_followers,"ordinary_followers":ordinary_followers})
    );
}
