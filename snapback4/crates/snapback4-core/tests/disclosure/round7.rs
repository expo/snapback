//! Round 7: elapsed expiry, successful witnesses and successful expiring deletes.
use super::{Pair, Operation, authorization, inputs};
use serde_json::json;
use snapback4_core::{Context, Value, WriteState};

pub fn elapsed(observer: &str, query: &str, ordinary: bool, now: i64) -> Pair {
    let ownership = if ordinary { "" } else { " written by .owner" };
    let source = format!("table records:\n  owner: principal\n  secret: text <=1000000 default ''{ownership}\n  expires: time default 1500\n  expire at .expires\n  public\n  sync public\nquery observed():\n  return {query}\nmutation noop():\n  return true\n");
    let seeds = [0,1000000].map(|n| vec![("records".into(), json!({"id":"r","owner":observer,"secret":"x".repeat(n)}))]);
    Pair::new(source,seeds,observer,Operation::new("noop",json!({}),observer)).at(now)
}

pub fn witness(observer: &str, rule: &str, ordinary: bool) -> Pair {
    let mut pair = authorization::witness(observer,rule,true,"payload",1);
    if ordinary { pair.source = pair.source.replace(" written by .owner", ""); }
    for (world, rows) in pair.seeds.iter_mut().enumerate() {
        for (table,row) in rows {
            if table == "access" {
                row["approved"] = json!(true);
                row["expires"] = json!(10000 + world * 10000);
            }
        }
    }
    pair
}

pub fn delete(observer: &str, escaped: bool, token: bool, first: bool) -> Pair {
    let mut pair = authorization::shapes(observer,escaped,token);
    pair.source = pair.source.replace("  owner: principal\n", "  owner: principal\n  expires: time default 10000\n  expire at .expires\n");
    if first { pair.operations.remove(0); }
    pair
}

pub fn visit(send: &mut impl FnMut(String,Pair,bool)) {
    for observer in ["alice","bob","carol"] {
        for query in ["records first 20", "records first 20 { * }", "count(records)", "sum(records, 1)"] {
            for ordinary in [false,true] {
                for now in [1500,2000,20000] {
                    send(format!("round7/elapsed/{observer}/{query}/{ordinary}/{now}"),elapsed(observer,query,ordinary,now),false);
                }
            }
        }
        for rule in ["exists access[tag = 0, approved = true] or .reader = viewer",
            ".reader = viewer or exists access[tag = 0, approved = true]",
            "(exists access[tag = 0, approved = true] and .reader != viewer) or .reader = viewer"] {
            for ordinary in [false,true] {
                send(format!("round7/successful-witness/{observer}/{rule}/{ordinary}"),witness(observer,rule,ordinary),false);
            }
        }
        for (escaped,token) in [(false,false),(true,false),(false,true)] {
            for first in [false,true] {
                send(format!("round7/expiring-delete/{observer}/{escaped}/{token}/{first}"),delete(observer,escaped,token,first),false);
            }
        }
    }
}

#[test]
fn expired_owner_payload_pages_and_scalars() {
    for query in ["records first 20","count(records)"] {
        let mut pair = elapsed("alice",query,false,2000);
        // Expired cursor keys are internal too, even when their lengths differ.
        pair.seeds[1][0].1["id"] = json!("r".repeat(100));
        pair.assert_equal();
        for world in 0..2 {
            let out = pair.engine(world).query("observed",Context::new("alice",Default::default()).at(pair.now)).unwrap();
            assert!(out.complete,"{out:?}");
            assert_eq!(out.data,if query.starts_with("count") { Value::Int(0) } else { Value::Array(vec![]) });
        }
    }
}

#[test]
fn independent_grant_discards_successful_witness_expiry() {
    let pair = witness("alice","exists access[tag = 0, approved = true] or .reader = viewer",false);
    pair.assert_equal();
    for world in 0..2 {
        let mut e = pair.engine(world);
        let args = inputs(&e,"one",&json!({"id":"note"}));
        let out = e.query("one",Context::new("alice",args).at(pair.now)).unwrap();
        assert!(out.complete && out.data != Value::Null,"{out:?}");
        assert_eq!(out.next_expiry,None,"redundant witness: {out:?}");
    }
}

#[test]
fn necessary_witness_keeps_authorization_deadline() {
    let pair = witness("alice","exists access[tag = 0, approved = true]",false);
    for world in 0..2 {
        let mut e = pair.engine(world);
        let args = inputs(&e,"one",&json!({"id":"note"}));
        let until = 10000 + world as i64 * 10000;
        let out = e.query("one",Context::new("alice",args.clone()).at(pair.now)).unwrap();
        assert_eq!(out.next_expiry,Some(until));
        let out = e.query("one",Context::new("alice",args).at(until)).unwrap();
        assert!(out.complete && out.data == Value::Null,"{out:?}");
        assert_eq!(out.next_expiry,None);
    }
}

#[test]
fn successful_expiring_delete_does_not_price_raw_fields() {
    let pair = delete("alice",false,false,true);
    pair.assert_equal();
    for world in 0..2 {
        let mut e = pair.engine(world);
        let out = e.mutate("remove",None,Context::new("alice",Default::default()).at(pair.now)).unwrap();
        assert!(matches!(out.state,WriteState::Sent { .. }),"{out:?}");
    }
}

