//! Generated rollback source still participates in the ordinary intent campaign.
// @ref LLP 3000.000.000.002#8-wave-21-release-evolution — a bridge retains target rules and intent.
// @ref LLP 3000.036.004#15-sec6-write-boundaries-returned-privacy-and-deployment-review — creation and typed results remain observed.
use snapback4_lang::{compile, release_bridge, security::challenges::{self, Campaign}};

#[test]
fn renamed_loosened_bridge_preserves_privacy_and_challenges_creation() {
    for guarded in [true, false] {
        let insert = if guarded { ".owner = viewer" } else { "allow" };
        let target = format!("table docs:\n  owner: principal\n  secret: text <=40 read <- .owner = viewer\n  read <- allow\n  insert <- {insert}\n  online only\nmutation create(owner: principal, secret: text <=40):\n  return insert docs {{owner,secret}}\nquery list():\n  return docs first 10 by .id\ninvariant docs.secret write only .owner = viewer\ninvariant docs.secret read only .owner = viewer\n");
        let current = target.replace("table docs:", "table records renamed from docs:")
            .replace("docs", "records").replace("renamed from records", "renamed from docs")
            .replace("secret: text <=40 read", "secret: text <=80 ? read");
        let bridge = release_bridge::loosen(&[("schema.q".into(), target)], &[("schema.q".into(), current)]);
        assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
        let text = &bridge.sources[0].1;
        assert!(text.contains("read <- .owner = viewer"), "{text}");
        assert!(text.contains("invariant docs.secret write only .owner = viewer"), "{text}");
        assert!(text.contains("invariant docs.secret read only .owner = viewer"), "{text}");
        let bound = compile(&bridge.sources);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut campaign = Campaign::default();
        challenges::generated_campaign(&bound, &mut campaign, true);
        let reachable: Vec<_> = campaign.violations.iter().filter(|v| v.reachability.is_reachable()).collect();
        assert!(reachable.iter().all(|v| v.effect != "mutation result" && v.effect != "read"), "{campaign:?}");
        assert_eq!(reachable.iter().any(|v| v.effect == "insert"), !guarded, "{campaign:?}");
    }
}

#[test]
fn bridge_recognizes_references_to_a_renamed_parent_as_the_same_identity() {
    let target = "table parents:\n  label: text <=40\n  public\n  online only\ntable docs:\n  parent: parents on delete restrict\n  public\n  online only\nquery list():\n  return docs first 10 by .id\n";
    let current = target.replace("parents", "guardians")
        .replace("table guardians:", "table guardians renamed from parents:");
    let bridge = release_bridge::loosen(&[("schema.q".into(), target.into())], &[("schema.q".into(), current)]);
    assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
    assert!(!bridge.changes.iter().any(|line| line.contains("docs.parent: incompatible")), "{:?}", bridge.changes);
    assert!(bridge.sources[0].1.contains("parent: parents on delete restrict"));
    let independent = target.replace("parents", "guardians");
    let bridge = release_bridge::loosen(&[("schema.q".into(), target.into())], &[("schema.q".into(), independent)]);
    assert!(bridge.diagnostics.iter().any(|d|d.message.contains("incompatible predecessor/current domains")),"independent identities must refuse typed adaptation: {:?}",bridge.diagnostics);
}

#[test]
fn renamed_newer_table_is_retained_once_when_target_predates_it() {
    let target="table roots:\n  value: text <=40\n  public\n  online only\n";
    let current=format!("{target}table guardians renamed from parents:\n  owner: principal\n  public\n  online only\n");
    let bridge=release_bridge::loosen(&[("schema.q".into(),target.into())],&[("schema.q".into(),current)]);
    assert!(bridge.diagnostics.is_empty(),"{:?}\n{:?}",bridge.diagnostics,bridge.sources);
    assert_eq!(bridge.sources.iter().map(|(_,s)|s.matches("table guardians ").count()).sum::<usize>(),1);
}

#[test]
fn retained_child_references_and_rule_probes_follow_selected_parent_spelling() {
    let target="table parents:\n  owner: principal\n  read <- .owner = viewer\n  online only\n";
    let current=format!("{}table children:\n  parent: guardians on delete restrict\n  guardians: text <=40 default 'guardians'\n  read <- exists guardians[.parent, owner = viewer]\n  insert <- exists guardians[.parent, owner = viewer]\n  online only\n",target.replace("table parents:","table guardians renamed from parents:"));
    let checked=compile(&[("schema.q".into(),current.clone())]);assert!(checked.diagnostics.is_empty(),"{:?}",checked.diagnostics);
    let bridge=release_bridge::loosen(&[("schema.q".into(),target.into())],&[("schema.q".into(),current)]);
    assert!(bridge.diagnostics.is_empty(),"{:?}\n{:?}",bridge.diagnostics,bridge.sources);
    let child=&bridge.sources.iter().find(|(_,s)|s.contains("table children:")).unwrap().1;
    assert!(child.contains("parent: parents on delete restrict"),"{child}");
    assert!(child.contains("exists parents[.parent, owner = viewer]"),"{child}");
    assert!(child.contains("guardians: text <=40 default 'guardians'"),"column names and literals are not table references: {child}");
}

#[test]
fn continued_sync_target_keeps_the_selected_parent_identity() {
    let target="table parents:\n  groupId: text <=40\n  principal: principal\n  unique groupId, principal\n  read <- .principal = viewer\n  sync to .principal\n";
    let current=format!("{}table children:\n  groupId: text <=40\n  owner: principal\n  read <- .owner = viewer or exists guardians[.groupId, viewer]\n  sync to .owner\n    or guardians[.groupId]\n",target.replace("table parents:","table guardians renamed from parents:"));
    let checked=compile(&[("schema.q".into(),current.clone())]);assert!(checked.diagnostics.is_empty(),"{:?}",checked.diagnostics);
    let bridge=release_bridge::loosen(&[("schema.q".into(),target.into())],&[("schema.q".into(),current)]);
    assert!(bridge.diagnostics.is_empty(),"{:?}\n{:?}",bridge.diagnostics,bridge.sources);
    let child=&bridge.sources.iter().find(|(_,s)|s.contains("table children:")).unwrap().1;
    assert!(child.contains("or parents[.groupId]"),"{child}");
}
