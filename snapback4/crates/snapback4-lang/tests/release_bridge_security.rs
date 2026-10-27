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
fn independent_intent_refuses_required_field_gaps_and_narrowed_inputs() {
    let old="table docs:\n  owner: principal\n  secret: text <=40\n  public\n  online only\nmutation create(owner: principal, secret: text <=40):\n  return insert docs {owner,secret}\n";
    let next = format!(
        "{}invariant docs.secret write only .owner = viewer\n",
        old.replace("{owner,secret}", "{owner:viewer,secret}")
    );
    for current in [
        next.replace("secret: text <=40):", "secret: text <=20):"),
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
        if bridge.diagnostics.is_empty(){assert!(!compile(&bridge.sources).programs.iter().any(|p|p.program.name=="create"));}
        else {assert!(bridge.diagnostics.iter().any(|d|d.message.contains("current independent intent")),"{:?}",bridge.diagnostics);}
    }
}

#[test]
fn intent_rename_edits_typed_slots_without_capturing_locals_or_business_strings() {
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
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    assert!(bridge.sources[0].1.contains("docs = 'unused'"));
    assert!(bridge.sources[0].1.contains("insert docs {owner:viewer"));

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
        assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
        assert!(!compile(&bridge.sources).programs.iter().any(|p|p.program.name=="create"));
    }
}

#[test]
fn a_literal_only_policy_repair_registers_a_view_without_any_domain_widening() {
    let old="table docs:\n  owner: principal\n  secret: text <=40\n  public\n  online only\nmutation create(owner: principal, secret: text <=40):\n  return insert docs {owner,secret}\ninvariant docs.secret write only .owner = viewer\n";
    let current = old.replace("{owner,secret}", "{owner:viewer,secret}");
    let before = vec![("schema.q".into(), old.into())];
    let after = vec![("schema.q".into(), current)];
    assert!(release_bridge::requires_view(&before, &after));
    assert!(!release_bridge::requires_view(&after, &after));
    let renamed_file = vec![("relocated/schema.q".into(), after[0].1.clone())];
    assert!(!release_bridge::requires_view(&after, &renamed_file));
    let bridge = release_bridge::loosen(&before, &after);
    assert!(bridge.diagnostics.is_empty());
    assert_eq!(bridge.sources, after);
}

#[test]
fn typed_identity_rename_retains_new_argument_alias_metadata() {
    let old="table docs:\n  owner: principal\n  public\n  online only\nquery one(id: docs):\n  return docs[id]\n";
    let next = old
        .replace("table docs:", "table records renamed from docs:")
        .replace("id: docs", "id: records alias legacyId")
        .replace("return docs[id]", "return records[id]")
        + "invariant records.read only true\n";
    let sources = vec![("schema.q".into(), next)];
    assert!(compile(&sources).diagnostics.is_empty());
    let bridge = release_bridge::loosen(&[("schema.q".into(), old.into())], &sources);
    assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
    let bound = compile(&bridge.sources);
    let p = &bound
        .programs
        .iter()
        .find(|p| p.program.name == "one")
        .unwrap()
        .program;
    assert_eq!(p.argument("legacyId").map(|(name, _)| name), Some("id"));
}

#[test]
fn nominal_identity_cannot_reparse_as_a_primitive_argument_or_column() {
    for name in ["int", "principal", "id", "time", "bool"] {
        let old=format!("table {name}:\n  owner: principal\n  public\n  online only\nquery echo(value: {name}):\n  return value\n");
        let next=format!("table records renamed from {name}:\n  owner: principal\n  public\n  online only\nquery echo(value: records):\n  return value\ninvariant records.read only true\n");
        let sources = vec![("schema.q".into(), next)];
        assert!(compile(&sources).diagnostics.is_empty());
        let bridge = release_bridge::loosen(&[("schema.q".into(), old)], &sources);
        assert!(
            bridge
                .diagnostics
                .iter()
                .any(|d| d.message.contains("reparses")),
            "{name}: {:?}",
            bridge.diagnostics
        );
    }
}

#[test]
fn swapping_module_bodies_is_a_policy_change_even_with_identical_text_multisets() {
    let schema="table docs:\n  owner: principal\n  public\n  online only\ninvariant docs.a.create only viewer = 'service:ops'\n";
    let open = "mutation create():\n  return insert docs {owner:viewer}\n";
    let guarded="mutation create():\n  require viewer = 'service:ops' else OPS\n  return insert docs {owner:viewer}\n";
    let old = vec![
        ("schema.q".into(), schema.into()),
        ("a.q".into(), open.into()),
        ("b.q".into(), guarded.into()),
    ];
    let next = vec![
        ("schema.q".into(), schema.into()),
        ("a.q".into(), guarded.into()),
        ("b.q".into(), open.into()),
    ];
    assert!(compile(&old).diagnostics.is_empty());
    assert!(compile(&next).diagnostics.is_empty());
    assert!(release_bridge::requires_view(&old, &next));
    let bridge = release_bridge::loosen(&old, &next);
    assert!(bridge.diagnostics.is_empty());
    assert_eq!(bridge.sources, next);
}

#[test]
fn nominal_metadata_words_remain_types_before_column_and_argument_modifiers() {
    let old="table docs:\n  owner: principal\n  parent: docs ?\n  public\n  online only\nquery echo(id: docs ? alias legacy, fallback: docs default 'sample-id', retired: docs deprecated, ids: [docs] 0..3):\n  return id\n";
    for name in [
        "alias",
        "default",
        "renamed",
        "deprecated",
        "read",
        "written",
        "readable",
        "on",
    ] {
        let next = old.replace("docs", name).replace(
            &format!("table {name}:"),
            &format!("table {name} renamed from docs:"),
        ) + &format!("invariant {name}.read only true\n");
        let sources = vec![("schema.q".into(), next)];
        let checked = compile(&sources);
        assert!(
            checked.diagnostics.is_empty(),
            "{name}: {:?}",
            checked.diagnostics
        );
        let bridge = release_bridge::loosen(&[("schema.q".into(), old.into())], &sources);
        assert!(
            bridge.diagnostics.is_empty(),
            "{name}: {:?}",
            bridge.diagnostics
        );
        let bound = compile(&bridge.sources);
        assert!(bound.diagnostics.is_empty());
        let p = &bound
            .programs
            .iter()
            .find(|p| p.program.name == "echo")
            .unwrap()
            .program;
        assert_eq!(p.argument("legacy").map(|(name, _)| name), Some("id"));
        assert!(bridge.sources[0].1.contains("alias legacy"));
        assert!(bridge.sources[0].1.contains("default 'sample-id'"));
        assert!(bridge.sources[0].1.contains("deprecated"));
    }
}

