//! Generated rollback source still participates in the ordinary intent campaign.
// @ref LLP 3000.000.000.002#8-wave-21-release-evolution — a bridge retains target rules and intent.
// @ref LLP 3000.036.004#15-sec6-write-boundaries-returned-privacy-and-deployment-review — creation and typed results remain observed.
use snapback4_lang::{
    compile, release_bridge,
    security::challenges::{self, Campaign},
};

#[test]
fn renamed_loosened_bridge_preserves_privacy_and_challenges_creation() {
    for guarded in [true, false] {
        let insert = if guarded { ".owner = viewer" } else { "allow" };
        let target = format!("table docs:\n  owner: principal\n  secret: text <=40 read <- .owner = viewer\n  read <- allow\n  insert <- {insert}\n  online only\nmutation create(owner: principal, secret: text <=40):\n  return insert docs {{owner,secret}}\nquery list():\n  return docs first 10 by .id\ninvariant docs.secret write only .owner = viewer\ninvariant docs.secret read only .owner = viewer\n");
        let current = target
            .replace("table docs:", "table records renamed from docs:")
            .replace("docs", "records")
            .replace("renamed from records", "renamed from docs")
            .replace("secret: text <=40 read", "secret: text <=80 ? read");
        let bridge = release_bridge::loosen(
            &[("schema.q".into(), target)],
            &[("schema.q".into(), current)],
        );
        assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
        let text = &bridge.sources[0].1;
        assert!(text.contains("read <- .owner = viewer"), "{text}");
        assert!(
            text.contains("invariant docs.secret write only (.owner = viewer)"),
            "{text}"
        );
        assert!(
            text.contains("invariant docs.secret read only (.owner = viewer)"),
            "{text}"
        );
        let bound = compile(&bridge.sources);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut campaign = Campaign::default();
        challenges::generated_campaign(&bound, &mut campaign, true);
        let reachable: Vec<_> = campaign
            .violations
            .iter()
            .filter(|v| v.reachability.is_reachable())
            .collect();
        assert!(
            reachable
                .iter()
                .all(|v| v.effect != "mutation result" && v.effect != "read"),
            "{campaign:?}"
        );
        assert_eq!(
            reachable.iter().any(|v| v.effect == "insert"),
            !guarded,
            "{campaign:?}"
        );
    }
}

#[test]
fn bridge_recognizes_references_to_a_renamed_parent_as_the_same_identity() {
    let target = "table parents:\n  label: text <=40\n  public\n  online only\ntable docs:\n  parent: parents on delete restrict\n  public\n  online only\nquery list():\n  return docs first 10 by .id\n";
    let current = target
        .replace("parents", "guardians")
        .replace("table guardians:", "table guardians renamed from parents:");
    let bridge = release_bridge::loosen(
        &[("schema.q".into(), target.into())],
        &[("schema.q".into(), current)],
    );
    assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
    assert!(
        !bridge
            .changes
            .iter()
            .any(|line| line.contains("docs.parent: incompatible")),
        "{:?}",
        bridge.changes
    );
    assert!(bridge.sources[0]
        .1
        .contains("parent: parents on delete restrict"));
    let independent = target.replace("parents", "guardians");
    let bridge = release_bridge::loosen(
        &[("schema.q".into(), target.into())],
        &[("schema.q".into(), independent)],
    );
    assert!(
        bridge.diagnostics.iter().any(|d| d
            .message
            .contains("incompatible predecessor/current domains")),
        "independent identities must refuse typed adaptation: {:?}",
        bridge.diagnostics
    );
}

#[test]
fn renamed_newer_table_is_retained_once_when_target_predates_it() {
    let target = "table roots:\n  value: text <=40\n  public\n  online only\n";
    let current=format!("{target}table guardians renamed from parents:\n  owner: principal\n  public\n  online only\n");
    let bridge = release_bridge::loosen(
        &[("schema.q".into(), target.into())],
        &[("schema.q".into(), current)],
    );
    assert!(
        bridge.diagnostics.is_empty(),
        "{:?}\n{:?}",
        bridge.diagnostics,
        bridge.sources
    );
    assert_eq!(
        bridge
            .sources
            .iter()
            .map(|(_, s)| s.matches("table guardians ").count())
            .sum::<usize>(),
        1
    );
}

#[test]
fn retained_child_references_and_rule_probes_follow_selected_parent_spelling() {
    let target = "table parents:\n  owner: principal\n  read <- .owner = viewer\n  online only\n";
    let current=format!("{}table children:\n  parent: guardians on delete restrict\n  guardians: text <=40 default 'guardians'\n  read <- exists guardians[.parent, owner = viewer]\n  insert <- exists guardians[.parent, owner = viewer]\n  online only\n",target.replace("table parents:","table guardians renamed from parents:"));
    let checked = compile(&[("schema.q".into(), current.clone())]);
    assert!(checked.diagnostics.is_empty(), "{:?}", checked.diagnostics);
    let bridge = release_bridge::loosen(
        &[("schema.q".into(), target.into())],
        &[("schema.q".into(), current)],
    );
    assert!(
        bridge.diagnostics.is_empty(),
        "{:?}\n{:?}",
        bridge.diagnostics,
        bridge.sources
    );
    let child = &bridge
        .sources
        .iter()
        .find(|(_, s)| s.contains("table children:"))
        .unwrap()
        .1;
    assert!(
        child.contains("parent: parents on delete restrict"),
        "{child}"
    );
    assert!(
        child.contains("exists parents[.parent, owner = viewer]"),
        "{child}"
    );
    assert!(
        child.contains("guardians: text <=40 default 'guardians'"),
        "column names and literals are not table references: {child}"
    );
}

