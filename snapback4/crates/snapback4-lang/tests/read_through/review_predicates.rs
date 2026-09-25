//! Completed predicate answers remain dependencies even when a row is rejected.
use super::{Backend, ctx, id, system};
use snapback4_core::{Value, meter::Ceilings};

const MODEL: &str = r#"
table gates:
  docId: id
  label: text <=20
  until: time
  unique docId
  expire at .until
  read <- viewer = 'alice'
  insert <- allow
table docs:
  body: text <=20
  gate: id
  read <- allow
  insert <- allow
mutation gate(id: id, docId: id, until: time):
  insert gates { id, docId, label: 'match', until }
mutation doc(id: id, body: text <=20, gate: id):
  insert docs { id, body, gate }
fn rawId(value: id): value
query gateCount():
  return count(gates)
"#;

fn gate(e: &mut dyn Backend, key: &str, doc: &str, deadline: i64) {
    system(
        e,
        "gate",
        &[
            ("id", id(key)),
            ("docId", id(doc)),
            ("until", Value::Int(deadline)),
        ],
    );
}

fn doc(e: &mut dyn Backend, key: &str, body: &str, gate: &str) {
    system(
        e,
        "doc",
        &[
            ("id", id(key)),
            ("body", Value::String(body.into())),
            ("gate", id(gate)),
        ],
    );
}

fn queries(predicate: &str) -> String {
    format!(
        "\nquery page():\n  return docs where {predicate} first 10 by .id\nquery total():\n  return count(docs where {predicate})\n"
    )
}

fn answer(e: &mut dyn Backend, op: &str, viewer: &str, now: i64, expiry: Option<i64>) -> Value {
    let context = ctx(viewer, now, &[]);
    if let Some(o) = e.query(op, context.clone(), Ceilings::default()) {
        assert!(
            o.complete && !o.unavailable && o.capped_at.is_none(),
            "{op}: {o:?}"
        );
        assert_eq!(o.next_expiry, expiry, "{op}: {o:?}");
        let mut tables = vec!["gates"];
        if op != "gateCount" {
            tables.push("docs");
        }
        for table in tables {
            assert!(o.tables.iter().any(|name| name == table), "{o:?}");
        }
        o.data
    } else {
        e.run(op, context, Ceilings::default()).0.unwrap()
    }
}

fn assert_rows(value: Value, expected: &[&str]) {
    let ids: Vec<_> = value
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row.field("id").unwrap().clone())
        .collect();
    assert_eq!(ids, expected.iter().map(|key| id(key)).collect::<Vec<_>>());
}

fn absent_gate_expiry(
    factory: &mut impl FnMut(&str) -> Box<dyn Backend>,
    column: &str,
    extra_doc: bool,
) {
    // Intrinsic ids have distinct table-reference types; the id-key witness
    // passes the shared stored identity through the existing generic id type.
    let key = if column == "id" { "rawId(.id)" } else { ".id" };
    let source = format!(
        "{MODEL}{}",
        queries(&format!("not exists gates[{column} = {key}]"))
    );
    for deadline in [300, 500] {
        let mut e = factory(&source);
        doc(&mut *e, "a", "match", "a");
        if extra_doc {
            doc(&mut *e, "b", "other", "a");
        }
        // The secondary-key case deliberately uses a different stored gate id.
        gate(
            &mut *e,
            if column == "id" { "a" } else { "g" },
            "a",
            deadline,
        );
        for (now, expected, expiry) in [
            (
                200,
                if extra_doc { vec!["b"] } else { vec![] },
                Some(deadline),
            ),
            (
                deadline,
                if extra_doc { vec!["a", "b"] } else { vec!["a"] },
                None,
            ),
        ] {
            assert_rows(answer(&mut *e, "page", "alice", now, expiry), &expected);
            assert_eq!(
                answer(&mut *e, "total", "alice", now, expiry),
                Value::Int(expected.len() as i64)
            );
        }
        // A denied witness is indistinguishable from absence, including expiry.
        let expected = if extra_doc { vec!["a", "b"] } else { vec!["a"] };
        assert_rows(answer(&mut *e, "page", "bob", 200, None), &expected);
        assert_eq!(
            answer(&mut *e, "total", "bob", 200, None),
            Value::Int(expected.len() as i64)
        );
    }
}

pub fn predicate_id_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    absent_gate_expiry(&mut factory, "id", false);
}

pub fn predicate_index_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    absent_gate_expiry(&mut factory, "docId", true);
}