#[test]
fn complete_current_contract_includes_expanded_operation_aliases() {
    let old="table docs:\n  owner: principal\n  public\n  online only\nquery one():\n  return docs first 10 by .id\nalias oldRead = one\n";
    let next = format!("{old}invariant docs.read only true\n");
    let target = vec![("schema.q".into(), old.into())];
    let kept = release_bridge::loosen(&target, &[("schema.q".into(), next.clone())]);
    assert!(kept.diagnostics.is_empty());
    assert!(compile(&kept.sources)
        .programs
        .iter()
        .any(|p| p.program.name == "oldRead"));
    let dropped = release_bridge::loosen(
        &target,
        &[("schema.q".into(), next.replace("alias oldRead = one\n", ""))],
    );
    assert!(dropped.diagnostics.is_empty(),"a guarded bridge may retain the old alias to the compatible current endpoint: {:?}",dropped.diagnostics);
    assert!(compile(&dropped.sources).programs.iter().any(|p|p.program.name=="oldRead"));
}

#[test]
fn job_bindings_remain_unchanged_during_typed_table_rename_and_plain_text_is_bounded() {
    let old="table docs:\n  owner: principal\n  public\n  online only\njob probe():\n  for row in docs:\n    docs = 'unused'\n";
    let next = format!(
        "{}invariant records.read only true\n",
        old.replace("table docs:", "table records renamed from docs:").replace("in docs:", "in records:")
    );
    let bridge = release_bridge::loosen(
        &[("schema.q".into(), old.into())],
        &[("schema.q".into(), next)],
    );
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    assert!(bridge.sources[0].1.contains("docs = 'unused'"));
    let b = compile(&[(
        "schema.q".into(),
        "query echo(value: text):\n  return value\n".into(),
    )]);
    assert!(b.diagnostics.is_empty());
    assert!(matches!(
        b.programs[0].program.args["value"],
        snapback4_core::ir::ArgType::Text {
            min: 0,
            max: 10000,
            format: None
        }
    ));
}

#[test]
fn current_closure_accepts_authored_argument_aliases_without_merging_old_positions() {
    let table="table docs:\n  owner: principal\n  public\n  online only\n";
    for (before,after) in [
        ("value: text <=40", "current: text <=80 alias value"),
        ("value: text <=40 alias legacy", "legacy: text <=80 alias value"),
    ] {
        let old=format!("{table}query echo({before}):\n  return value\n");
        let current=format!("{table}query echo({after}):\n  return {}\ninvariant docs.read only true\n",if after.starts_with("current") {"current"}else{"legacy"});
        let sources=vec![("schema.q".into(),current)];let checked=compile(&sources);assert!(checked.diagnostics.is_empty(),"{:?}",checked.diagnostics);
        assert!(checked.programs[0].program.argument("value").is_some(),"the authored current endpoint accepts the old wire name");
        let bridge=release_bridge::loosen(&[("schema.q".into(),old)],&sources);
        assert!(bridge.diagnostics.is_empty(),"compatible authored aliases must reuse the current closure: {:?}",bridge.diagnostics);
        assert_eq!(bridge.sources,sources);
    }
    let old=format!("{table}query echo(a: text <=40, b: text <=40):\n  return a\n");
    let current=format!("{table}query echo(a: text <=40 alias b):\n  return a\ninvariant docs.read only true\n");
    let bridge=release_bridge::loosen(&[("schema.q".into(),old)],&[("schema.q".into(),current)]);
    assert!(!bridge.diagnostics.is_empty(),"two independent old positions cannot collapse into one current alias target");
}


