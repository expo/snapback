use snapback4_lang::compile;

const SCHEMA: &str = "table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable approvals:\n  job: id\n  unique job\n  read <- exists staff[viewer]\n  online only\n";

fn notes(tail: &str) -> Vec<snapback4_lang::Diagnostic> {
    let b = compile(&[("schema.q".into(), format!("{SCHEMA}{tail}"))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b.notes.into_iter().filter(|n| n.code == "N_UNREADABLE_PROBE").collect()
}

#[test]
fn negative_and_positive_nested_guards_name_the_hiding_read_rule() {
    for condition in ["not exists approvals[job]", "exists approvals[job]", "true and not exists approvals[job]", "not (exists approvals[job] or exists approvals[job])"] {
        let found = notes(&format!("mutation upload(job: id):\n  require {condition} else JOB_APPROVED\n  return null\n"));
        if condition == "exists approvals[job]" { assert!(found.is_empty()); continue; }
        assert_eq!(found.len(), 1, "{condition}: {found:?}");
        assert!(found[0].message.contains("exists staff[viewer]") && found[0].message.contains("negative guard"));
        assert!(found[0].rewrite.contains("constraint") && !found[0].rewrite.contains("public"));
    }
    assert_eq!(notes("mutation upload(job: id):\n  if not exists approvals[job]:\n    return true\n  return false\n").len(), 1);
    assert_eq!(notes("query upload(job: id):\n  return true if not exists approvals[job] else false\n").len(), 1);
}

#[test]
fn proven_principal_and_role_probes_are_quiet_and_writes_invalidate_role_facts() {
    assert!(notes("mutation upload(job: id):\n  require exists staff[viewer] else FORBIDDEN\n  require not exists approvals[job] else JOB_APPROVED\n  return null\n").is_empty());
    assert!(notes("query me():\n  require exists staff[principal = viewer] else FORBIDDEN\n  return true\n").is_empty());
    assert_eq!(notes("mutation upload(job: id):\n  require exists staff[viewer] else FORBIDDEN\n  delete staff[viewer]\n  require not exists approvals[job] else JOB_APPROVED\n  return null\n").len(), 1);
    // A role accepted on just one arm does not dominate the following probe.
    assert_eq!(notes("mutation upload(job: id):\n  require exists staff[viewer] or true else FORBIDDEN\n  require not exists approvals[job] else JOB_APPROVED\n  return null\n").len(), 1);
    // System jobs do not depend on caller readability.
    assert!(notes("job upload():\n  for approval in approvals:\n    require not exists approvals[approval.job] else JOB_APPROVED\n    delete approvals[approval]\n").is_empty());
}

#[test]
fn full_positional_key_plus_extra_tests_remains_valid() {
    let s = "table docs:\n  owner: principal\n  public 'docs'\nquery own(doc: docs):\n  return exists docs[doc, owner = viewer]\n";
    let b = compile(&[("schema.q".into(), s.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
}

#[test]
fn inequality_probe_explains_both_contexts_and_a_program_repair_compiles() {
    let schema = "table roles:\n  principal: principal\n  role: enum('admin', 'staff')\n  unique principal, role\n  by byPrincipal: principal, id\n  public 'roles'\n";
    for tail in ["query other():\n  return exists roles[viewer, role != 'admin']\n", "table docs:\n  read <- exists roles[viewer, role != 'admin']\n  online only\n"] {
        let b = compile(&[("schema.q".into(), format!("{schema}{tail}"))]);
        let d = b.diagnostics.iter().find(|d| d.message.contains("not != tests")).unwrap_or_else(|| panic!("{:?}", b.diagnostics));
        assert!(d.rewrite.contains("caller-readable") && d.rewrite.contains("constraints"));
        assert!(d.source_rewrite.is_none());
    }
    let b = compile(&[("schema.q".into(), format!("{schema}query other():\n  return exists roles[principal = viewer] by byPrincipal where .role != 'admin'\n"))]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
}

#[test]
fn union_sync_names_a_synced_child_instead_of_an_already_online_child() {
    let source = "table parents:\n  owner: principal\n  reader: principal\n  immutable owner, reader\n  read <- .owner = viewer or .reader = viewer\n  sync\ntable online:\n  parent: parents\n  immutable parent\n  read through .parent\n  online only\ntable synced:\n  parent: parents\n  immutable parent\n  read through .parent\n  sync\n";
    let b = compile(&[("schema.q".into(), source.into())]);
    let d = b.diagnostics.iter().find(|d| d.code == "E_SYNC" && d.message.contains("child cannot inherit")).unwrap_or_else(|| panic!("{:?}", b.diagnostics));
    assert!(d.message.contains("make synced `online only`") && !d.message.contains("make online"), "{d}");
    assert!(d.message.contains("copy the deciding"), "{d}");
    let repaired = source.replace("  read through .parent\n  sync", "  read through .parent\n  online only");
    let b = compile(&[("schema.q".into(), repaired)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
}

#[test]
fn unresolved_extra_read_rule_tests_never_prove_visibility() {
    let schema = "table staff:\n  principal: principal\n  tag: text <=10\n  unique principal\n  read <- .principal = viewer\n  online only\ntable approvals:\n  job: id\n  tag: text <=10\n  unique job\n  read <- exists staff[principal = viewer, tag = .tag]\n  online only\n";
    for (pin, role, count) in [
        ("job = job", "principal = viewer", 1),
        ("job = job, tag = 'green'", "principal = viewer", 1),
        ("job = job, tag = 'green'", "principal = viewer, tag = 'green'", 0),
    ] {
        let source = format!("{schema}mutation upload(job: id):\n  require exists staff[{role}] else FORBIDDEN\n  require not exists approvals[{pin}] else JOB_APPROVED\n  return null\n");
        let b = compile(&[("schema.q".into(), source)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        assert_eq!(b.notes.iter().filter(|n| n.code == "N_UNREADABLE_PROBE").count(), count, "{:?}", b.notes);
    }
}

#[test]
fn helper_writes_and_loop_backedges_invalidate_role_evidence() {
    let helper = "fn dropStaff():\n  delete staff[viewer]\n  return null\n";
    for tail in [
        "mutation upload(job: id):\n  require exists staff[viewer] else FORBIDDEN\n  dropStaff()\n  require not exists approvals[job] else JOB_APPROVED\n  return null\n",
        "mutation upload(job: id):\n  require exists staff[viewer] else FORBIDDEN\n  for iteration in [1, 2]:\n    require not exists approvals[job] else JOB_APPROVED\n    delete staff[viewer]\n  return null\n",
        "mutation upload(job: id):\n  require exists staff[viewer] else FORBIDDEN\n  for iteration in [1, 2]:\n    require not exists approvals[job] else JOB_APPROVED\n    dropStaff()\n  return null\n",
    ] {
        assert_eq!(notes(&format!("{helper}{tail}")).len(), 1, "{tail}");
    }
    // Fresh readable evidence acquired in each iteration still suffices.
    let tail = "mutation upload(job: id):\n  for iteration in [1, 2]:\n    require exists staff[viewer] else FORBIDDEN\n    require not exists approvals[job] else JOB_APPROVED\n    dropStaff()\n  return null\n";
    assert!(notes(&format!("{helper}{tail}")).is_empty());
}

#[test]
fn expression_effects_and_loop_exits_never_resurrect_role_facts() {
    let cases = [
        "mutation upload(job: id):\n  require exists staff[viewer] else FORBIDDEN\n  return { removed: delete staff[viewer], allowed: true if not exists approvals[job] else false }\n",
        "mutation upload(job: id):\n  require exists staff[viewer] else FORBIDDEN\n  for iteration in [1, 2]:\n    delete staff[viewer]\n    break\n    require exists staff[viewer] else FORBIDDEN\n  require not exists approvals[job] else JOB_APPROVED\n  return null\n",
        "mutation upload(job: id):\n  require exists staff[viewer] else FORBIDDEN\n  for iteration in [1, 2]:\n    delete staff[viewer]\n    if true:\n      break\n    require exists staff[viewer] else FORBIDDEN\n  require not exists approvals[job] else JOB_APPROVED\n  return null\n",
    ];
    for source in cases { assert_eq!(notes(source).len(), 1, "{source}"); }
}

#[test]
fn loop_domain_conditionals_are_guarded_reads_too() {
    assert_eq!(notes("query pick(job: id):\n  for i in [1] if not exists approvals[job] else []:\n    return i\n  return null\n").len(), 1);
    assert!(notes("query pick(job: id):\n  require exists staff[viewer] else FORBIDDEN\n  for i in [1] if not exists approvals[job] else []:\n    return i\n  return null\n").is_empty());
}

#[test]
fn typed_id_keys_do_not_borrow_a_principal_keys_visibility_proof() {
    let source = "mutation check(id: id):\n  require id = viewer else WRONG_ID\n  require not exists staff[id] else ALREADY\n  return null\n";
    assert_eq!(notes(source).len(), 1);
    let schema = "table teams:\n  public 'teams'\ntable staff:\n  owner: principal\n  team: teams\n  principal: principal\n  unique id, owner\n  unique team, principal\n  read <- .principal = viewer\n  online only\nmutation check(row: staff):\n  require not exists staff[row, viewer] else ALREADY\n  return null\n";
    let b = compile(&[("schema.q".into(), schema.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert_eq!(b.notes.iter().filter(|n| n.code == "N_UNREADABLE_PROBE").count(), 1, "{:?}", b.notes);
}

#[test]
fn a_viewer_prefix_on_another_full_key_is_not_a_principal_pin() {
    let source = "table staff:\n  principal: principal\n  reader: principal\n  tag: text <=10\n  unique principal\n  unique reader, tag\n  read <- .principal = viewer\n  online only\nmutation upload():\n  require not exists staff[viewer, 'green'] else NO\n  return null\n";
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert_eq!(b.notes.iter().filter(|n| n.code == "N_UNREADABLE_PROBE").count(), 1, "{:?}", b.notes);
}

#[test]
fn reachable_helpers_shapes_and_spreads_expose_guard_reads_and_writes() {
    for tail in [
        "fn approved(job: id): exists approvals[job]\nmutation upload(job: id):\n  require not approved(job) else JOB_APPROVED\n  return null\n",
        "fn check(job: id):\n  require not exists approvals[job] else JOB_APPROVED\n  return null\nmutation upload(job: id):\n  check(job)\n  return null\n",
        "shape check = { allowed: true if not exists approvals[.id] else false }\nmutation upload(job: id):\n  return { id: job } check\n",
        "shape check = { allowed: true if not exists approvals[.id] else false }\nshape outer = { ...check }\nmutation upload(job: id):\n  return { id: job } outer\n",
        "shape dropRole = { removed: delete staff[viewer] }\nmutation upload(job: id):\n  require exists staff[viewer] else FORBIDDEN\n  x = { value: true } dropRole\n  require not exists approvals[job] else JOB_APPROVED\n  return null\n",
    ] { assert_eq!(notes(tail).len(), 1, "{tail}"); }
}

#[test]
fn local_existence_values_are_not_reclassified_as_visible_after_a_later_grant() {
    // Observe the probe before later role evidence; aliases cannot hide that observation.
    let tail = "mutation upload(job: id):\n  allowed = not exists approvals[job]\n  require exists staff[viewer] else FORBIDDEN\n  require allowed else JOB_APPROVED\n  return null\n";
    assert_eq!(notes(tail).len(), 1);
}

#[test]
fn a_job_is_exempt_only_outside_its_viewer_scope() {
    let tail = "job upload():\n  for approval in approvals:\n    as 'user:designer':\n      require not exists approvals[approval.job] else JOB_APPROVED\n";
    assert_eq!(notes(tail).len(), 1);
}

#[test]
fn binding_only_loops_do_not_reuse_a_team_grant_after_rebinding() {
    let schema = "table teams:\n  public 'teams'\ntable staff:\n  team: teams\n  principal: principal\n  unique team, principal\n  read <- .principal = viewer\n  online only\ntable approvals:\n  team: teams\n  job: id\n  unique team, job\n  read <- exists staff[.team, viewer]\n  online only\n";
    for tail in [
        "mutation upload(a: teams, b: teams, job: id):\n  t = a\n  require exists staff[t, viewer] else FORBIDDEN\n  for iteration in [1, 2]:\n    require not exists approvals[team = t, job = job] else JOB_APPROVED\n    t = b\n  return null\n",
        "mutation upload(a: teams, b: teams, job: id):\n  t = a\n  require exists staff[t, viewer] else FORBIDDEN\n  for iteration in [1, 2]:\n    t = b\n    if true:\n      break\n    require exists staff[t, viewer] else FORBIDDEN\n  require not exists approvals[team = t, job = job] else JOB_APPROVED\n  return null\n",
    ] {
        let b = compile(&[("schema.q".into(), format!("{schema}{tail}"))]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        assert_eq!(b.notes.iter().filter(|n| n.code == "N_UNREADABLE_PROBE").count(), 1, "{:?}", b.notes);
    }
}

#[test]
fn helper_argument_proofs_cross_only_the_actual_argument_scope() {
    let schema = "table teams:\n  public 'teams'\ntable staff:\n  team: teams\n  principal: principal\n  unique team, principal\n  read <- .principal = viewer\n  online only\ntable approvals:\n  team: teams\n  job: id\n  unique team, job\n  read <- exists staff[.team, viewer]\n  online only\nfn check(t: teams, job: id):\n  require not exists approvals[team = t, job = job] else JOB_APPROVED\n  return null\n";
    for (arg, count) in [("t", 0), ("a", 1), ("b", 1)] {
        let source = format!("{schema}mutation upload(a: teams, b: teams, job: id):\n  t = a\n  require exists staff[team = t, principal = viewer] else FORBIDDEN\n  check({arg}, job)\n  return null\n");
        let b = compile(&[("schema.q".into(), source)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        // A caller-local t cannot prove a helper-local t passed another value.
        assert_eq!(b.notes.iter().filter(|n| n.code == "N_UNREADABLE_PROBE").count(), count, "{:?}", b.notes);
    }
    let source = format!("{schema}mutation upload(a: teams, job: id):\n  require exists staff[team = a, principal = viewer] else FORBIDDEN\n  check(a, job)\n  return null\n");
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(b.notes.iter().all(|n| n.code != "N_UNREADABLE_PROBE"), "{:?}", b.notes);
}

#[test]
fn argument_snapshots_cannot_match_another_actual_arguments_identifier() {
    let schema = "table teams:\n  public 'teams'\ntable docs:\n  team: teams\n  public 'docs'\ntable staff:\n  team: teams\n  principal: principal\n  unique team, principal\n  read <- .principal = viewer\n  online only\ntable approvals:\n  team: teams\n  job: id\n  unique team, job\n  read <- exists staff[.team, viewer]\n  online only\nfn check(doc: docs, scope: teams, job: id):\n  require not exists approvals[team = scope, job = job] else JOB_APPROVED\n  return null\nmutation upload(aId: docs, bId: docs, job: id):\n  a = docs[aId] ! else NOT_FOUND\n  diagSnapshot = docs[bId] ! else NOT_FOUND\n  require exists staff[team = a.team, principal = viewer] else FORBIDDEN\n  check(a, diagSnapshot.team, job)\n  return null\n";
    let b = compile(&[("schema.q".into(), schema.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert_eq!(b.notes.iter().filter(|n| n.code == "N_UNREADABLE_PROBE").count(), 1, "{:?}", b.notes);
}

#[test]
fn standalone_writing_helpers_preserve_order_then_invalidate_caller_evidence() {
    let helper = "fn checkThenDrop(job: id):\n  require not exists approvals[job] else JOB_APPROVED\n  delete staff[viewer]\n  return null\n";
    let source = format!("{helper}mutation upload(job: id):\n  require exists staff[viewer] else FORBIDDEN\n  checkThenDrop(job)\n  require not exists approvals[job] else JOB_APPROVED\n  return null\n");
    let found = notes(&source);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].site.line, 18); // Caller observation after the helper deleted the grant.
}

#[test]
fn requirement_wrappers_preserve_nested_negative_and_conditional_guards() {
    for condition in [
        "{ allowed: not exists approvals[job] }.allowed",
        "count([1] if not exists approvals[job] else []) = 1",
        "[not exists approvals[job]] = [true]",
    ] {
        assert_eq!(notes(&format!("mutation upload(job: id):\n  require {condition} else JOB_APPROVED\n  return null\n")).len(), 1, "{condition}");
        assert!(notes(&format!("mutation upload(job: id):\n  require exists staff[viewer] else FORBIDDEN\n  require {condition} else JOB_APPROVED\n  return null\n")).is_empty(), "{condition}");
    }
    assert!(notes("mutation upload(job: id):\n  require { allowed: exists approvals[job] }.allowed else JOB_APPROVED\n  return null\n").is_empty());
}

#[test]
fn query_prefix_aliases_used_as_guards_are_checked_at_observation_time() {
    let schema = format!("{}table docs:\n  job: id\n  public 'docs'\n", SCHEMA.replace("  unique job\n", "  unique job\n  by byJob: job, id\n"));
    for (tail, count) in [
        ("query upload(job: id):\n  allowed = not exists approvals[job = job] by byJob\n  require allowed else JOB_APPROVED\n  return null\n", 1),
        ("query upload(job: id):\n  allowed = not exists approvals[job = job] by byJob\n  observed = { allowed }\n  require observed.allowed else JOB_APPROVED\n  return null\n", 1),
        ("query upload(job: id):\n  observed = [not exists approvals[job = job] by byJob]\n  for allowed in observed:\n    require allowed else JOB_APPROVED\n  return null\n", 1),
        ("query upload(job: id):\n  observed = { allowed: not exists approvals[job = job] by byJob }\n  allowed = observed\n  require allowed.allowed else JOB_APPROVED\n  return null\n", 1),
        ("query upload(job: id):\n  allowed = not exists approvals[job = job] by byJob\n  require exists staff[viewer] else FORBIDDEN\n  require allowed else JOB_APPROVED\n  return null\n", 1),
        ("query upload(job: id):\n  require exists staff[viewer] else FORBIDDEN\n  allowed = not exists approvals[job = job] by byJob\n  require allowed else JOB_APPROVED\n  return null\n", 0),
        ("query upload(job: id):\n  allowed = false\n  if true:\n    allowed = not exists approvals[job = job] by byJob\n  require allowed else JOB_APPROVED\n  return null\n", 1),
        ("query upload(job: id):\n  allowed = not exists approvals[job = job] by byJob\n  return true if allowed else false\n", 1),
        ("query upload(job: id):\n  allowed = not exists approvals[job = job] by byJob\n  return allowed\n", 0),
        ("fn observed(job: id): not exists approvals[job = job] by byJob\nquery upload(job: id):\n  allowed = observed(job)\n  require allowed else JOB_APPROVED\n  return null\n", 1),
        ("fn observed(job: id): not exists approvals[job = job] by byJob\nquery upload(job: id):\n  return observed(job)\n", 0),
        ("fn check(allowed: bool):\n  require allowed else JOB_APPROVED\n  return null\nquery upload(job: id):\n  allowed = not exists approvals[job = job] by byJob\n  check(allowed)\n  return null\n", 1),
        ("fn check(allowed: bool):\n  require allowed else JOB_APPROVED\n  return null\nquery upload(job: id):\n  check(not exists approvals[job = job] by byJob)\n  return null\n", 1),
        ("query upload(job: id):\n  for allowed in [not exists approvals[job = job] by byJob]:\n    require allowed else JOB_APPROVED\n  return null\n", 1),
        ("shape check = { guarded: true if .allowed else false }\nquery upload(job: id):\n  return { allowed: not exists approvals[job = job] by byJob } check\n", 1),
        ("fn echo(allowed: bool): allowed\nquery upload(job: id):\n  return echo(not exists approvals[job = job] by byJob)\n", 0),
        ("shape echo = { allowed }\nquery upload(job: id):\n  return { allowed: not exists approvals[job = job] by byJob } echo\n", 0),
        ("query upload(job: id):\n  allowed = not exists approvals[job = job] by byJob\n  return docs where allowed first 10 by .id { guarded: true if .job = job else false }\n", 1),
        ("query upload(job: id):\n  return docs where not (exists approvals[job = job] by byJob) first 10 by .id { guarded: true if .job = job else false }\n", 1),
        ("query upload(job: id):\n  return docs where not (exists approvals[job = .job] by byJob) first 10 by .id { guarded: true if .job = job else false }\n", 0),
        ("fn echo(allowed: bool): allowed\nquery upload(job: id):\n  allowed = not exists approvals[job = job] by byJob\n  return echo(allowed)\n", 0),
        ("shape check = { guarded: true if .allowed else false }\nquery upload(job: id):\n  observed = { allowed: not exists approvals[job = job] by byJob }\n  return observed check\n", 1),
    ] {
        let b = compile(&[("schema.q".into(), format!("{schema}{tail}"))]);
        assert!(b.diagnostics.is_empty(), "{tail}: {:?}", b.diagnostics);
        assert_eq!(b.notes.iter().filter(|n| n.code == "N_UNREADABLE_PROBE").count(), count, "{tail}: {:?}", b.notes);
    }
}

#[test]
fn requirement_called_helpers_observe_direct_inputs_before_returned_inversion() {
    let schema = SCHEMA.replace("  unique job\n", "  unique job\n  by byJob: job, id\n");
    for probe in ["exists approvals[job]", "exists approvals[job = job] by byJob"] {
        for helper in [
            "fn check(hit: bool):\n  require not hit else JOB_APPROVED\n  return true\n",
            "fn check(hit: bool): not hit\n",
        ] {
            for role in ["", "  require exists staff[viewer] else FORBIDDEN\n"] {
                let source = format!("{schema}{helper}query upload(job: id):\n{role}  require check({probe}) else JOB_APPROVED\n  return null\n");
                let b = compile(&[("schema.q".into(), source)]);
                assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
                assert_eq!(b.notes.iter().filter(|n| n.code == "N_UNREADABLE_PROBE").count(), usize::from(role.is_empty()), "{:?}", b.notes);
            }
        }
        for role in ["", "  require exists staff[viewer] else FORBIDDEN\n"] {
            let source = format!("{schema}shape check = {{ absent: not .hit }}\nquery upload(job: id):\n{role}  require ({{ hit: {probe} }} check).absent else JOB_APPROVED\n  return null\n");
            let b = compile(&[("schema.q".into(), source)]);
            assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
            assert_eq!(b.notes.iter().filter(|n| n.code == "N_UNREADABLE_PROBE").count(), usize::from(role.is_empty()), "{:?}", b.notes);
        }
    }
}
