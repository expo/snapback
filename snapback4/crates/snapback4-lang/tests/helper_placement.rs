use snapback4_lang::{Bound, compile};

const SOURCE: &str = include_str!("fixtures/qe/helper-sweep.q");

fn checked(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{source}\n{:?}", bound.diagnostics);
    bound
}

#[test]
fn helper_accumulation_inherits_the_recipient_loop() {
    checked(SOURCE);
    checked(&SOURCE.replace("n = unreadFor(p)", "n = wrapped(p)").replace(
        "job digest():", "fn wrapped(p: profiles):\n  return unreadFor(p)\njob digest():"));
}

#[test]
fn helper_break_and_continue_cannot_target_the_callers_loop() {
    for keyword in ["break", "continue"] {
        let source = SOURCE.replace("  total = 0", &format!("  {keyword}\n  total = 0"));
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_PLACEMENT"
            && d.message.contains(keyword) && d.message.contains("none here")), "{:?}", bound.diagnostics);
    }
    checked(&SOURCE.replace("    total = total + m.unread", "    if m.unread = 0:\n      continue\n    total = total + m.unread\n    if total > 100:\n      break"));
}

#[test]
fn top_level_helper_still_refuses_a_cross_chunk_accumulator() {
    let source = SOURCE.replace("job digest():\n  for p in profiles:\n    n = unreadFor(p)\n    if n > 0:\n      emit notify { target: p.principal, unread: n }", "job digest(p: principal):\n  n = unreadFor(p)\n  for m in members:\n    emit notify { unread: n }");
    let source = source.replace("fn unreadFor(p: profiles)", "fn unreadFor(p: principal)").replace("p.principal", "p");
    let bound = compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_PLACEMENT"
        && d.message.contains("automatic sweep carries local total")), "{:?}", bound.diagnostics);
}

#[test]
fn optional_filter_helper_uses_the_callers_sweep_placement() {
    let source = SOURCE.replace("fn unreadFor(p: profiles):", "fn unreadFor(p: profiles, amount: int ?):")
        .replace(".principal = p.principal:", ".principal = p.principal and (amount = null or .unread = amount) first 10 by .id:")
        .replace("job digest():", "job digest(amount: int ?):")
        .replace("unreadFor(p)", "unreadFor(p, amount)");
    checked(&source);
    let source = source.replace("  for p in profiles:\n    n = unreadFor(p, amount)\n    if n > 0:\n      emit notify { target: p.principal, unread: n }",
        "  n = unreadFor(p, amount)\n  for m in members:\n    emit notify { unread: n }")
        .replace("job digest(amount: int ?)", "job digest(p: principal, amount: int ?)")
        .replace("fn unreadFor(p: profiles,", "fn unreadFor(p: principal,").replace("p.principal", "p");
    let bound = compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_PLACEMENT"
        && d.message.contains("argument-presence")), "{:?}", bound.diagnostics);
}

#[test]
fn unbounded_optional_domains_still_need_a_page_bound_in_both_forms() {
    let helper = SOURCE.replace("fn unreadFor(p: profiles):", "fn unreadFor(p: profiles, amount: int ?):")
        .replace(".principal = p.principal:", ".principal = p.principal and (amount = null or .unread = amount):")
        .replace("job digest():", "job digest(amount: int ?):")
        .replace("unreadFor(p)", "unreadFor(p, amount)");
    let inline = helper.replace("    n = unreadFor(p, amount)", "    n = 0\n    for m in members where .principal = p.principal and (amount = null or .unread = amount):\n      n = n + m.unread");
    for source in [&helper, &inline] {
        let bound = compile(&[("schema.q".into(), source.clone())]);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_BOUND"
            && d.message.contains("this position needs a bounded page")), "{:?}", bound.diagnostics);
        assert!(!bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_PLACEMENT"));
    }
}