#[test]
fn selective_bridge_uses_current_defaults_in_the_actual_insert() {
    let old="table docs:\n  owner: principal default 'bøb'\n  secret: text <=40\n  legacy: int ?\n  read <- .owner = viewer\n  insert <- allow\n  online only\nmutation create(secret: text <=40):\n  return insert docs {secret}\n";
    let current=old.replace("default 'bøb'","default viewer").replace("  legacy: int ?\n","")+"invariant docs.secret write only .owner = viewer\n";
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let bound=compile(&bridge.sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let mut engine=snapback4_core::Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    let context=snapback4_core::Context::new("alice",std::collections::BTreeMap::from([("secret".into(),snapback4_core::Value::String("private".into()))]));
    let out=engine.mutate("create",None,context).unwrap();
    let snapback4_core::WriteState::Sent{result,..}=out.state else{panic!("{out:?}")};
    assert_eq!(result.field("owner").unwrap(),&snapback4_core::Value::Id("alice".into()));
}

#[test]
fn selective_endpoints_keep_module_identity_and_each_current_guard() {
    let schema="table docs:\n  owner: principal\n  legacy: int ?\n  public 'fixture'\n  insert <- allow\n  online only\n";
    let open="mutation create():\n  return insert docs {owner:viewer}\n";
    let guarded=open.replace("  return", "  require viewer = 'service:ops' else OPS\n  return");
    let old=vec![("schema.q".into(),schema.into()),("a.q".into(),open.into()),("b.q".into(),open.into())];
    let next=vec![("schema.q".into(),schema.replace("  legacy: int ?\n","")+"invariant docs.a.create only viewer = 'service:ops'\n"),("a.q".into(),guarded),("b.q".into(),open.into())];
    let bridge=release_bridge::loosen(&old,&next);assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let bound=compile(&bridge.sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let mut engine=snapback4_core::Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    for(name,refused)in [("a.create",true),("b.create",false)] {
        let out=engine.mutate(name,None,snapback4_core::Context::new("alice",Default::default())).unwrap();
        assert_eq!(matches!(out.state,snapback4_core::WriteState::Failed{..}),refused,"{name}: {out:?}");
    }
}

#[test]
fn selective_endpoint_retains_old_wire_aliases_and_rejects_alias_rebinding() {
    let old="table docs:\n  secret: text <=40\n  legacy: int ?\n  public 'fixture'\n  online only\nmutation create(secret: text <=40 alias legacySecret):\n  return insert docs {secret}\n";
    let current=old.replace("  legacy: int ?\n","").replace(" alias legacySecret","")+"invariant docs.read only true\n";
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),current.clone())]);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let bound=compile(&bridge.sources);assert!(bound.diagnostics.is_empty());
    let endpoint=&bound.programs.iter().find(|p|p.program.name=="create").unwrap().program;
    assert_eq!(endpoint.argument("legacySecret").map(|(name,_)|name),Some("secret"));
    let rebound=current.replace("secret: text <=40):","secret: text <=40, other: text <=40 ? alias legacySecret):");
    let refused=release_bridge::loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),rebound)]);
    assert!(refused.diagnostics.is_empty(),"{:?}",refused.diagnostics);
    assert!(!compile(&refused.sources).programs.iter().any(|p|p.program.name=="create"),"incompatible alias pauses the export");
}

#[test]
fn valid_final_declarations_without_a_newline_have_bounded_source_spans() {
    let old="table docs:\n  owner: principal\n  public 'fixture'\n  online only\ninvariant docs.read only true\nmutation create():\n  return insert docs {owner:'bøb'}";
    let before=vec![("schema.q".into(),old.into())];
    let after=vec![("schema.q".into(),old.replace("owner:'bøb'","owner:viewer"))];
    assert!(compile(&before).diagnostics.is_empty());assert!(compile(&after).diagnostics.is_empty());
    assert!(!release_bridge::requires_view(&before,&before));
    assert!(release_bridge::requires_view(&before,&after));
}


#[test]
fn guarded_current_view_keeps_qualified_helper_repairs() {
    let schema="table docs:\n  owner: principal\n  secret: text <=40\n  legacy: int ?\n  read <- .owner = viewer\n  insert <- allow\n  online only\nmutation create(owner: principal, secret: text <=40):\n  return insert docs {owner:helpers.ownerFor(owner),secret}\n";
    let old=vec![("schema.q".into(),schema.into()),("helpers.q".into(),"fn ownerFor(value: principal): value\n".into())];
    let current=vec![("schema.q".into(),schema.replace("  legacy: int ?\n","")+"invariant docs.secret write only .owner = viewer\n"),("helpers.q".into(),"fn ownerFor(value: principal): viewer\n".into())];
    let bridge=release_bridge::loosen(&old,&current);assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    assert_eq!(bridge.sources,current,"the current helper closure remains current-authored");
    let bound=compile(&bridge.sources);let mut engine=snapback4_core::Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    let args=std::collections::BTreeMap::from([("owner".into(),snapback4_core::Value::Id("bob".into())),("secret".into(),snapback4_core::Value::String("private".into()))]);
    let out=engine.mutate("create",None,snapback4_core::Context::new("alice",args)).unwrap();
    let snapback4_core::WriteState::Sent{result,..}=out.state else{panic!("{out:?}")};
    assert_eq!(result.field("owner").unwrap(),&snapback4_core::Value::Id("alice".into()));
}

#[test]
fn guarded_current_view_follows_rebound_alias_guards_and_old_wire_names() {
    let schema="table docs:\n  secret: text <=40\n  legacy: int ?\n  public 'fixture'\n  insert <- allow\n  online only\nmutation create(secret: text <=40 alias legacySecret):\n  return insert docs {secret}\nalias protected = create\n";
    let current=schema.replace("  legacy: int ?\n","").replace(" alias legacySecret","").replace("alias protected = create\n","")+"mutation guarded(secret: text <=40):\n  require viewer = 'service:ops' else OPS\n  return insert docs {secret}\nalias protected = guarded\ninvariant docs.protected only viewer = 'service:ops'\n";
    let bridge=release_bridge::loosen(&[("schema.q".into(),schema.into())],&[("schema.q".into(),current)]);assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let bound=compile(&bridge.sources);let mut engine=snapback4_core::Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    for(name,who,refused)in [("protected","alice",true),("protected","service:ops",false),("create","alice",false)] {
        let args=std::collections::BTreeMap::from([("legacySecret".into(),snapback4_core::Value::String("value".into()))]);
        let out=engine.mutate(name,None,snapback4_core::Context::new(who,args)).unwrap();
        assert_eq!(matches!(out.state,snapback4_core::WriteState::Failed{..}),refused,"{name}/{who}: {out:?}");
    }
}

#[test]
fn mixed_domains_use_the_compiled_qualified_wire_contract() {
    let schema="table docs:\n  kind: enum('private','public')\n  amount: int\n  public 'fixture'\n  online only\n";
    let query="query echo(value: text <=40 alias legacy):\n  return value\n";
    let old=vec![("schema.q".into(),schema.into()),("a.q".into(),query.into())];
    let current_schema=schema.replace("enum('private','public')","enum('public')").replace("amount: int","amount: int ?");
    let current=vec![("schema.q".into(),current_schema.clone()),("a.q".into(),query.replace(" alias legacy",""))];
    let bridge=release_bridge::loosen(&old,&current);assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let bound=compile(&bridge.sources);let mut engine=snapback4_core::Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    let args=std::collections::BTreeMap::from([("legacy".into(),snapback4_core::Value::String("kept".into()))]);
    let result=engine.query("a.echo",snapback4_core::Context::new("alice",args)).unwrap();assert_eq!(result.data,snapback4_core::Value::String("kept".into()));
    let moved=vec![("schema.q".into(),current_schema),("b.q".into(),query.replace(" alias legacy",""))];
    let refused=release_bridge::loosen(&old,&moved);assert!(!refused.diagnostics.is_empty(),"a.echo cannot silently become b.echo");
}


