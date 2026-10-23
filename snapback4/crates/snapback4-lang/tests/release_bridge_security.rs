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
fn job_bindings_participate_in_capture_checks_and_plain_text_is_bounded() {
    let old="table docs:\n  owner: principal\n  public\n  online only\njob probe():\n  for row in docs:\n    docs = 'unused'\n";
    let next = format!(
        "{}invariant records.read only true\n",
        old.replace("table docs:", "table records renamed from docs:").replace("in docs:", "in records:")
    );
    let bridge = release_bridge::loosen(
        &[("schema.q".into(), old.into())],
        &[("schema.q".into(), next)],
    );
    assert!(bridge.diagnostics.iter().any(|d| d.message.contains("captures")),"{:?}",bridge.diagnostics);
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
    assert!(!refused.diagnostics.is_empty(),"old alias cannot move to another input position");
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
