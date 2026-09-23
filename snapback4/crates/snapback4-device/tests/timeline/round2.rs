use super::*;
use snapback4_core::{RuntimeError, schema::{LeavePolicy, timeline::owned_id}};

// The snapshot/leave injections model persisted coverage states, not an
// expansion of the timeline's admitted authoring shape.
fn absent<H: Host>(mut h: H, table: &str) where H::Store: Images {
    for replay in [false, true] {
        let (mut e, mut b) = server();
        b.schema.tables.get_mut(table).unwrap().leave = LeavePolicy::DeliveredHistory;
        let name = format!("{table}-{replay}");
        let mut d = h.open(&name, Some(b)).unwrap();
        let mut pages = snapshot_pages(&mut e, "alice", 1000);
        if table != "feedAuthors" || !replay {
            for page in &mut pages { page.events.retain(|ev| ev.table != table); }
        }
        for (i, page) in pages.iter().enumerate() { d.apply(page, i == 0).unwrap(); }
        let mut baseline = rows(&mut d);
        let args = json!({"postId":"absent-input"});
        let pending = if replay {
            let q = admit(&mut d, "publish", "alice", args.clone(), 1);
            assert!(q.predictable && q.predicted.len() == 3, "held control: {q:?}");
            Some(q)
        } else {
            // Absence is decisive while held, for both points and empty scans.
            match d.predict("publish", "alice", &args, 11, vec![], 1) {
                Err(RuntimeError::Require { code, .. }) if table == "feedAuthors" => assert_eq!(code, "FEED_AUTHOR_NOT_FOUND"),
                Ok(prediction) if table != "feedAuthors" => {
                    assert_eq!(prediction.predicted.len(), 3);
                    d.withdraw(&prediction.predicted).unwrap();
                }
                other => panic!("held control {table}: {other:?}"),
            }
            assert_eq!(rows(&mut d), baseline);
            None
        };
        let mut events = Vec::new();
        // Replay must also handle a previously present mode becoming absent.
        if table == "feedAuthors" && replay {
            for row in baseline.get_mut(table).unwrap().drain(..) {
                events.push(json!({"table":table,"kind":"del","id":row.field("id").unwrap().as_str().unwrap()}));
            }
        }
        events.push(json!({"table":table,"kind":"scope","id":"scope","data":[]}));
        let left = serde_json::from_value(json!({"snapshot":false,"events":events,"watermark":e.seq().unwrap()+1,"more":false})).unwrap();
        d.apply(&left, false).unwrap();
        assert!(d.store().images(table).is_empty(), "the retained lookup really misses");
        let error = d.predict("publish", "alice", &args, 11, vec![], 1).unwrap_err();
        let (index, key) = match table {
            "feedAuthors" => ("byPrincipal", "[\"alice\"]"),
            "feedRemovedEvents" => ("byEvent", "[\"absent-input\"]"),
            "follows" => ("byFollowed", "[\"alice\"]"),
            _ => unreachable!(),
        };
        assert!(matches!(error, RuntimeError::Prediction(ref reason)
            if reason.contains(table) && reason.contains(index) && reason.contains(key)), "{error:?}");
        let q = pending.unwrap_or_else(|| admit(&mut d, "publish", "alice", args, 1));
        let kept = d.queued().unwrap().into_iter().find(|item| item.id == q.id).unwrap();
        round1::queued_only(&mut d, &kept, &baseline);
        assert_eq!((&kept.id, &kept.args, &kept.new_ids), (&q.id, &q.args, &q.new_ids));
        h.close(&name, d);
        let mut d = h.open(&name, None).unwrap();
        round1::queued_only(&mut d, &kept, &baseline);
    }
}
#[test] fn absent_tombstone_memory() { absent(Memory::new(), "feedRemovedEvents"); }
#[test] fn absent_tombstone_sqlite() { absent(Sqlite::new("absent-tombstone"), "feedRemovedEvents"); }
#[test] fn absent_author_memory() { absent(Memory::new(), "feedAuthors"); }
#[test] fn absent_author_sqlite() { absent(Sqlite::new("absent-author"), "feedAuthors"); }
#[test] fn absent_follow_memory() { absent(Memory::new(), "follows"); }
#[test] fn absent_follow_sqlite() { absent(Sqlite::new("absent-follow"), "follows"); }

fn point_and_scan<H: Host>(mut h: H) where H::Store: Images {
    let (mut e, mut b) = server();
    let compiled = fixture::compile(&format!("{}{}\nquery modeCoverage():\n  point = feedAuthors['alice'] by byPrincipal\n  range = feedAuthors first 100 by byPrincipal\n  return {{ point, range }}\n", fixture::APP, fixture::DECLARATION));
    b.schema.operations.insert("modeCoverage".into(), compiled.schema.operations["modeCoverage"].clone());
    b.programs.extend(compiled.programs.into_iter().filter(|p| p.program.name == "modeCoverage").map(|p| p.program));
    b.schema.tables.get_mut("feedAuthors").unwrap().leave = LeavePolicy::DeliveredHistory;
    let mut d = open(&mut h, &mut e, b, "alice");
    for left in [false, true] {
        if left {
            let page = serde_json::from_value(json!({"snapshot":false,"events":[{"table":"feedAuthors","kind":"scope","id":"scope","data":[]}],"watermark":e.seq().unwrap()+1,"more":false})).unwrap();
            d.apply(&page, false).unwrap();
        }
        let (result, unknown, _, components) = d.query_with_components("modeCoverage","alice",&json!({}),100);
        let data = result.unwrap().data;
        assert!(!unknown);
        assert_ne!(data.field("point").unwrap(), &Value::Null);
        assert!(!data.field("range").unwrap().as_array().unwrap().is_empty());
        for key in ["point", "range"] {
            let coverage = &components[key];
            assert_eq!(coverage.retained, left, "{key}: {coverage:?}");
            assert!(!coverage.unknown);
        }
    }
}
#[test] fn retained_point_scan_memory() { point_and_scan(Memory::new()); }
#[test] fn retained_point_scan_sqlite() { point_and_scan(Sqlite::new("point-scan")); }

pub fn assert_repost<S: Images>(d: &mut Device<S>, q: &Queued) {
    let event = &q.new_ids[1];
    let own = owned_id("feed", "Feed", &[fixture::id("alice"), fixture::id(event)]);
    assert_eq!(q.predicted.iter().cloned().collect::<std::collections::BTreeSet<_>>(),
        [format!("reposts/{}", q.new_ids[0]), format!("feedPosts/{event}"), format!("feedFeed/{own}")].into());
    for table in ["feedFeed", "feedPulls"] {
        assert!(d.store().images(table).iter().all(|r|r.field("readerId").unwrap()==&fixture::id("alice")));
    }
    assert_eq!(page(d,"alice").as_array().unwrap().iter().filter(|r|r.field("id").unwrap()==&fixture::id(event)).count(),1);
}