#[test]
fn guarded_current_view_explicitly_pauses_a_removed_write() {
    let old="table docs:\n  owner: principal\n  public 'fixture'\n  insert <- allow\n  online only\nmutation repair():\n  return insert docs {owner:'old-operator'}\nquery all():\n  return docs first 10 by .id\n";
    let current="table docs:\n  owner: principal\n  public 'fixture'\n  insert <- allow\n  online only\nmutation currentWrite():\n  return insert docs {owner:viewer}\nquery all():\n  return docs first 10 by .id\ninvariant docs.read only true\n";
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),current.into())]);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    assert!(bridge.changes.iter().any(|change|change.contains("repair")&&change.contains("E_OP")),"{:?}",bridge.changes);
    let bound=compile(&bridge.sources);assert!(!bound.programs.iter().any(|p|p.program.name=="repair"));
    assert!(bound.programs.iter().any(|p|p.program.name=="all"));
}


#[test]
fn non_intent_alias_replaced_by_a_program_keeps_its_current_guard() {
    let old="table docs:\n  amount: int\n  public 'fixture'\n  insert <- allow\n  online only\nmutation create():\n  return insert docs {amount:1}\nalias protected = create\n";
    let current=old.replace("  amount: int","  amount: int ?").replace("alias protected = create\n","")+"mutation protected():\n  require viewer = 'service:ops' else OPS\n  return insert docs {amount:1}\n";
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]);assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let bound=compile(&bridge.sources);let mut engine=snapback4_core::Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    for(name,refused)in [("protected",true),("create",false)] {
        let out=engine.mutate(name,None,snapback4_core::Context::new("alice",Default::default())).unwrap();
        assert_eq!(matches!(out.state,snapback4_core::WriteState::Failed{..}),refused,"{name}: {out:?}");
    }
}

#[test]
fn non_intent_guard_transport_cannot_merge_old_input_positions() {
    let old="table docs:\n  amount: int\n  public 'fixture'\n  insert <- allow\n  online only\nmutation create(owner: principal, actor: principal):\n  return insert docs {amount:1}\n";
    let current=old.replace("  amount: int","  amount: int ?")
        .replace("create(owner: principal, actor: principal)","create(actor: principal alias owner)")
        .replace("  return insert", "  require actor = 'service:ops' else OPS\n  return insert");
    assert!(compile(&[("schema.q".into(),current.clone())]).diagnostics.is_empty());
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    assert!(!compile(&bridge.sources).programs.iter().any(|p|p.program.name=="create"),"merged inputs pause the write instead of reinterpreting owner/actor");
}

#[test]
fn guarded_current_view_follows_a_declared_required_column_identity() {
    let old="table docs:\n  price: int\n  public 'fixture'\n  online only\nquery all():\n  return docs first 10 by .id\n";
    let current=old.replace("  price: int","  quotedPrice: int renamed from price")+"invariant docs.read only true\n";
    let sources=vec![("schema.q".into(),current)];let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&sources);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);assert_eq!(bridge.sources,sources);
    assert!(bridge.changes.iter().any(|line|line.contains("docs.price")&&line.contains("docs.quotedPrice")),"{:?}",bridge.changes);
}

#[test]
fn non_intent_query_filter_keeps_the_current_execution_context() {
    let old="table docs:\n  amount: int\n  owner: principal\n  read <- allow\n  online only\nquery list():\n  return docs first 10 by .id\n";
    let current=old.replace("amount: int","amount: int ?").replace("return docs first", "return docs where .owner = viewer first");
    let sources=vec![("schema.q".into(),current)];
    assert!(compile(&sources).diagnostics.is_empty());
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&sources);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    assert_eq!(bridge.sources,sources,"restoring an unfiltered query would disclose other viewers' rows");
}

#[test]
fn non_intent_guard_bindings_keep_the_current_statement_order() {
    let old="table docs:\n  amount: int\n  read <- allow\n  update <- allow\n  online only\nmutation change(doc: docs):\n  before = docs[doc]\n  update docs[doc] {amount:1}\n  require before.amount = 0 else CLOSED\n";
    let current=old.replace("amount: int","amount: int ?").replace("  before = docs[doc]\n  update docs[doc] {amount:1}","  update docs[doc] {amount:1}\n  before = docs[doc]");
    let sources=vec![("schema.q".into(),current)];
    let bound=compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&sources);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    assert_eq!(bridge.sources,sources,"identical last textual bindings cannot authorize restoring an earlier read before a guarded write");
}

#[test]
fn a_named_shape_repair_cannot_restore_a_constant_true_guard() {
    let old="table docs:\n  owner: principal\n  amount: int\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nshape access = { allowed: true }\nmutation create():\n  return insert docs {owner:viewer,amount:0}\nmutation change(id: docs):\n  row = docs[id] ! else MISSING\n  gate = row access\n  require gate.allowed else FORBIDDEN\n  update docs[id] {amount:1}\n";
    let current=old.replace("amount: int","amount: int ?").replace("allowed: true","allowed: .owner = viewer");
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let bound=compile(&bridge.sources);let mut engine=snapback4_core::Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    let created=engine.mutate("create",None,snapback4_core::Context::new("alice",Default::default())).unwrap();
    let snapback4_core::WriteState::Sent{result,..}=created.state else{panic!("{created:?}")};
    let args=std::collections::BTreeMap::from([("id".into(),result.field("id").unwrap().clone())]);
    for(who,refused)in [("bob",true),("alice",false)] {
        let out=engine.mutate("change",None,snapback4_core::Context::new(who,args.clone())).unwrap();
        assert_eq!(matches!(out.state,snapback4_core::WriteState::Failed{..}),refused,"{who}: {out:?}");
    }
}

