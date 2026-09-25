#[path="row_view_disclosure/mod.rs"] mod disclosure;
#[path="row_view_disclosure/cases.rs"] mod cases;
use disclosure::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Value, WriteState};

#[test]
fn hidden_member_payload_through_witness() { witness_case(false); }
#[test]
fn ordinary_member_witness_control() { witness_case(true); }
fn witness_case(control: bool) {
    let source = cases::private_members().replace("  expire at .until\n", "")
        .replace("  joinedAt: int default 0", "  joinedAt: int default 0\n  note: text <=20000000 default ''")
        + "\ntable gates:\n  member: members\n  read <- exists unread[member = .member] and viewer = 'nobody'\n  insert <- exists unread[member = .member] and viewer = 'nobody'\nquery gate():\n  return gates['gate']\nmutation attempt():\n  insert gates { id: 'attempt', member: 'b' }\n";
    let source=source+"\ntable permitted:\n  member: members\n  read <- exists unread[member = .member] and viewer = 'alice'\nquery permit():\n  return permitted['permit']\n";
    let source = if control { source.replace("exists unread[member = .member]", "exists members[id = .member]") } else { source };
    let seeds = [0,17 << 20].map(|bytes| {
        let mut row = cases::member("b","bob",0);
        row.1["note"] = json!("x".repeat(bytes));
        vec![row, ("gates".into(), json!({"id":"gate","member":"b"})), ("permitted".into(), json!({"id":"permit","member":"b"}))]
    });
    let mut pair = Pair::new(source,seeds,"alice",Operation::new("attempt",json!({}),"alice"));
    let mut differences=vec![];
    for file in [false,true] {
        pair.file_store=file;
        let mut obs=vec![];
        for world in 0..2 {
            let mut e=pair.engine(world);
            let r=e.query("gate",Context::new("alice",Default::default()).at(NOW)).unwrap();
            let w=e.mutate("attempt",None,Context::new("alice",Default::default()).at(NOW)).unwrap();
            if !control {
                assert!(r.complete && r.data==Value::Null && r.cut.is_none(),"{r:?}");
                assert!(matches!(&w.state,WriteState::Failed {why,..} if why.code=="E_RULE"),"{w:?}");
                let permit=e.query("permit",Context::new("alice",Default::default()).at(NOW)).unwrap();
                assert!(permit.complete && permit.data!=Value::Null,"a witness is not a recursive member read: {permit:?}");
            }
            eprintln!("WITNESS control={control} file={file} world={world}: query={r:?} write={w:?}");
            obs.push(json!({"query":r,"write":w}));
        }
        differences.push(obs[0]!=obs[1]);
    }
    assert_eq!(differences, vec![false,false], "private unrelated payload disclosed through witness");
}


#[test]
fn denied_view_witness_reserves_before_hidden_presence() {
    let source=cases::private_members()+"\ntable gates:\n  member: members\n  read <- exists unread[member = .member] and viewer = 'nobody'\n  insert <- exists unread[member = .member] and viewer = 'nobody'\nquery gate():\n  return gates['gate']\nmutation attempt():\n  insert gates { id: 'attempt', member: 'b' }\n";
    let seeds=[false,true].map(|present| {
        let mut rows=vec![("gates".into(),json!({"id":"gate","member":"b"}))];
        if present {rows.insert(0,cases::member("b","bob",0));} rows
    });
    let mut pair=Pair::new(source,seeds,"alice",Operation::new("attempt",json!({}),"alice"));
    for file in [false,true] {
        pair.file_store=file;
        let mut observations=Vec::new();
        for world in 0..2 {
            let mut e=pair.engine(world);
            let read=e.query("gate",Context::new("alice",Default::default()).at(NOW)).unwrap();
            let write=e.mutate("attempt",None,Context::new("alice",Default::default()).at(NOW)).unwrap();
            assert!(read.complete && read.data==Value::Null);
            assert!(matches!(&write.state,WriteState::Failed{why,..} if why.code=="E_RULE"));
            observations.push(json!({"read":read,"write":write}));
        }
        assert_eq!(observations[0],observations[1]);
    }
}