#[test]
fn continued_sync_target_keeps_the_selected_parent_identity() {
    let target="table parents:\n  groupId: text <=40\n  principal: principal\n  unique groupId, principal\n  read <- .principal = viewer\n  sync to .principal\n";
    let current=format!("{}table children:\n  groupId: text <=40\n  owner: principal\n  read <- .owner = viewer or exists guardians[.groupId, viewer]\n  sync to .owner\n    or guardians[.groupId]\n",target.replace("table parents:","table guardians renamed from parents:"));
    let checked = compile(&[("schema.q".into(), current.clone())]);
    assert!(checked.diagnostics.is_empty(), "{:?}", checked.diagnostics);
    let bridge = release_bridge::loosen(
        &[("schema.q".into(), target.into())],
        &[("schema.q".into(), current)],
    );
    assert!(
        bridge.diagnostics.is_empty(),
        "{:?}\n{:?}",
        bridge.diagnostics,
        bridge.sources
    );
    let child = &bridge
        .sources
        .iter()
        .find(|(_, s)| s.contains("table children:"))
        .unwrap()
        .1;
    assert!(child.contains("or parents[.groupId]"), "{child}");
}

#[test]
fn generated_view_cannot_restore_a_write_forbidden_by_current_intent() {
    let old = "table docs:\n  owner: principal\n  secret: text <=40 read <- .owner = viewer\n  read <- allow\n  insert <- allow\n  online only\nmutation create(owner: principal, secret: text <=40):\n  return insert docs {owner,secret}\n";
    let intent = "invariant docs.secret write only .owner = viewer\n";
    for already_declared in [false, true] {
        let predecessor = format!("{old}{}", if already_declared { intent } else { "" });
        let current = format!(
            "{}{intent}",
            old.replace("  secret: text <=40 read", "  secret: text <=80 ? read")
                .replace("{owner,secret}", "{owner:viewer,secret}")
        );
        let current_bound = compile(&[("schema.q".into(), current.clone())]);
        assert!(
            current_bound.diagnostics.is_empty(),
            "{:?}",
            current_bound.diagnostics
        );
        let mut current_campaign = Campaign::default();
        challenges::generated_campaign(&current_bound, &mut current_campaign, true);
        assert!(
            current_campaign
                .violations
                .iter()
                .all(|v| !v.reachability.is_reachable()),
            "current authored workflow is the safe control: {current_campaign:?}"
        );
        let bridge = release_bridge::loosen(
            &[("schema.q".into(), predecessor)],
            &[("schema.q".into(), current)],
        );
        assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
        // Analyze the generated executable against the current independent
        // specification even when a defective bridge omitted that declaration.
        let mut probe = bridge.sources.clone();
        if !probe.iter().any(|(_, s)| s.contains(intent.trim())) {
            probe.push(("current-intent-probe.q".into(), intent.into()));
        }
        let bound = compile(&probe);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut campaign = Campaign::default();
        challenges::generated_campaign(&bound, &mut campaign, true);
        assert!(campaign.violations.iter().all(|v|!v.reachability.is_reachable()),"registered old write must not reopen the current intent violation (already declared={already_declared}): {campaign:?}");
        assert!(
            bridge
                .sources
                .iter()
                .any(|(_, s)| s.contains(intent.trim())),
            "current independent intent remains in the generated source"
        );
    }
}

#[test]
fn independent_intent_keeps_current_helpers_defaults_and_complete_workflows() {
    let old="table docs:\n  owner: principal\n  secret: text <=40\n  public\n  online only\nfn owner(value: principal): value\nmutation create(value: principal, secret: text <=40):\n  return insert docs {owner:owner(value),secret}\n";
    let current = old
        .replace("secret: text <=40", "secret: text <=80")
        .replace(
            "fn owner(value: principal): value",
            "fn owner(value: principal): viewer",
        )
        + "invariant docs.secret write only .owner = viewer\n";
    let sources = vec![("schema.q".into(), current)];
    let checked = compile(&sources);
    assert!(checked.diagnostics.is_empty(), "{:?}", checked.diagnostics);
    let bridge = release_bridge::loosen(&[("schema.q".into(), old.into())], &sources);
    assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
    assert_eq!(bridge.sources,sources,"all transitive current meanings survive; widened same-format inputs admit the old wire domain");
}