#[test]
fn changed_existing_column_authority_selects_the_guarded_current_fallback() {
    let old="table docs:\n  owner: principal\n  amount: int\n  legacy: int ?\n  secret: text <=40 read <- .owner = viewer\n  read <- allow\n  insert <- allow\n  online only\nmutation create():\n  return insert docs {owner:viewer,amount:1,secret:'private'}\n";
    let current=old.replace("amount: int","amount: int ?").replace("  legacy: int ?\n","").replace("read <- .owner = viewer","read <- deny");
    let sources=vec![("schema.q".into(),current)];
    assert!(compile(&sources).diagnostics.is_empty());
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&sources);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    assert_eq!(bridge.sources,sources,"a valid current guarded view must be selected before late CLI authority admission");
}

#[test]
fn table_identity_renames_preserve_transitive_helpers_and_old_wire_aliases() {
    let old="table docs:\n  n: int\n  read <- allow\n  insert <- allow\n  online only\nfn present(key: docs): exists docs[key] and 'docs' = 'docs'\nfn wrapped(key: docs): present(key)\nmutation add():\n  return insert docs {n:1}\nquery one(key: docs alias legacyKey):\n  return wrapped(key)\n";
    let current=old.replace("table docs:","table records renamed from docs:").replace("n: int","n: int ?").replace("key: docs","key: records").replace("exists docs[","exists records[").replace("insert docs {","insert records {").replace(" alias legacyKey","");
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    assert!(bridge.sources.iter().any(|(_,text)|text.contains("'docs' = 'docs'")),"business strings are not row-reference slots");
    let bound=compile(&bridge.sources);let mut engine=snapback4_core::Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    let out=engine.mutate("add",None,snapback4_core::Context::new("alice",Default::default())).unwrap();
    let snapback4_core::WriteState::Sent{result,..}=out.state else{panic!("{out:?}")};
    let args=std::collections::BTreeMap::from([("legacyKey".into(),result.field("id").unwrap().clone())]);
    let read=engine.query("one",snapback4_core::Context::new("alice",args)).unwrap();
    assert_eq!(read.data,snapback4_core::Value::Bool(true));
}

#[test]
fn merge_lane_repairs_preserve_current_read_scope_in_programs_and_helpers() {
    use snapback4_core::{Context,Engine,Value,value::object};
    use std::collections::BTreeMap;
    let table="table items:\n  owner: principal\n  at: int\n  body: text <=40\n  by byOwnerTime: owner, at, id\n  cap 100\n  read <- allow\n  online only\n";
    let page="query page(owner: principal, c: cursor ?):\n  return merge items after c last 2 by byOwnerTime:\n    [owner]\n";
    for helper in [false,true] {
        let query=if helper{page.replace("query page(","fn selected(")+"query page(owner: principal, c: cursor ?):\n  return selected(owner,c)\n"}else{page.into()};
        let old=table.to_owned()+&query;let current=old.replace("text <=40","text <=80").replace("[owner]","[viewer]");
        let current_sources=vec![("schema.q".into(),current)];let bound=compile(&current_sources);assert!(bound.diagnostics.is_empty(),"helper {helper}: {:?}",bound.diagnostics);
        let bridge=release_bridge::loosen(&[("schema.q".into(),old)],&current_sources);
        assert!(bridge.diagnostics.is_empty(),"helper {helper}: {:?}",bridge.diagnostics);
        let bound=compile(&bridge.sources);let mut engine=Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
        engine.seed([("items".into(),object([("id",Value::Id("row".into())),("owner",Value::Id("alice".into())),("at",Value::Int(1)),("body",Value::String("private".into()))]))]).unwrap();
        for(who,count)in [("bob",0),("alice",1)] {
            let args=BTreeMap::from([("owner".into(),Value::Id("alice".into())),("c".into(),Value::Null)]);
            let out=engine.query("page",Context::new(who,args)).unwrap();
            assert_eq!(out.data.as_array().unwrap().len(),count,"helper {helper}, viewer {who}: {out:?}");
        }
    }
}

#[test]
fn renamed_field_authority_selects_current_even_with_a_nullable_legacy_gap() {
    use snapback4_core::{Context,Engine,Value,value::object};
    for legacy in [false,true] {
        let old=format!("table docs:\n  owner: principal\n  amount: int\n{}  secret: text <=40 read <- .owner = viewer\n  read <- allow\n  online only\nquery list():\n  return docs first 10 by .id\n",if legacy{"  legacy: int ?\n"}else{""});
        let current=old.replace("table docs:","table records renamed from docs:").replace("amount: int","amount: int ?").replace("return docs first","return records first").replace("read <- .owner = viewer","read <- deny").replace("  legacy: int ?\n","");
        let bridge=release_bridge::loosen(&[("schema.q".into(),old)],&[("schema.q".into(),current)]);
        assert!(bridge.diagnostics.is_empty(),"legacy {legacy}: {:?}",bridge.diagnostics);
        let bound=compile(&bridge.sources);assert!(bound.schema.tables.contains_key("docs"));let mut engine=Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
        engine.seed([("docs".into(),object([("id",Value::Id("row".into())),("owner",Value::Id("alice".into())),("amount",Value::Int(1)),("secret",Value::String("private".into()))]))]).unwrap();
        for who in ["alice","bob"] {
            let out=engine.query("list",Context::new(who,Default::default())).unwrap();
            assert_eq!(out.data.as_array().unwrap().len(),1);
            assert!(!snapback4_core::wire::to_json(&out.data).to_string().contains("private"),"legacy {legacy}, {who}: {out:?}");
        }
    }
}