pub fn predicate_point_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let source = format!("{MODEL}{}", queries(".body = gates[id = .gate].label"));
    for deadline in [300, 500] {
        for bodies in [vec!["match"], vec!["other"], vec!["other", "match"]] {
            let mut e = factory(&source);
            gate(&mut *e, "shared", "unused", deadline);
            for (i, body) in bodies.iter().enumerate() {
                doc(&mut *e, &format!("d{i}"), body, "shared");
            }
            let matching: Vec<_> = bodies
                .iter()
                .enumerate()
                .filter(|(_, body)| **body == "match")
                .map(|(i, _)| format!("d{i}"))
                .collect();
            let expected: Vec<_> = matching.iter().map(String::as_str).collect();
            assert_rows(
                answer(&mut *e, "page", "alice", 200, Some(deadline)),
                &expected,
            );
            assert_eq!(
                answer(&mut *e, "total", "alice", 200, Some(deadline)),
                Value::Int(expected.len() as i64)
            );
            for (viewer, now) in [("alice", deadline), ("bob", 200)] {
                assert_rows(answer(&mut *e, "page", viewer, now, None), &[]);
                assert_eq!(answer(&mut *e, "total", viewer, now, None), Value::Int(0));
            }
        }
    }
}

pub fn predicate_private_authorization_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let source = format!(
        "{}\ntable permits:\n  owner: principal\n  until: time\n  unique owner\n  expire at .until\n  read <- deny\n  insert <- allow\nmutation permit(until: time):\n  insert permits {{ id: 'p', owner: 'alice', until }}\n{}",
        MODEL.replace(
            "  read <- allow\n",
            "  read <- exists permits[owner = viewer]\n"
        ),
        queries("not exists gates[id = rawId(.id)]")
    );
    let mut replies = Vec::new();
    for deadline in [300, 500] {
        let mut e = factory(&source);
        system(&mut *e, "permit", &[("until", Value::Int(deadline))]);
        doc(&mut *e, "a", "match", "a");
        gate(&mut *e, "a", "a", 700);
        assert_rows(answer(&mut *e, "page", "alice", 200, Some(700)), &[]);
        assert_eq!(
            answer(&mut *e, "total", "alice", 200, Some(700)),
            Value::Int(0)
        );
        if let Some(o) = e.query("page", ctx("alice", 200, &[]), Ceilings::default()) {
            replies.push(o);
        }
    }
    for pair in replies.windows(2) {
        assert_eq!(pair[0], pair[1]);
    }
}

pub fn streaming_count_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    for deadline in [300, 500] {
        let mut e = factory(MODEL);
        gate(&mut *e, "a", "a", deadline);
        assert_eq!(
            answer(&mut *e, "gateCount", "alice", 200, Some(deadline)),
            Value::Int(1)
        );
        assert_eq!(
            answer(&mut *e, "gateCount", "alice", deadline, None),
            Value::Int(0)
        );
    }
}

// Astra R7: a completed first read belongs to an interrupted predicate scope.
pub fn predicate_cut_discards_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    for keep in [false, true] {
        let source = format!("{MODEL}\nquery cut():\n  {}\n  return {{ kept: {}, page: docs where .body = gates[id = .gate].label and .body = gates[id = .gate].label first 10 by .id }}\n",
            if keep { "kept = gates[id = 'keep']" } else { "kept = null" }, "kept");
        let mut replies = Vec::new();
        for deadline in [300, 500] {
            let mut e = factory(&source);
            doc(&mut *e,"a","match","g");
            gate(&mut *e,"g","a",deadline);
            gate(&mut *e,"second","second",700);
            gate(&mut *e,"keep","keep",250);
            let ceilings = Ceilings { rule_probes: 1, ..Ceilings::default() };
            if let Some(reply) = e.query("cut", ctx("alice",200,&[]), ceilings) {
                assert!(!reply.complete && !reply.unavailable, "{reply:?}");
                assert!(reply.capped_at.is_some(), "{reply:?}");
                assert_eq!(reply.next_expiry, keep.then_some(250), "{reply:?}");
                assert!(reply.data.field("page").unwrap().as_array().unwrap().is_empty(),"{reply:?}");
                assert_eq!(reply.metered.rule_probes,2,"{reply:?}");
                replies.push(reply);
            }
        }
        if replies.len() == 2 { assert_eq!(replies[0],replies[1]); }
    }
}

// Grok R7: a kept filtered row must commit its own candidate token as well.
pub fn predicate_kept_row_expiry(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let model=MODEL.replace("table docs:\n", "table docs:\n  until: time default 300\n  expire at .until\n");
    let source=format!("{model}\nquery kept():\n  docs where .body = 'keep' and slice(.body, 0, 1) = 'k' first 10 by .id\n");
    let mut e=factory(&source);
    doc(&mut *e,"a","keep","none");
    for (now,expected,expiry) in [(200,vec!["a"],Some(300)),(300,vec![],None)] {
        if let Some(reply)=e.query("kept",ctx("alice",now,&[]),Ceilings::default()) {
            assert!(reply.complete && !reply.unavailable,"{reply:?}");assert_eq!(reply.next_expiry,expiry,"{reply:?}");assert_rows(reply.data,&expected);
        } else {assert_rows(e.run("kept",ctx("alice",now,&[]),Ceilings::default()).0.unwrap(),&expected);}
    }
}