#[test]
fn independent_intent_refuses_missing_old_fields_operations_and_narrowed_inputs() {
    let old="table docs:\n  owner: principal\n  secret: text <=40\n  public\n  online only\nmutation create(owner: principal, secret: text <=40):\n  return insert docs {owner,secret}\n";
    let next = format!(
        "{}invariant docs.secret write only .owner = viewer\n",
        old.replace("{owner,secret}", "{owner:viewer,secret}")
    );
    for current in [
        next.replace("secret: text <=40):", "secret: text <=20):"),
        next.replace("mutation create(", "mutation other("),
        next.replace("  owner: principal\n", "  author: principal\n")
            .replace("{owner:viewer,secret}", "{author:viewer,secret}")
            .replace(".owner = viewer", ".author = viewer"),
    ] {
        let checked = compile(&[("schema.q".into(), current.clone())]);
        assert!(checked.diagnostics.is_empty(), "{:?}", checked.diagnostics);
        let bridge = release_bridge::loosen(
            &[("schema.q".into(), old.into())],
            &[("schema.q".into(), current)],
        );
        assert!(
            bridge
                .diagnostics
                .iter()
                .any(|d| d.message.contains("current independent intent")),
            "{:?}",
            bridge.diagnostics
        );
    }
}

#[test]
fn intent_rename_does_not_rewrite_business_strings_and_refuses_name_capture() {
    let old="table docs:\n  owner: principal\n  secret: text <=40\n  public\n  online only\nmutation create(owner: principal, secret: text <=40):\n  return insert docs {owner,secret}\n";
    let current = format!(
        "{}invariant records.secret write only .owner = viewer\n",
        old.replace("table docs:", "table records renamed from docs:")
            .replace(
                "insert docs {owner,secret}",
                "insert records {owner:viewer,secret:'records'}"
            )
            .replace("  secret: text <=40", "  secret: text <=80")
    );
    let sources = vec![("schema.q".into(), current.clone())];
    assert!(compile(&sources).diagnostics.is_empty());
    let bridge = release_bridge::loosen(&[("schema.q".into(), old.into())], &sources);
    assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
    assert!(bridge.sources[0].1.contains("secret:'records'"));
    assert!(bridge.sources[0].1.contains("insert docs {owner:viewer"));
    let captured = current.replace(
        "  return insert records",
        "  docs = 'unused'\n  return insert records",
    );
    let checked = compile(&[("schema.q".into(), captured.clone())]);
    assert!(checked.diagnostics.is_empty(), "{:?}", checked.diagnostics);
    let bridge = release_bridge::loosen(
        &[("schema.q".into(), old.into())],
        &[("schema.q".into(), captured)],
    );
    assert!(
        bridge
            .diagnostics
            .iter()
            .any(|d| d.message.contains("captures")),
        "{:?}",
        bridge.diagnostics
    );
}

#[test]
fn current_closure_accepts_list_interval_inclusion_and_new_optional_arguments() {
    let old="table docs:\n  owner: principal\n  secret: text <=40\n  public\n  online only\nmutation create(owner: principal, parts: [text <=40] 1..4):\n  return insert docs {owner,secret:'x'}\n";
    let next = format!(
        "{}invariant docs.secret write only .owner = viewer\n",
        old.replace(
            "parts: [text <=40] 1..4",
            "parts: [text <=80] 0..8, cursor: cursor ?"
        )
        .replace("{owner,secret:'x'}", "{owner:viewer,secret:'x'}")
    );
    let sources = vec![("schema.q".into(), next.clone())];
    assert!(compile(&sources).diagnostics.is_empty());
    let bridge = release_bridge::loosen(&[("schema.q".into(), old.into())], &sources);
    assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
    assert_eq!(bridge.sources, sources);
    for narrowed in [
        next.replace("0..8", "2..8"),
        next.replace("[text <=80]", "[text <=20]"),
        next.replace("cursor: cursor ?", "cursor: cursor"),
    ] {
        let bridge = release_bridge::loosen(
            &[("schema.q".into(), old.into())],
            &[("schema.q".into(), narrowed)],
        );
        assert!(!bridge.diagnostics.is_empty());
    }
}

#[test]
fn a_literal_only_policy_repair_registers_a_view_without_any_domain_widening() {
    let old="table docs:\n  owner: principal\n  secret: text <=40\n  public\n  online only\nmutation create(owner: principal, secret: text <=40):\n  return insert docs {owner,secret}\ninvariant docs.secret write only .owner = viewer\n";
    let current=old.replace("{owner,secret}","{owner:viewer,secret}");
    let before=vec![("schema.q".into(),old.into())];let after=vec![("schema.q".into(),current)];
    assert!(release_bridge::requires_view(&before,&after));
    assert!(!release_bridge::requires_view(&after,&after));
    let renamed_file=vec![("another-path.q".into(),after[0].1.clone())];
    assert!(!release_bridge::requires_view(&after,&renamed_file));
    let bridge=release_bridge::loosen(&before,&after);assert!(bridge.diagnostics.is_empty());assert_eq!(bridge.sources,after);
}