#[test]
fn final_existence_uses_declared_table_column_and_index_identities() {
    let old="table codes:\n  code: text <=20\n  unique code\n  public\n  online only\ntable records:\n  value: text <=20\n  public\n  after insert <- exists codes[code = .value]\n  online only\ninvariant records.read only true\n";
    let renamed=old.replace("table codes:","table catalog renamed from codes:")
        .replace("code: text <=20", "slug: text <=20 renamed from code")
        .replace("unique code","unique slug").replace("value: text <=20","payload: text <=20 renamed from value")
        .replace("codes[code = .value]","catalog[slug = .payload]");
    let source=|s:&str|vec![("schema.q".into(),s.to_owned())];
    for s in [old,renamed.as_str()] {let b=compile(&source(s));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
    assert!(!release_bridge::requires_view(&source(old),&source(&renamed)));
    assert!(!release_bridge::requires_view(&source(&renamed),&source(old)));
    for changed in [renamed.replace("  after insert <- exists catalog[slug = .payload]\n",""),
        renamed.replace("catalog[slug = .payload]","catalog[slug = 'different']")] {
        let b=compile(&source(&changed));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        assert!(release_bridge::requires_view(&source(old),&source(&changed)));
    }
}

#[test]
fn final_existence_reference_keys_keep_identity_and_literal_meaning() {
    let old="table codes:\n  code: text <=20\n  unique byCode: code\n  public\n  online only\ntable labels:\n  label: text <=20\n  public\n  online only\ntable records:\n  owner: labels\n  public\n  after insert <- exists codes[code = .owner.label]\n  online only\ninvariant records.read only true\n";
    let next=old.replace("table codes:","table catalog renamed from codes:")
        .replace("code: text <=20","slug: text <=20 renamed from code").replace("unique byCode: code","unique bySlug: slug")
        .replace("table labels:","table tags renamed from labels:")
        .replace("label: text <=20","name: text <=20 renamed from label")
        .replace("owner: labels","tag: tags renamed from owner")
        .replace("codes[code = .owner.label]","catalog[slug = .tag.name]");
    let source=|s:&str|vec![("schema.q".into(),s.to_owned())];
    for s in [old,next.as_str()] {let b=compile(&source(s));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);}
    assert!(!release_bridge::requires_view(&source(old),&source(&next)));
    // A differently named index does not change the same typed existence obligation.
    let changed=next.replace("catalog[slug = .tag.name]","catalog[slug = 'name']");
    assert!(release_bridge::requires_view(&source(old),&source(&changed)));
}

#[test]
fn current_column_write_and_freeze_survive_default_bridge_without_invariants() {
    let old = "table docs:\n  owner: principal\n  approved: bool default false\n  body: text <=40 ?\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(owner: principal, body: text <=40 ?):\n  return insert docs {owner, body}\n";
    let current=old.replace("  body: text <=40 ?", "  body: text <=80 ? write <- .owner = viewer")
        .replace("  online only", "  immutable body when .approved = true\n  online only");
    let target=vec![("schema.q".into(),old.into())];
    let source=vec![("schema.q".into(),current)];
    assert!(release_bridge::requires_view(&target,&source));
    let bridge=release_bridge::loosen(&target,&source);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let got=compile(&bridge.sources);let expected=compile(&source);
    assert!(got.diagnostics.is_empty(),"{:?}",got.diagnostics);
    assert!(!expected.schema.tables["docs"].column_writes.is_empty());
    assert!(!expected.schema.tables["docs"].frozen_columns.is_empty());
    assert_eq!(got.schema.tables["docs"].column_writes,expected.schema.tables["docs"].column_writes);
    assert_eq!(got.schema.tables["docs"].frozen_columns,expected.schema.tables["docs"].frozen_columns);
    assert_eq!(got.programs[0].program,expected.programs[0].program);
}

#[test]
fn declared_column_identity_transports_write_and_freeze_terms() {
    let source="table docs:\n  owner: principal\n  approved: bool\n  body: text <=40 ? write <- .owner = viewer\n  immutable body when .approved = true\n  public\n  online only\n";
    let before=compile(&[("schema.q".into(),source.into())]);
    assert!(before.diagnostics.is_empty(),"{:?}",before.diagnostics);
    let renamed=source.replace("owner","author").replace("approved","accepted").replace("body","payload");
    let after=compile(&[("schema.q".into(),renamed)]);
    assert!(after.diagnostics.is_empty(),"{:?}",after.diagnostics);
    let map=std::collections::BTreeMap::from([("docs".into(),std::collections::BTreeMap::from([("author".into(),"owner".into()),("accepted".into(),"approved".into()),("payload".into(),"body".into())]))]);
    let aligned=after.schema.with_column_names(&map);
    assert_eq!(aligned.tables["docs"].column_writes,before.schema.tables["docs"].column_writes);
    assert_eq!(aligned.tables["docs"].frozen_columns,before.schema.tables["docs"].frozen_columns);
}

#[test]
fn wave27_exact_source_proves_column_audiences_or_refuses_the_named_write() {
    let old="table docs:\n  owner: principal\n  body: text <=40\n  public\n  insert <- allow\n  update <- allow\n  online only\nmutation add(owner: principal, body: text <=40):\n  return insert docs {owner,body}\n";
    let next=old.replace("body: text <=40\n","body: text <=40 write <- .owner = viewer\n");
    let before=vec![("schema.q".into(),old.into())];let current=vec![("schema.q".into(),next)];
    // REL3 keeps a guarded current view while exact old writes still refuse.
    assert!(release_bridge::requires_view(&before,&current));
    let view=release_bridge::loosen(&before,&current);assert!(view.diagnostics.is_empty(),"{:?}",view.diagnostics);
    assert_eq!(compile(&view.sources).schema.tables["docs"].column_writes,compile(&current).schema.tables["docs"].column_writes);
    let error=release_bridge::exact_write_authority(&before,&current).unwrap_err();
    assert!(error.contains("docs.body")&&error.contains("add")&&error.contains("write <-"),"{error}");
    let guarded=old.replace("insert <- allow","insert <- .owner = viewer");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),guarded)],&current).is_ok());
}

