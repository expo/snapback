//! Suppression must abort row/index deltas and their complete durable history.
use super::*;

const SOURCE: &str = r#"table cells:
  label: text <=64
  group: int
  unique label
  cap 8 by group
  public
  insert <- allow
  update <- allow
  delete <- allow
  sync public
mutation setup():
  insert cells { id: 'a', label: 'old', group: 0 }
mutation remove():
  delete cells[id = 'a']
mutation edit():
  update cells[id = 'a'] { label: 'new' }
mutation add():
  insert cells { id: 'b', label: 'new', group: 0 }
"#;

fn suppression(pg: bool, relation: &str, event: &str, operation: &str) {
    suppression_source(pg, SOURCE, relation, event, operation);
}
fn suppression_source(pg: bool, source: &str, relation: &str, event: &str, operation: &str) {
    let mut engine = fixture_source(pg, source);
    let before = snapshot(&mut engine);
    let tx = engine.store_mut().transaction().unwrap();
    let indexes = |tx: &crate::store_port::AnyTx<'_>| {
        super::metadata_rows(
            tx,
            "SELECT json_build_array(t,ix,encode(k,'hex'),id)::text FROM i ORDER BY t,ix,k",
            "SELECT json_array(ti,hex(k),id) FROM i ORDER BY ti,k",
        )
    };
    let before_indexes = indexes(&tx);
    if pg {
        #[cfg(feature = "postgres")]
        tx.test_postgres_tx().batch(&format!("CREATE FUNCTION suppress_delta() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER suppress_delta BEFORE {event} ON {relation} FOR EACH ROW EXECUTE FUNCTION suppress_delta()")).unwrap();
    } else {
        tx.test_support_conn().execute_batch(&format!("CREATE TRIGGER suppress_delta BEFORE {event} ON {relation} BEGIN SELECT RAISE(IGNORE); END")).unwrap();
    }
    tx.commit().unwrap();
    let mut batch = (0..4)
        .map(|n| {
            let mut i = Invocation::new(
                operation,
                Some(format!("delta-{n}")),
                Context::new("alice", Default::default()).at(1000),
            );
            // Persistent suppression must also be rejected by the live retries.
            i.deadline = std::time::Instant::now() + Duration::from_secs(30);
            i
        })
        .collect::<Vec<_>>();
    let actual = engine.invoke_program_batch(&mut batch);
    let after = snapshot(&mut engine);
    let expected = if relation == "_sequences" {
        "sequence upsert count mismatch"
    } else if relation == "_cap_counts" {
        if event == "INSERT" { "cap increment count mismatch" } else { "cap decrement count mismatch" }
    } else if relation == "r" {
        "row delete count mismatch"
    } else if event == "INSERT" {
        "index insert count mismatch"
    } else {
        "index delete count mismatch"
    };
    eprintln!(
        "serial delta pg={pg} {relation}/{event}/{operation}: errors={}, attempts={:?}",
        actual.iter().filter(|r| r.is_err()).count(),
        batch.iter().map(|i| i.attempts.len()).collect::<Vec<_>>()
    );
    assert!(
        actual.iter().all(
            |r| matches!(r, Err(why) if why.code == "E_STORE" && why.message.contains(expected))
        ),
        "{actual:?}"
    );
    assert!(
        batch
            .iter()
            .all(|i| !i.attempts.is_empty() && i.attempts.iter().all(|a| !a.buffered))
    );
    // The first error names/removes member 0. Nonempty attempts for ALL later
    // members prove that deadline-live survivors execute the named recovery.
    assert_eq!(
        after, before,
        "row, cap, receipt, head, commits, evidence and log rollback"
    );
    let tx = engine.store_mut().transaction().unwrap();
    assert_eq!(
        indexes(&tx),
        before_indexes,
        "every physical index delta must roll back"
    );
    if pg {
        #[cfg(feature = "postgres")]
        tx.test_postgres_tx()
            .batch(&format!(
                "DROP TRIGGER suppress_delta ON {relation}; DROP FUNCTION suppress_delta()"
            ))
            .unwrap();
    } else {
        tx.test_support_conn()
            .execute_batch("DROP TRIGGER suppress_delta")
            .unwrap();
    }
    tx.commit().unwrap();
    assert!(matches!(
        engine
            .invoke_program(&mut Invocation::new(
                operation,
                Some("recovered".into()),
                Context::new("alice", Default::default()).at(1000)
            ))
            .unwrap()
            .outcome
            .state,
        crate::WriteState::Sent { .. }
    ));
}

