// @ref LLP 3000#publication-suite-under-contention — preserve semantics independently of host scheduling.
const WARMUPS: usize = 3;
const SAMPLES: usize = 20;
const RATIO_LIMIT: f64 = 3.0;
use super::*;

// The fixture uses an in-memory engine on this thread. Charge engine CPU,
// excluding descheduling by unrelated builds; still record wall latency. Paired
// controls rotate order so frequency/cache changes affect both populations.
fn cpu_time() -> std::time::Duration {
    let mut value = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    assert_eq!(unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut value) }, 0);
    std::time::Duration::new(value.tv_sec as u64, value.tv_nsec as u32)
}
pub fn reads(e: &mut Engine, m: &Model) {
    let readers = ["u0005", "u0500", "u0901"];
    let mut cpu = BTreeMap::<_, Vec<f64>>::new();
    let mut wall = BTreeMap::<_, Vec<f64>>::new();
    let mut last = BTreeMap::new();
    let mut warmups = BTreeMap::<_, usize>::new();
    for n in 0..WARMUPS + SAMPLES {
        for offset in 0..readers.len() {
            let who = readers[(n + offset) % readers.len()];
            let start = Instant::now();
            let charged = cpu_time();
            let out = e.query("following", ctx(who, &[], m.now)).unwrap();
            let used = (cpu_time() - charged).as_secs_f64() * 1000.0;
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            if n >= WARMUPS {
                cpu.entry(who).or_default().push(used);
                wall.entry(who).or_default().push(elapsed);
            } else {
                *warmups.entry(who).or_default() += 1;
            }
            assert!(out.complete);
            last.insert(who, out);
        }
    }
    let mut p95s = BTreeMap::new();
    for who in readers {
        assert_eq!(warmups[who], WARMUPS);
        let charged = p95(cpu.get_mut(who).unwrap());
        let elapsed = p95(wall.get_mut(who).unwrap());
        p95s.insert(who, charged);
        let out = &last[who];
        let recipe_examined = if who == "u0901" { 85 } else { 42 };
        assert!(out.metered.examined <= 3 * recipe_examined, "Following examinations exceed recipe envelope");
        println!("CLIQUE_READ {}", json!({"reader":who,"p95_ms":elapsed,"cpu_p95_ms":charged,
            "samples":cpu[who].len(),"warmups":warmups[who],"metered":out.metered,"returned":out.data.as_array().unwrap().len()}));
    }
    let dense = p95s["u0500"] / p95s["u0005"];
    let celebrity = p95s["u0901"] / p95s["u0005"];
    assert!(dense <= RATIO_LIMIT && celebrity <= RATIO_LIMIT, "reader CPU ratios: {dense}, {celebrity}");
    println!("CLIQUE_RATIOS {}", json!({"clock":"thread-cpu", "dense_sparse":dense,"celebrity_sparse":celebrity,"limit":RATIO_LIMIT}));
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
    let authors = [ordinary.as_str(), "u0900"];
    let mut cpu = BTreeMap::<_, Vec<f64>>::new();
    let mut wall = BTreeMap::<_, Vec<f64>>::new();
    let mut warmups = BTreeMap::<_, usize>::new();
    for n in 0..WARMUPS + SAMPLES {
        for offset in 0..authors.len() {
            let who = authors[(n + offset) % authors.len()];
            m.now += 1;
            let key = format!("write-sample-{who}-{n:02}");
            let body = "post acknowledgement sample";
            let start = Instant::now();
            let charged = cpu_time();
            sent(e, "post", who, &[("body", text(body))], m.now, &key);
            let used = (cpu_time() - charged).as_secs_f64() * 1000.0;
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            if n >= WARMUPS {
                cpu.entry(who).or_default().push(used);
                wall.entry(who).or_default().push(elapsed);
            } else {
                *warmups.entry(who).or_default() += 1;
            }
            m.posts.insert(key.clone(), model::Post { author: who.to_owned(), at: m.now, body: body.into() });
            m.event(&key, &key, who, m.now, false);
        }
    }
    let mut values = BTreeMap::new();
    for who in authors {
        assert_eq!(warmups[who], WARMUPS);
        let charged = p95(cpu.get_mut(who).unwrap());
        let elapsed = p95(wall.get_mut(who).unwrap());
        values.insert(who.to_owned(), charged);
        println!("CLIQUE_WRITE {}", json!({"author":who,"followers":followers(who),
            "samples":cpu[who].len(),"warmups":warmups[who],"ack_p95_ms":elapsed,"cpu_p95_ms":charged}));
    }
    let ratio = values["u0900"] / values[&ordinary];
    assert!(
        ratio <= RATIO_LIMIT,
        "celebrity write CPU ratio {ratio} exceeds {RATIO_LIMIT}"
    );
    println!(
        "CLIQUE_WRITE_RATIO {}",
        json!({"clock":"thread-cpu","celebrity_ordinary":ratio,"limit":RATIO_LIMIT,
        "celebrity_followers":celebrity_followers,"ordinary_followers":ordinary_followers})
    );
}
