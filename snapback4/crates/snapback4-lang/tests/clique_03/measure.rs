use super::*;
pub fn reads(e: &mut Engine, m: &Model) {
    let mut p95s = BTreeMap::new();
    for who in ["u0005", "u0500", "u0901"] {
        let mut times = Vec::new();
        let mut last = None;
        for n in 0..23 {
            let start = Instant::now();
            let out = e.query("following", ctx(who, &[], m.now)).unwrap();
            if n >= 3 {
                times.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            assert!(out.complete);
            last = Some(out);
        }
        times.sort_by(f64::total_cmp);
        p95s.insert(who, times[18]);
        let out = last.unwrap();
        let recipe_examined = if who == "u0901" { 85 } else { 42 };
        assert!(
            out.metered.examined <= 3 * recipe_examined,
            "Following examinations exceed recipe envelope"
        );
        println!(
            "CLIQUE_READ {}",
            json!({"reader":who,"p95_ms":times[18],"samples":20,"warmups":3,"metered":out.metered,"returned":out.data.as_array().unwrap().len()})
        );
    }
    println!(
        "CLIQUE_RATIOS {}",
        json!({"dense_sparse":p95s["u0500"]/p95s["u0005"],"celebrity_sparse":p95s["u0901"]/p95s["u0005"],"limit":3.0})
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
            let p = e.stream_at("alice", from, 1000, 4).unwrap();
            let events:Vec<_>=p.events.iter().map(|r|json!({"table":r.table,"kind":r.kind,"id":r.id,"data":r.data.as_ref().map(snapback4_core::wire::to_json)})).collect();
            let wire = json!({"snapshot":false,"requested_watermark":from,"images_at":p.images_at,"joined":p.joined,"acquisitions":p.acquisitions,"events":events,"watermark":p.watermark,"more":p.more,"generation":e.generation()});
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
            println!(
                "CLIQUE_AMPLIFICATION {}",
                json!({"mode":label,"body_bytes":width,"stream_wire_bytes":serde_json::to_vec(&wire).unwrap().len(),"aggregate_event_bytes":serde_json::to_vec(changed[0]).unwrap().len(),"events":events.len()})
            );
        }
    }
}
