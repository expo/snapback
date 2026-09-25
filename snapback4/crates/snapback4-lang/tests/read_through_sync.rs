use snapback4_core::schema::{Audience, Sync};
fn bound(source:&str)->snapback4_lang::Bound {
    let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b
}
const MODEL:&str="table parents:\n  owner: principal\n  archived: bool\n  immutable owner, archived\n  read <- .owner = viewer\n  sync last 10 by .id\ntable children:\n  parent: parents\n  immutable parent\n  read through .parent\n  sync last 10 by .id\nquery page(p: parents):\n  children where .parent = p first 10 by .id\n";
#[test]fn exact_audiences_and_service_strip(){
    for rule in [".owner = viewer",".owner = viewer or viewer = 'service:search'"] {
        let b=bound(&MODEL.replace(".owner = viewer",rule));
        assert_eq!(b.schema.tables["children"].sync.as_ref().unwrap().audience,Audience::Column("$parent.owner".into()));
        let child=&b.schema.tables["children"];assert!(child.indexes[&child.sync.as_ref().unwrap().horizon.as_ref().unwrap().by].columns().starts_with(&["$parent.owner".into()]));
    }
    let b=bound(&MODEL.replace(".owner = viewer","allow"));
    assert_eq!(b.schema.tables["children"].sync.as_ref().unwrap().audience,Audience::Public);
}
#[test]fn narrower_rules_remain_server_read_and_mismatched_declarations_refuse(){
    let source=MODEL.replace(".owner = viewer",".owner = viewer and not .archived");
    let refused=snapback4_lang::compile(&[("bad.q".into(),source.clone())]);
    assert!(refused.diagnostics.iter().any(|d|d.code=="E_SYNC"&&d.rewrite.contains("online only")),"{:?}",refused.diagnostics);
    let b=bound(&source.replace("  sync last 10 by .id","  online only"));
    assert_eq!(b.schema.operations["page"].runs.as_deref(),Some("server"));
    assert!(b.schema.operations["page"].sites.iter().any(|s|s.reason.contains("online only")));
    let b=snapback4_lang::compile(&[("bad.q".into(),MODEL.replace("read through .parent\n  sync last 10 by .id","read through .parent\n  sync public"))]);
    assert!(b.diagnostics.iter().any(|d|d.code=="E_SYNC"),"{:?}",b.diagnostics);
    let mut b=bound(&MODEL.replace(".owner = viewer","allow"));
    b.schema.tables.get_mut("children").unwrap().sync=Some(Sync{audience:Audience::Column("$parent.owner".into()),horizon:None});
    assert!(snapback4_core::schema::validate(&b.schema).iter().any(|d|d.message.contains("exactly equal")));
}
#[test]fn capture_alias_inherits_exact_sync_without_aggregate_read_rule(){
    let b=bound(include_str!("fixtures/read-through-clique.q"));
    assert_eq!(b.schema.tables["unread"].sync.as_ref().unwrap().audience,Audience::Target{table:"members".into(),prefix:vec!["chat".into()],principal:"principal".into()});
    assert_eq!(b.schema.tables["unread"].rules.read.quarry(),"exists members[.chat, viewer]");
    let m=b.schema.maintain_for("unread").unwrap();assert_eq!(m.aliases["chat"],"$message.chat");
    let mut bad=b.schema.clone();bad.tables.get_mut("unread").unwrap().sync.as_mut().unwrap().audience=Audience::Public;
    assert!(snapback4_core::schema::validate(&bad).iter().any(|d|d.message.contains("syncs to an audience")));
}
#[test]fn grant_guard_stays_required_through_every_level(){
    let source=include_str!("fixtures/read-through-device.q").replace(".principal = viewer and (created orgs[.org] or exists members[.org, viewer])",".principal = viewer");
    let b=snapback4_lang::compile(&[("bad.q".into(),source)]);
    for child in ["projects","tasks","comments"] {assert!(b.diagnostics.iter().any(|d|d.code=="E_SYNC"&&d.message.contains(&format!("private audience of {child}"))&&d.message.contains("grant probe")),"{:?}",b.diagnostics);}
}

#[test]fn delivered_history_reserves_its_marker_without_changing_ordinary_fields(){
    let source=MODEL.replace("table children:","table children:\n  retain delivered-history\n  retained: bool");
    let b=snapback4_lang::compile(&[("bad.q".into(),source)]);
    assert!(b.diagnostics.iter().any(|d|d.code=="E_READ_THROUGH"&&d.rewrite.contains("wasRetained")),"{:?}",b.diagnostics);
    let b=bound(&MODEL.replace("table children:","table children:\n  retain delivered-history"));
    assert!(snapback4_lang::emit::typescript(&b).contains("retained?: boolean"));
    let mut raw=b.schema.clone();raw.tables.get_mut("children").unwrap().columns.insert("retained".into(),snapback4_core::schema::ColumnType::Bool);
    assert!(snapback4_core::schema::validate(&raw).iter().any(|d|d.message.contains("reserves retained")));
    bound(&MODEL.replace("table children:","table children:\n  retained: bool"));
    let old=MODEL.replace("table children:","table children:\n  retain delivered-history\n  retained: bool").replace("  sync last 10 by .id","  online only");
    let b=bound(&old);
    assert!(!snapback4_lang::emit::typescript(&b).contains("    retained?: boolean;"),"an existing server-only column keeps its required type");
}
