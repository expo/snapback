use super::*;
use snapback4_core::{engine::LoadMode, meter::Ceilings, value::object};

#[test]
fn every_meter_field_matches_across_hidden_totals_and_parent_worlds_at_each_cut() {
    let source = MODEL.replacen("  at: time", "  owner: principal default viewer\n  by byOwner: owner, id\n  until: time ?\n  by byUntil: until, id\n  expire at .until\n  at: time", 1)
        .replacen("  public", "  read <- .owner = viewer", 1)
        .replacen("  online only", "  sync to .owner", 1)
        .replace("  online only", "  sync public");
    let observe = |n: usize, world: u8, delete: bool, system: bool, ceiling: Ceilings| {
        let mut e = engine(&source);
        let rows = std::iter::once(("likes".into(), object([("id", id("dummy")), ("postId", Value::Null), ("active", Value::Bool(true)), ("amount", Value::Int(1))])))
            .chain((0..n).map(|i| ("likes".into(), object([("id", id(&format!("old{i}"))), ("postId", id("p")), ("active", Value::Bool(true)), ("amount", Value::Int(1))]))));
        e.seed_at(rows, 1000).unwrap();
        e.load_mode([("posts".into(), object([
            ("id", id(if world == 0 { "other" } else { "p" })), ("at", Value::Int(1)), ("owner", id("bob")),
            ("until", if world == 3 { Value::Int(1) } else { Value::Null }),
            ("likeCount", Value::Int(if world == 2 { 77 } else { 0 })), ("selected", Value::Int(0)), ("total", Value::Int(0)),
        ]))], LoadMode::Restore).unwrap();
        let before = e.schema().tables.keys().map(|t| (t.clone(), e.store().rows(t).unwrap())).collect::<BTreeMap<_, _>>();
        let from = e.seq().unwrap();
        e.set_ceilings(ceiling);
        let args = if delete { vec![("id", id("old0"))] } else { vec![("id", id("new")), ("postId", id("p")), ("active", Value::Bool(true)), ("amount", Value::Int(1))] };
        let mut ctx = context(&args);
        if system { let args = ctx.args; ctx = Context::system().at(1000); ctx.args = args; }
        let op = if delete { "unlike" } else { "like" };
        let out = e.mutate(op, Some("attempt"), ctx.clone()).unwrap();
        let retry = e.mutate(op, Some("attempt"), ctx).unwrap();
        assert!(retry.replayed);
        assert_eq!(retry.receipt(Some("attempt")), out.receipt(Some("attempt")));
        if let WriteState::Failed { why, .. } = &out.state {
            assert_eq!(why.code, "E_BOUND");
            assert_eq!(e.seq().unwrap(), from);
            for (table, rows) in before { assert_eq!(e.store().rows(&table).unwrap(), rows); }
        } else {
            let expected = n as i64 + if delete { -1 } else { 1 };
            for m in &e.schema().maintains {
                let private=e.store().rows(&m.target).unwrap();
                if expected==0 {assert!(private.is_empty());} else {
                    assert_eq!(private[0].field("value").unwrap(),&Value::Int(expected));
                }
            }
            let rows = e.store().rows("posts").unwrap();
            let row = rows.iter().find(|r| r.field("id").unwrap() == &id("p"));
            if world == 0 { assert!(row.is_none()); }
            else if world == 3 { assert_eq!(rows, before["posts"]); }
            else {
                let expected = n as i64 + if delete { -1 } else { 1 };
                for field in ["likeCount", "selected", "total"] { assert_eq!(row.unwrap().field(field).unwrap(), &Value::Int(expected)); }
            }
        }
        let public = format!("{:?}{:?}{:?}{:?}",out.reply(Some("attempt")),out.receipt(Some("attempt")),out.tables,retry);
        for m in &e.schema().maintains { assert!(!public.contains(&m.target)); }
        for viewer in ["alice","bob"] {
            let page=e.stream_at(viewer,from,100,1000).unwrap();
            assert!(page.events.iter().all(|event|e.schema().visible(&event.table)));
            let json=serde_json::to_string(&page).unwrap().to_lowercase();
            for m in &e.schema().maintains {assert!(!json.contains(&m.target.to_lowercase()));}
        }
        (out.reply(Some("attempt")), out.receipt(Some("attempt")), out.metered, out.tables, retry.reply(Some("attempt")), retry.metered, retry.tables,
            e.stream_at("alice", from, 100, 1000).unwrap().events)
    };
    for delete in [false, true] {
        for system in [false, true] {
            let min = usize::from(delete);
            let ample = observe(min, 0, delete, system, Ceilings::default());
            assert_eq!(ample.0["state"], "sent");
            assert_eq!(ample.3, vec!["likes", "posts"]);
            let mut ceilings = vec![Ceilings::default()];
            let m = ample.2;
            for (field, value) in [(0, m.examined), (1, m.index_entries), (2, m.rows_written), (3, m.steps), (4, m.rule_probes), (5, m.output_bytes)] {
                if value == 0 { continue; }
                let mut c = Ceilings::default();
                match field { 0 => c.examined = value - 1, 1 => c.index_entries = value - 1, 2 => c.rows_written = value - 1,
                    3 => c.steps = value - 1, 4 => c.rule_probes = value - 1, _ => c.output_bytes = value - 1 }
                ceilings.push(c);
            }
            // Heap is live scratch, so the final meter is not its peak.
            let (mut low, mut high) = (0, Ceilings::default().heap_bytes);
            while low < high {
                let mid = (low + high) / 2;
                if observe(min, 0, delete, system, Ceilings { heap_bytes: mid, ..Ceilings::default() }).0["state"] == "sent" { high = mid; } else { low = mid + 1; }
            }
            ceilings.push(Ceilings { heap_bytes: low - 1, ..Ceilings::default() });
            for (cut, c) in ceilings.into_iter().enumerate() {
                let expected = observe(min, 0, delete, system, c);
                assert_eq!(expected.0["state"], if cut == 0 { "sent" } else { "failed" });
                for n in [min, min + 1, 7] {
                    for world in 0..4 {
                        assert_eq!(observe(n, world, delete, system, c), expected, "n={n} world={world} delete={delete} system={system} cut={cut}");
                    }
                }
            }
        }
    }
}

#[test]
fn deleting_a_synced_source_still_pays_its_partition_step_after_private_work() {
    let run = |sync: bool| {
        let source = if sync { MODEL.replacen("  online only", "  sync public", 2) } else { MODEL.to_string() };
        let mut e = engine(&source);
        post(&mut e, "p", 1);
        like(&mut e, "l", id("p"), true, 1);
        let from = e.seq().unwrap();
        let out = e.mutate("unlike", None, context(&[("id", id("l"))])).unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }));
        assert_eq!(totals(&mut e, "p"), (0, 0, 0));
        if sync {
            let events = e.stream_at("alice", from, 100, 1000).unwrap().events;
            assert_eq!(events.iter().map(|event|event.table.as_str()).collect::<std::collections::BTreeSet<_>>(),["likes","posts"].into());
            assert_eq!(events.len(),2);
            assert!(events.iter().any(|event| event.table == "likes" && event.kind == "del"));
            assert!(events.iter().any(|event| event.table == "posts" && event.kind == "put"));
        }
        out.metered
    };
    let offline = run(false);
    let synced = run(true);
    assert_eq!(synced.steps, offline.steps + 1, "the source delete pays one old partition; mirrors were reserved");
}
