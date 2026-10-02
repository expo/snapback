use snapback4_core::{Context, Engine, Value, wire};
use serde_json::json;

pub const SOURCE: &str = include_str!("schema.q");
pub fn source(rule: &str, member_expiry: bool) -> String {
    SOURCE.replace("PREDICATE", rule).replace("MEMBER_EXPIRY", if member_expiry { "expire at .until" } else { "" })
}
fn engine(rule: &str, member_expiry: bool) -> Engine {
    let b = snapback4_lang::compile(&[("schema.q".into(), source(rule, member_expiry))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap()
}
fn seed(e: &mut Engine, messages: &[Option<i64>], member: Option<i64>, permits: &[Option<i64>]) {
    let mut rows=vec![("rooms",json!({"id":"r"})), ("members",json!({"id":"u","room":"r","until":member})),
        ("gates",json!({"id":"g","member":"u"})), ("links",json!({"id":"l","gate":"g"})), ("leaves",json!({"id":"z","link":"l"}))];
    for (n,until) in messages.iter().enumerate() { rows.push(("messages",json!({"id":format!("m{n}"),"room":"r","until":until}))); }
    for (n,until) in permits.iter().enumerate() { rows.push(("permits",json!({"id":format!("p{n}"),"member":"u","until":until}))); }
    let rows=rows.into_iter().map(|(table,row)| (table.to_string(),wire::row_from_json(&e.schema().tables[table],&row).unwrap())).collect::<Vec<_>>();
    e.seed_at(rows,1).unwrap();
}

#[test]
fn permit_deadline_refuses_maintenance_but_value_keeps_it_through_two_links() {
    let original="not exists unread[member = .member, recountPending = false] or exists permits[member = .member]";
    let b=snapback4_lang::compile(&[("schema.q".into(),source(original,false))]);
    assert!(b.diagnostics.iter().any(|d|d.code=="E_VIEW_KEY" && d.message.contains("recountPending") && d.rewrite.contains("value")),"{:?}",b.diagnostics);
    let mut e=engine(&original.replace("recountPending = false","value = 0"),false);
    seed(&mut e,&[Some(10)],None,&[Some(20)]);
    for settled in [false,true] {
        if settled { while e.run_view_chunk(2).unwrap().is_some() {} }
        for now in [2,10,19,20,9] {
            for op in ["direct","linked","leaf"] {
                let r=e.query(op,Context::new("reader",Default::default()).at(now)).unwrap();
                assert!(r.complete,"{r:?}");
                assert_eq!(r.data!=Value::Null,now<20,"{op} at {now}: {r:?}");
                assert_eq!(r.next_expiry,(now<20).then_some(20),"{op} at {now}: {r:?}");
            }
        }
    }
}

#[test]
fn generated_composed_count_rules_match_future_model_deadlines() {
    let mut comparisons=0;
    for seed_id in [7u64,20261002,0xdeadbeef,28,0x5eed,0x12345678] {
        let mut rng=seed_id;
        let mut next=|| { rng^=rng<<13; rng^=rng>>7; rng^=rng<<17; rng };
        let messages:Vec<_>=(0..4).map(|_|[None,Some(10),Some(15),Some(25)][next() as usize%4]).collect();
        let permits=vec![Some(20),[None,Some(20),Some(30)][next() as usize%3]];
        let member=[None,Some(15),Some(40)][next() as usize%3];
        for wanted in 0..=4 {
            let a=format!("exists unread[member = .member, value = {wanted}]");
            let b="exists permits[member = .member]";
            for (which,rule) in [format!("{a} or {b}"),format!("not {a} or {b}"),format!("{a} and {b}"),
                format!("not ({a} and {b})"),format!("{a} or not {a}"),format!("({a} or {b}) and not ({a} and {b})")].iter().enumerate() {
                let model=|at| {
                    let a=member.is_none_or(|t| at<t) && messages.iter().filter(|t|t.is_none_or(|t|at<t)).count()==wanted;
                    let b=permits.iter().any(|t|t.is_none_or(|t|at<t));
                    match which { 0=>a||b,1=>!a||b,2=>a&&b,3=>!(a&&b),4=>true,_=>(a||b)&&!(a&&b) }
                };
                let mut boundaries=messages.iter().chain(&permits).filter_map(|t|*t).chain(member).collect::<Vec<_>>();
                boundaries.sort();boundaries.dedup();
                let mut e=engine(rule,member.is_some()); seed(&mut e,&messages,member,&permits);
                for settled in [false,true] {
                    if settled { while e.run_view_chunk(2).unwrap().is_some() {} }
                    for now in [2,10,15,20,25,30,40,9] {
                        let want=model(now);
                        let deadline=if want {boundaries.iter().copied().find(|t|*t>now && model(*t)!=want)} else {None};
                        for op in ["direct","linked","leaf"] {
                            let r=e.query(op,Context::new("reader",Default::default()).at(now)).unwrap();
                            assert!(r.complete,"seed={seed_id} {rule}: {r:?}");
                            assert_eq!((r.data!=Value::Null,r.next_expiry),(want,deadline),"seed={seed_id} rule={rule} {op} at {now} settled={settled} sources={messages:?} member={member:?} permits={permits:?}");
                            comparisons+=1;
                        }
                    }
                }
            }
        }
    }
    eprintln!("BG round5 composed deadline property: 6 seeds, 180 rule/count cases, {comparisons} model comparisons, both settlement states and two read-through links");
}