#[test]
fn comparative_three_accumulations_return_a_record_from_a_helper() {
    let source = include_str!("../../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/source/snapback/schema.q");
    let start = source.find("    unreadMessages = 0\n").unwrap();
    let end = source[start..].find("    newFollowers = ").unwrap() + start;
    let body = source[start..end].lines().map(|line| &line[2..]).collect::<Vec<_>>().join("\n");
    let helper = format!("fn digestFor(p: profiles, periodStart: time, periodEnd: time):\n{body}\n  return {{ unreadMessages, unreadChats, newPostsInFollowing }}\n");
    let source = source.replace(&source[start..end], "    totals = digestFor(p, periodStart, periodEnd)\n    unreadMessages = totals.unreadMessages\n    unreadChats = totals.unreadChats\n    newPostsInFollowing = totals.newPostsInFollowing\n")
        .replace("job digest(", &format!("{helper}job digest("));
    let bound = compile(&[
        ("schema.q".into(), source),
        ("windows.q".into(), include_str!("../../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/source/snapback/windows.q").into()),
        ("schedule.q".into(), include_str!("../../../../benchmarks/runs/2026-09-26-snapback4-clique-astra-0.4.3/astra/source/snapback/schedule.q").into()),
    ]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
}

#[test]
fn helper_and_inline_have_the_same_ir_apart_from_helper_temporaries() {
    let inline = SOURCE.replace("    n = unreadFor(p)", "    n = 0\n    for m in members where .principal = p.principal:\n      n = n + m.unread");
    let helper = checked(SOURCE).programs.remove(0).program;
    let inline = checked(&inline).programs.remove(0).program;
    assert_eq!(normalized(helper), normalized(inline));
}

// The fixture has a single final helper return: strip its unused return flag,
// initial result=null, and pure argument/result copies, then alpha-rename slots.
// No scan, condition, accumulation, emission, or effect payload is removed.
fn normalized(mut program: snapback4_core::ir::Program) -> serde_json::Value {
    use snapback4_core::ir::{Expr, Stmt};
    use std::collections::BTreeMap;
    fn strip(body: &mut Vec<Stmt>, aliases: &mut BTreeMap<String, String>) {
        body.retain_mut(|statement| match statement {
            Stmt::Let { name, .. } | Stmt::Assign { name, .. } if name.starts_with("$returned") => false,
            Stmt::Let { name, value: Expr::Literal(snapback4_core::Value::Null) } if name.starts_with("$result") => false,
            Stmt::Let { name, value: Expr::Variable(source) }
            | Stmt::Assign { name, value: Expr::Variable(source) } => {
                aliases.insert(name.clone(), source.clone()); false
            }
            Stmt::For { body, .. } => { strip(body, aliases); true }
            Stmt::If { then_body, else_body, .. } => { strip(then_body, aliases); strip(else_body, aliases); true }
            _ => true,
        });
    }
    fn rename(value: &mut serde_json::Value, aliases: &BTreeMap<String, String>, slots: &mut BTreeMap<String, String>) {
        match value {
            serde_json::Value::String(name) if name.starts_with('$') => {
                while let Some(source) = aliases.get(name) { *name = source.clone(); }
                let next = format!("$slot{}", slots.len());
                *name = slots.entry(name.clone()).or_insert(next).clone();
            }
            serde_json::Value::Array(items) => for item in items { rename(item, aliases, slots); },
            serde_json::Value::Object(fields) => for value in fields.values_mut() { rename(value, aliases, slots); },
            _ => {}
        }
    }
    let mut aliases = BTreeMap::new();
    strip(&mut program.body, &mut aliases);
    let mut value = serde_json::to_value(program).unwrap();
    rename(&mut value, &aliases, &mut BTreeMap::new());
    value
}

#[test]
fn helper_placement_is_restored_before_a_later_sweep() {
    let source = "effect notify\ntable t:\n  n: int\n  public\nfn zero(): 0\njob run():\n  total = 0\n  for r in t:\n    n = zero()\n  for r in t:\n    total = total + 1\n    emit notify { total }\n";
    let bound = compile(&[("schema.q".into(), source.into())]);
    let error = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_PLACEMENT")
        .unwrap_or_else(|| panic!("{:?}", bound.diagnostics));
    assert!(error.message.contains("automatic sweep carries local total"), "{error:?}");
    assert_eq!(error.site.line, 10);
}