macro_rules! witness {
    ($sqlite:ident, $postgres:ident, $relation:literal, $event:literal, $op:literal) => {
        #[test]
        fn $sqlite() {
            suppression(false, $relation, $event, $op);
        }
        #[cfg(feature = "postgres")]
        #[test]
        #[ignore = "private PG16; scripts/test-postgres.sh"]
        fn $postgres() {
            suppression(true, $relation, $event, $op);
        }
    };
}
witness!(
    serial_delta_row_delete_sqlite,
    serial_delta_row_delete_postgres,
    "r",
    "DELETE",
    "remove"
);
witness!(
    serial_delta_update_index_delete_sqlite,
    serial_delta_update_index_delete_postgres,
    "i",
    "DELETE",
    "edit"
);
witness!(
    serial_delta_update_index_insert_sqlite,
    serial_delta_update_index_insert_postgres,
    "i",
    "INSERT",
    "edit"
);
witness!(
    serial_delta_delete_index_delete_sqlite,
    serial_delta_delete_index_delete_postgres,
    "i",
    "DELETE",
    "remove"
);
witness!(
    serial_delta_insert_index_insert_sqlite,
    serial_delta_insert_index_insert_postgres,
    "i",
    "INSERT",
    "add"
);

fn maintained_counts(pg: bool) {
    let expiring=SOURCE.replace("  group: int", "  until: time default 10000\n  expire at .until\n  group: int") + "mutation removeB():\n  delete cells[id = 'b']\n";

    let sequence=super::SOURCE.to_string()+"mutation sequenceNew():\n  insert entries { counter: 'b', delta: 1 }\n";

    let mut e=fixture_source(pg,&expiring);
    // Decrement 2 -> 1 legally deletes no zero-count row; 1 -> 0 deletes one.
    for op in ["add","remove","removeB"] {
        assert!(matches!(e.mutate(op,None,Context::new("alice",Default::default()).at(1000)).unwrap().state,crate::WriteState::Sent {..}));
    }
    let tx=e.store_mut().transaction().unwrap();
    assert!(super::metadata_rows(&tx,"SELECT n::text FROM _cap_counts","SELECT CAST(n AS TEXT) FROM _cap_counts").is_empty());
    tx.rollback().unwrap();
    let mut e=fixture_source(pg,&sequence);
    for n in 1..=2 {
        assert!(matches!(e.mutate("sequenceNew",None,Context::new("alice",Default::default()).at(1000)).unwrap().state,crate::WriteState::Sent {..}));
        let mut ordinals=e.store().rows("entries").unwrap().iter().map(|r|r.field("ordinal").unwrap().clone()).collect::<Vec<_>>();
        ordinals.sort_by_key(|v|match v {Value::Int(n)=>*n,_=>panic!("ordinal")});
        assert_eq!(ordinals,(1..=n).map(Value::Int).collect::<Vec<_>>());
    }
}
#[test]
fn steady_cap_and_new_parent_sequence_counts_sqlite() {maintained_counts(false);}
#[cfg(feature="postgres")]
#[test]
#[ignore="private PG16; scripts/test-postgres.sh"]
fn steady_cap_and_new_parent_sequence_counts_postgres() {maintained_counts(true);}

macro_rules! maintained_witness {
    ($sqlite:ident,$postgres:ident,$relation:literal,$event:literal,$op:literal) => {
        #[test] fn $sqlite() { maintained_suppression(false,$relation,$event,$op); }
        #[cfg(feature="postgres")]
        #[test] #[ignore="private PG16; scripts/test-postgres.sh"]
        fn $postgres() { maintained_suppression(true,$relation,$event,$op); }
    }
}
fn maintained_suppression(pg:bool,relation:&str,event:&str,op:&str) {
    let source=if relation=="_sequences" {
        super::SOURCE.to_string()+"mutation sequenceNew():\n  insert entries { counter: 'b', delta: 1 }\n"
    } else {SOURCE.replace("  group: int","  until: time default 10000\n  expire at .until\n  group: int")};
    suppression_source(pg,&source,relation,event,op);
}
maintained_witness!(steady_cap_increment_suppression_sqlite,steady_cap_increment_suppression_postgres,"_cap_counts","INSERT","add");
maintained_witness!(steady_cap_decrement_suppression_sqlite,steady_cap_decrement_suppression_postgres,"_cap_counts","UPDATE","remove");
maintained_witness!(steady_sequence_suppression_sqlite,steady_sequence_suppression_postgres,"_sequences","INSERT","sequenceNew");
