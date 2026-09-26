//! Merge seam: row-view lifetime is the read-through effective deadline.
use super::*;
use crate::rows::{MemoryRows, Rows};

const MEMBER: &str = include_str!("../../../../snapback4-lang/tests/fixtures/row-view-inherited-member.q");
const SOURCE: &str = include_str!("../../../../snapback4-lang/tests/fixtures/row-view-inherited-source.q");

fn scenario(rows: &dyn Rows, schema: &Schema, programs: &[Program], member: bool) {
    let run = |op: &str, now| {
        let mut r = Runner::new(rows, schema, Context::new("alice", Default::default()).at(now), Meter::new(Ceilings::default(), Cut::Cap), 0);
        r.event_free = true;
        let data = r.run(programs.iter().find(|p| p.name == op).unwrap()).unwrap();
        assert!(r.meter.capped_at.is_none() && !r.timeline_pending && !r.query_unavailable, "{op} was incomplete");
        (data, r.next_expiry.get())
    };
    run("seed", 1000);
    for now in [1000, 1999, 2000, 3000] {
        let live = now < 2000;
        let (point, expiry) = run("message", now);
        assert_eq!(point != Value::Null, live);
        assert_eq!(expiry, live.then_some(2000));
        if member {
            let (secret, expiry) = run("secret", now);
            assert_eq!(secret != Value::Null, live, "expired member authorized secret at {now}");
            assert_eq!(expiry, live.then_some(2000), "complete witness deadline at {now}");
        }
        assert_eq!(run("countFor", now), (Value::Int(i64::from(live)), live.then_some(2000)), "count at {now}");
    }
    if !member {
        // Recount before physical expiry deletion must not subtract twice.
        run("mark", 2000);
        assert_eq!(rows.get("unread", "m").unwrap().unwrap().field("value"), Ok(&Value::Int(0)));
        let old = rows.get("messages", "x").unwrap().unwrap();
        rows.delete("messages", &schema.tables["messages"], &old).unwrap();
        let mut sweep = Runner::new(rows, schema, Context::system().at(2000), Meter::new(Ceilings::default(), Cut::Abort), 0);
        sweep.event_free = true;
        sweep.row_changed("messages", Some(&old), None, Origin::Source).unwrap();
        assert_eq!(rows.get("unread", "m").unwrap().unwrap().field("value"), Ok(&Value::Int(0)));
    }
}

fn check(member: bool, sqlite: bool) {
    let b = snapback4_lang::compile(&[("schema.q".into(), if member { MEMBER } else { SOURCE }.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let schema: Schema = crate::json_codec::from_text(&crate::json_codec::to_text(&b.schema).unwrap()).unwrap();
    let programs: Vec<Program> = crate::json_codec::from_text(&crate::json_codec::to_text(&b.programs.into_iter().map(|p| p.program).collect::<Vec<_>>()).unwrap()).unwrap();
    let mut e = Engine::memory(schema, programs.clone()).unwrap();
    let schema = e.schema().clone();
    if sqlite {
        let tx = e.store_mut().transaction().unwrap();
        scenario(&tx, &schema, &programs, member);
    } else {
        scenario(&MemoryRows::new(), &schema, &programs, member);
    }
}

#[test] fn inherited_member_witness_memory() { check(true, false); }
#[test] fn inherited_member_witness_sqlite() { check(true, true); }
#[test] fn inherited_source_count_memory() { check(false, false); }
#[test] fn inherited_source_count_sqlite() { check(false, true); }