#[test]
fn wave27_needed_view_retains_column_policy_probes_through_captured_names() {
    let old="table staff:\n  principal: principal\n  unique principal\n  public\n  online only\ntable docs:\n  owner: principal\n  amount: int\n  body: text <=40\n  public\n  online only\nquery read(docs: docs):\n  return docs[docs]\nmutation edit(docs: docs, body: text <=40):\n  update docs[docs] {body}\n";
    let next=old.replace("table docs:","table records renamed from docs:")
        .replace("docs: docs","docs: records").replace("return docs[docs]","return records[docs]")
        .replace("update docs[docs]","update records[docs]").replace("amount: int","amount: int ?")
        .replace("body: text <=40\n","body: text <=40 write <- exists staff[viewer] and exists records[.id]\n");
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),next)]);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let b=compile(&bridge.sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert!(!b.schema.tables["docs"].column_writes.is_empty());
    assert!(bridge.sources[0].1.contains("docs: docs"));
}

#[test]
fn enum_aliases_refuse_merging_business_values_and_missing_variants() {
    let source="table tasks:\n  state: enum('ready','done')\n  public\n  online only\n";
    for aliases in ["alias tasks.state 'old' = 'missing'\n","alias tasks.state 'a' = 'done'\nalias tasks.state 'b' = 'done'\n","alias tasks.state 'ready' = 'done'\n"] {
        let b=compile(&[("schema.q".into(),source.to_owned()+aliases)]);assert!(b.diagnostics.iter().any(|d|d.message.contains("injective")),"{:?}",b.diagnostics);
    }
}

#[test]
fn current_views_pause_old_deletes_that_newly_cascade_through_a_renamed_reference() {
    let old="table parents:\n  public\n  delete <- allow\n  online only\ntable items:\n  parent: parents on delete restrict\n  n: int\n  cap 3 by parent\n  public\n  online only\nmutation remove(id: parents):\n  delete parents[id]\nquery rows():\n  return items first 10 by .id\n";
    let next=old.replace("parent: parents on delete restrict","anchor: parents renamed from parent on delete cascade").replace("cap 3 by parent","cap 3 by anchor").replace("n: int","n: int ?");
    let bridge=release_bridge::loosen(&[("schema.q".into(),old.into())],&[("schema.q".into(),next)]);
    assert!(bridge.diagnostics.is_empty(),"{:?}",bridge.diagnostics);
    let b=compile(&bridge.sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    assert!(!b.programs.iter().any(|p|p.program.name=="remove"));assert!(b.programs.iter().any(|p|p.program.name=="rows"));
    assert!(bridge.changes.iter().any(|c|c.contains("cascade/set-null")&&c.contains("E_OP")));
}

#[test]
fn exact_source_accepts_a_proved_stable_dominating_column_audience_require() {
    let old="table docs:\n  body: text <=40\n  public\n  insert <- allow\n  online only\nmutation add(body: text <=40):\n  require viewer = 'alice' else FORBIDDEN\n  return insert docs {body}\n";
    let current=old.replace("body: text <=40\n","body: text <=40 write <- viewer = 'alice'\n");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]).is_ok());
}

#[test]
fn enum_alias_reverse_projection_avoids_an_unneeded_rollback_view() {
    let old="table tasks:\n  label: text <=40\n  state: enum('queued','done')\n  public\n  online only\n";
    let current=old.replace("label: text <=40","title: text <=40 renamed from label").replace("'done'","'ready'")+"alias tasks.state 'done' = 'ready'\n";
    let before=vec![("schema.q".into(),old.into())];let after=vec![("schema.q".into(),current)];
    assert!(compile(&after).diagnostics.is_empty());assert!(!release_bridge::requires_view(&before,&after));
}

#[test]
fn exact_source_stable_role_guard_survives_control_flow_and_boolean_audience() {
    let old="table roles:\n  principal: principal\n  role: enum('planner','owner')\n  unique principal\n  public\n  online only\ntable docs:\n  body: text <=40\n  public\n  insert <- allow\n  online only\nmutation add(body: text <=40, again: bool):\n  require exists roles[principal = viewer, role = 'planner'] else NO\n  if again:\n    insert docs {body}\n  return insert docs {body}\n";
    let current=old.replace("body: text <=40\n","body: text <=40 write <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'planner']\n");
    let before=vec![("schema.q".into(),old.into())];let next=vec![("schema.q".into(),current)];
    assert!(release_bridge::exact_write_authority(&before,&next).is_ok());
    let unstable=old.replace("  if again:","  if again:\n    delete roles[viewer]");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),unstable)],&next).is_err());
    let wrong=old.replace("= 'planner'] else NO","= 'owner'] else NO");
    let planner=next[0].1.replace("exists roles[principal = viewer, role = 'owner'] or ","");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),wrong)],&[("schema.q".into(),planner)]).is_err());
}

#[test]
fn exact_source_null_insert_does_not_grant_a_protected_value_write() {
    let old="table docs:\n  body: text <=40 ?\n  public\n  insert <- allow\n  online only\nmutation add():\n  return insert docs {body:null}\n";
    let current=old.replace("body: text <=40 ?\n","body: text <=40 ? write <- deny\n");
    let before=vec![("schema.q".into(),old.into())]; let result=release_bridge::exact_write_authority(&before,&[("schema.q".into(),current)]);
    assert!(result.is_ok(),"{:?}; {}",result,serde_json::to_string(&compile(&before).programs[0].program).unwrap());
}

