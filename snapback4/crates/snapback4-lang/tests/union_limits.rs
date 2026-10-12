//! The bounded union contract refuses expiry and acquisition windows before delivery.
// @ref LLP 3000.036.000.000#8 — direct and inherited scopes are horizon-free and non-expiring.
use snapback4_core::schema::{self, Audience, Horizon};

fn compile(source: &str) -> snapback4_lang::Bound {
    snapback4_lang::compile(&[("schema.q".into(), source.into())])
}
fn clean(source: &str) -> snapback4_lang::Bound {
    let b = compile(source);
    assert!(b.diagnostics.is_empty(), "{source}\n{:?}", b.diagnostics);
    b
}
fn repair(source: &str, sync_line: &str, why: &str) {
    let b = compile(source);
    let ds: Vec<_> = b.diagnostics.iter().filter(|d| d.code == "E_SYNC").collect();
    assert_eq!(ds.len(), 1, "{:?}", b.diagnostics);
    let d = ds[0];
    assert!(d.message.contains(why), "{d:?}");
    assert_eq!(d.guide, "sharing");
    assert!(d.rewrite.starts_with("online only"), "{d:?}");
    // Replace the actual sync line, retaining the read rule, expiry and queries.
    let (prefix, suffix) = source.rsplit_once(sync_line).expect("content sync line");
    let repaired = format!("{prefix}  {}\n{suffix}", d.rewrite);
    assert_ne!(repaired, source);
    clean(&repaired);
}

const GROUP: &str = "table members:\n  team: text <=20\n  person: principal\n  unique team, person\n  immutable team, person\n  read <- .person = viewer\n  insert <- exists members[.team, viewer]\n  delete <- .person = viewer\n  sync\ntable notes:\n  owner: principal\n  team: text <=20\n  until: time\n  at: time\n  read <- .owner = viewer or exists members[.team, viewer]\n  insert <- .owner = viewer\n  sync\n";

#[test]
fn expired_content_then_join_then_sweep_is_refused_before_a_device_can_learn_its_id() {
    // Round 10 reproduced this admitted source: a row expires at 2,000;
    // Alice joins at 3,000 and sees no row in the snapshot; sweep at 4,000
    // nevertheless sent her its id. Both windowed and full unions now refuse.
    clean(GROUP);
    for window in ["", " last 1 by .at"] {
        let base = GROUP.replace("  until: time\n", "  until: time\n  expire at .until\n");
        let (prefix, suffix) = base.rsplit_once("  sync\n").unwrap();
        let source = format!("{prefix}  sync{window}\n{suffix}");
        let b = compile(&source);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_SYNC" &&
            (d.message.contains("union audiences cannot expire") || d.message.contains("union audiences cannot have"))), "{:?}", b.diagnostics);
        let (prefix, suffix) = source.rsplit_once(&format!("  sync{window}\n")).unwrap();
        let repaired = format!("{prefix}  online only\n{suffix}");
        clean(&repaired);
        if !window.is_empty() {
            let without_window = format!("{prefix}  sync\n{suffix}");
            let again = compile(&without_window);
            assert!(again.diagnostics.iter().any(|d| d.code == "E_SYNC" && d.message.contains("cannot expire: notes")), "{:?}", again.diagnostics);
            assert!(b.diagnostics.iter().find(|d| d.code == "E_SYNC").unwrap().rewrite.contains("when no other excluded"));
        }
    }
    let source = GROUP.replace("  until: time\n", "  until: time\n  expire at .until\n");
    // Replace only the content table's line; the membership still syncs.
    repair(&source.replace("  sync\ntable notes", "  sync to .person\ntable notes"), "  sync\n", "cannot expire: notes");
    let mut core = clean(GROUP).schema;
    core.tables.get_mut("notes").unwrap().expire = Some("until".into());
    assert!(schema::validate(&core).iter().any(|i| i.message.contains("union audiences cannot expire")));
}

#[test]
fn every_union_arm_window_is_refused_even_in_hand_built_schemas() {
    let mut core = clean(GROUP).schema;
    let sync = core.tables.get_mut("notes").unwrap().sync.as_mut().unwrap();
    assert!(matches!(sync.audience, Audience::Target { .. }));
    sync.also[0].horizon = Some(Horizon { last: 1, by: "byId".into() });
    let issues = schema::validate(&core);
    let d = issues.iter().find(|i| i.message.contains("union audiences cannot have")).unwrap();
    assert!(!d.message.contains("last 1 by byId") && d.message.contains("when no other excluded"), "{d:?}");
    for window in ["last 1 by .at", "last 1 by byId"] {
        let source = GROUP.replace("  sync\ntable notes", "  sync to .person\ntable notes")
            .replace("  sync\n", &format!("  sync {window}\n"));
        repair(&source, &format!("  sync {window}\n"), "union audiences cannot have");
        clean(&source.replace(&format!("sync {window}"), "sync"));
    }
}

#[test]
fn windowed_membership_scope_and_its_ancestors_are_refused_with_compiling_repairs() {
    let direct = GROUP.replace("  person: principal\n", "  person: principal\n  at: time\n")
        .replace("  sync\ntable notes", "  sync last 2 by .at\ntable notes");
    repair(&direct, "  sync\n", "windowed scope members");
    let core = clean(GROUP).schema;
    let mut windowed = core.clone();
    windowed.tables.get_mut("members").unwrap().sync.as_mut().unwrap().horizon = Some(Horizon { last: 2, by: "byId".into() });
    assert!(schema::validate(&windowed).iter().any(|i| i.message.contains("windowed scope members")));

    let inherited = "table roots:\n  owner: principal\n  at: time\n  immutable owner\n  read <- .owner = viewer\n  sync last 2 by .at\ntable staff:\n  parent: roots\n  principal: principal\n  immutable parent, principal\n  unique principal\n  read through .parent\n  insert <- exists staff[viewer]\n  sync\ntable notes:\n  owner: principal\n  read <- .owner = viewer or exists staff[viewer]\n  insert <- .owner = viewer\n  sync\n";
    clean(&inherited.replace(".owner = viewer or exists staff[viewer]", "exists staff[viewer]"));
    repair(inherited, "  sync\n", "windowed scope roots");
    let mut schema = clean(&inherited.replace("  sync last 2 by .at", "  sync")).schema;
    schema.tables.get_mut("roots").unwrap().sync.as_mut().unwrap().horizon = Some(Horizon { last: 2, by: "byId".into() });
    assert!(schema::validate(&schema).iter().any(|i| i.message.contains("windowed scope roots")));
}

#[test]
fn pure_column_expiry_is_refused_and_horizon_advice_offers_no_refused_window() {
    let plain = "table orders:\n  buyer: principal\n  seller: principal\n  until: time\n  read <- .buyer = viewer or .seller = viewer\n  insert <- .buyer = viewer\n  sync\n";
    let b = clean(plain);
    let note = b.notes.iter().find(|d| d.code == "N_NO_HORIZON").expect("full replica cost is visible");
    assert!(note.rewrite.starts_with("online only") && !note.rewrite.contains("last 500"), "{note:?}");
    let expiring = plain.replace("  until: time\n", "  until: time\n  expire at .until\n");
    repair(&expiring, "  sync\n", "cannot expire: orders");
}