#[test]
fn public_nonexpiring_short_row_uses_authorized_actual_size() {
    let source = "table records:\n  body: text <=2000000\n  public\n  sync public\nquery one():\n  return records['r']\nmutation noop():\n  return true\n";
    let seeds = [0,1].map(|_|vec![("records".into(),json!({"id":"r","body":"hi"}))]);
    let pair = Pair::new(source,seeds,"alice",Operation::new("noop",json!({}),"alice"));
    let out = pair.engine(0).query("one",Context::new("alice",Default::default()).at(pair.now)).unwrap();
    assert!(out.complete,"a public short row needs no private decoder reservation: {out:?}");
    assert_eq!(out.data.field("body").unwrap(),&Value::String("hi".into()));
}

#[test]
fn expiring_aggregate_private_sibling_does_not_change_observations() {
    let source = "table records:\n  bucket: int\n  owner: principal\n  secret: text <=10000 default '' written by .owner\n  expires: time default 1500\n  expire at .expires\n  by byBucket: bucket\n  public\n  sync public\nmaintain totals: count records by bucket\n  read <- allow\nquery one():\n  return totals[0]\nmutation noop():\n  return true\n";
    let seeds = [0,10000].map(|n|vec![("records".into(),json!({"id":"r","bucket":0,"owner":"hidden","secret":"x".repeat(n)}))]);
    let pair = Pair::new(source,seeds,"alice",Operation::new("noop",json!({}),"alice")).at(2000);
    pair.assert_equal();
    for world in 0..2 {
        let out = pair.engine(world).query("one",Context::new("alice",Default::default()).at(pair.now)).unwrap();
        assert!(out.complete,"{out:?}");
    }
}

#[test]
fn round7_disk_sqlite_reopen() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../target/r7-disk-{}",std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    for (n,pair) in [elapsed("alice","records first 20",false,2000),elapsed("bob","count(records)",false,2000),
        witness("carol","exists access[tag = 0, approved = true] or .reader = viewer",false),delete("alice",false,false,true)].into_iter().enumerate() {
        let worlds = [0,1].map(|world| {
            let path = dir.join(format!("{n}-{world}.sqlite"));
            let mut e = pair.engine_in(world,snapback4_core::Store::open(&path).unwrap());
            let mut out = super::Transcript::new();
            super::observe_queries_at(&mut e,&pair.principal,&pair.queries,"before",&mut out,pair.now);
            for (i,op) in pair.operations.iter().enumerate() {
                let args = inputs(&e,&op.name,&op.args);
                out.insert(format!("write/{i}"),json!(e.mutate(&op.name,None,Context::new(&op.principal,args).at(pair.now)).unwrap()));
            }
            drop(e);
            let mut e = snapback4_core::Engine::open(snapback4_core::Store::open(&path).unwrap()).unwrap();
            super::observe_queries_at(&mut e,&pair.principal,&pair.queries,"reopen",&mut out,pair.now);
            out
        });
        assert_eq!(worlds[0],worlds[1],"disk case {n}");
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn two_finite_alternatives_keep_the_later_deadline() {
    let mut pair = witness("alice", "exists access[tag = 0, approved = true] or exists access[tag = 1, approved = true]", false);
    // The old single nonunique probe could choose different witnesses on
    // replicas. It is now a source refusal, not an expiry contract.
    let tied = pair.source.replace("exists access[tag = 0, approved = true] or exists access[tag = 1, approved = true]", "exists access[tag = 0, approved = true]")
        .replace("unique tag", "by byTag: tag, approved");
    let bound = crate::generated::runtime_compile(&[("schema.q".into(), tied)]);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_POINT_KEY"), "{:?}", bound.diagnostics);
    for seed in &mut pair.seeds {
        let mut later = seed.iter().find(|(table,_)|table == "access").unwrap().clone();
        later.1["id"] = json!("later"); later.1["tag"] = json!(1); later.1["expires"] = json!(20000);
        seed.iter_mut().find(|(table,_)|table == "access").unwrap().1["expires"] = json!(10000);
        seed.push(later);
    }
    pair.assert_equal();
    for world in 0..2 {
        let mut e=pair.engine(world);
        let out=e.query("one",Context::new("alice",inputs(&e,"one",&json!({"id":"note"}))).at(pair.now)).unwrap();
        assert_eq!(out.next_expiry,Some(20000));
    }
}

#[test]
fn public_wide_declarations_admit_short_writes_and_exists() {
    let source="table notes:\n  body: text <=2000000\n  label: int default 0\n  public\n  update <- allow\n  sync public\ntable gates:\n  note: notes\n  read <- exists notes[id = .note]\n  online only\nquery probe():\n  return gates['g']\nquery one():\n  return notes['r']\nmutation edit(id: notes):\n  update notes[id] { body: 'hi' }\nmutation label(id: notes):\n  update notes[id] { label: 1 }\n";
    let seeds=[0,1].map(|_|vec![("notes".into(),json!({"id":"r","body":"hi","label":0})),("gates".into(),json!({"id":"g","note":"r"}))]);
    let pair=Pair::new(source,seeds,"alice",Operation::new("edit",json!({"id":"r"}),"alice"))
        .then(Operation::new("label",json!({"id":"r"}),"alice")).query("probe",json!({})).query("one",json!({}));
    pair.assert_equal();
    for world in 0..2 {
        let mut e=pair.engine(world);
        for op in &pair.operations {
            let out=e.mutate(&op.name,None,Context::new("alice",inputs(&e,&op.name,&op.args)).at(pair.now)).unwrap();
            assert!(matches!(out.state,WriteState::Sent{..}),"{}: {out:?}",op.name);
        }
        let out=e.query("probe",Context::new("alice",Default::default()).at(pair.now)).unwrap();
        assert!(out.complete && out.data!=Value::Null,"{out:?}");
    }
}