#[test]
fn exact_source_guard_keeps_named_probe_meaning_without_printing_current_policy() {
    let old="table roles:\n  principal: principal\n  delegate: principal\n  unique byPrincipal: principal\n  unique byDelegate: delegate\n  public\n  online only\ntable docs:\n  body: text <=40\n  public\n  insert <- allow\n  online only\nmutation add(body: text <=40):\n  require exists roles[principal = viewer] else NO\n  return insert docs {body}\n";
    let unrelated="table roots:\n  public\n  online only\ntable leaves:\n  root: roots on delete cascade\n  cap 3 by root\n  public\n  online only\n";
    let before=old.to_owned()+unrelated;
    let current=before.replace("body: text <=40\n","body: text <=40 write <- exists roles[principal = viewer] or exists admins[viewer]\n")+"table admins:\n  principal: principal\n  unique principal\n  public\n  online only\n";
    assert!(compile(&[("schema.q".into(),current.clone())]).diagnostics.is_empty());
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),before)],&[("schema.q".into(),current)]).is_ok());
}

#[test]
fn exact_source_equal_policy_ir_cannot_hide_a_changed_index_key() {
    let old="table roles:\n  principal: principal\n  delegate: principal\n  unique gate: principal\n  public\n  online only\ntable docs:\n  body: text <=40 write <- exists roles[principal = viewer]\n  public\n  insert <- allow\n  online only\nmutation add(body: text <=40):\n  return insert docs {body}\n";
    let current=old.replace("unique gate: principal","unique gate: delegate").replace("exists roles[principal = viewer]","exists roles[delegate = viewer]");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]).is_err());
}

#[test]
fn exact_source_unrelated_patch_and_ir_named_object_field_keep_write_footprints() {
    let old="table docs:\n  body: text <=40 ?\n  label: text <=40\n  public\n  insert <- allow\n  update <- allow\n  online only\nmutation relabel(id: docs, label: text <=40):\n  return update docs[id] {label}\n";
    let current=old.replace("body: text <=40 ?\n","body: text <=40 ? write <- deny\n");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),old.into())],&[("schema.q".into(),current)]).is_ok());
    let old=old.to_owned()+"mutation add(body: text <=40):\n  return {Literal: insert docs {label:'new',body}}\n";
    let before=vec![("schema.q".into(),old.clone())];assert!(compile(&before).diagnostics.is_empty(),"{:?}",compile(&before).diagnostics);
    let current=old.replace("body: text <=40 ?\n","body: text <=40 ? write <- deny\n");
    assert!(release_bridge::exact_write_authority(&before,&[("schema.q".into(),current)]).is_err());
}

#[test]
fn exact_source_transitive_set_null_cannot_clear_a_newly_frozen_reference() {
    let old="table roots:\n  public\n  delete <- allow\n  online only\ntable parents:\n  root: roots on delete cascade\n  cap 3 by root\n  public\n  online only\ntable children:\n  parent: parents ? on delete set null\n  cap 3 by parent\n  public\n  online only\nmutation remove(id: roots):\n  delete roots[id]\n";
    let current=old.replace("parent: parents ? on delete set null","parent: parents ? on delete restrict\n  immutable parent when true");
    let before=vec![("schema.q".into(),old.into())];let next=vec![("schema.q".into(),current)];
    assert!(compile(&before).diagnostics.is_empty());assert!(compile(&next).diagnostics.is_empty(),"{:?}",compile(&next).diagnostics);
    let error=release_bridge::exact_write_authority(&before,&next).unwrap_err();
    assert!(error.contains("children.parent")&&error.contains("remove")&&error.contains("immutable when")&&error.contains("set null"),"{error}");
}

#[test]
fn exact_source_native_empty_ir_is_not_an_unwritten_column_proof() {
    let old="table docs:\n  body: text <=40\n  public\n  insert <- allow\n  online only\njob background(): native\n";
    let before=vec![("schema.q".into(),old.into())];assert!(compile(&before).diagnostics.is_empty(),"{:?}",compile(&before).diagnostics);
    let current=old.replace("body: text <=40\n","body: text <=40 write <- deny\n");
    assert!(release_bridge::exact_write_authority(&before,&[("schema.q".into(),current)]).unwrap_err().contains("native operation background"));
}

#[test]
fn exact_source_insert_only_placement_cannot_violate_a_new_freeze() {
    let old="table docs:\n  body: text <=40\n  public\n  insert <- allow\n  update <- allow\n  online only\nmutation add(body: text <=40):\n  return insert docs {body}\n";
    let current=old.replace("  public\n","  immutable body when true\n  public\n");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),old.into())],&[("schema.q".into(),current.clone())]).is_ok());
    let updating=old.to_owned()+"mutation edit(id: docs, body: text <=40):\n  return update docs[id] {body}\n";
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),updating)],&[("schema.q".into(),current)]).is_err());
}

#[test]
fn exact_source_expands_pure_leading_role_helpers_in_the_owning_module() {
    let schema="table roles:\n  principal: principal\n  role: enum('dispatcher','driver')\n  unique principal\n  public\n  online only\ntable docs:\n  body: text <=40\n  public\n  insert <- allow\n  online only\n";
    let operations="fn isRole(role: enum('dispatcher','driver')): exists roles[principal = viewer, role = role]\nfn dispatch(): isRole('dispatcher')\nmutation add(body: text <=40, again: bool):\n  require dispatch() else NO\n  require length(body) > 0 else EMPTY\n  if again:\n    insert docs {body}\n  return insert docs {body}\n";
    let before=vec![("schema.q".into(),schema.into()),("dispatch.q".into(),operations.into())];
    let next=vec![("schema.q".into(),schema.replace("body: text <=40\n","body: text <=40 write <- exists roles[principal = viewer, role = 'dispatcher']\n")),("dispatch.q".into(),operations.into())];
    assert!(compile(&before).diagnostics.is_empty(),"{:?}",compile(&before).diagnostics);
    assert!(release_bridge::exact_write_authority(&before,&next).is_ok());
    let changed=operations.replace("isRole('dispatcher')","isRole('driver')");
    assert!(release_bridge::exact_write_authority(&[("schema.q".into(),schema.into()),("dispatch.q".into(),changed)],&next).is_err());
}
