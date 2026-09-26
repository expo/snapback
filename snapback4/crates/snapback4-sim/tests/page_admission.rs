//! Compiler-observation exception: check-time refusals have no runtime body or receipt; compare diagnostics, never a hidden population.
use serde_json::json;
use snapback4_core::{Context, Engine, Value, WriteState, wire};
#[path = "common/write_observation.rs"]
mod observation;

const SOURCE: &str = r#"
table items:
  owner: principal
  amount: int
  text: text <=100
  expiresAt: time ?
  by byOwner: owner, id
  by byWords: owner, words(text), id
  by byExpiry: expiresAt
  read <- .owner = viewer
  update <- allow
  sync to .owner last 20 by byOwner
query page(owner: principal):
  return items[owner] first 10 by byOwner
"#;
fn compile(source: &str) -> snapback4_lang::Bound { snapback4_lang::compile(&[("schema.q".into(), source.into())]) }

fn short_circuit_page_pairs(allowed: bool) {
    for form in ["and", "or"] {
        for equality in [false, true] {
            for work in [0, 8191] {
                let first = if equality { "exists secrets[owner = viewer, enabled = true]" } else { "exists secrets[owner = viewer]" };
                // De Morgan's mirror still denies in both worlds, but its inner
                // `or` short-circuits true at the first or second negated probe.
                let denied = if form == "and" { format!("{first} and exists permits[owner = viewer]") }
                    else { format!("not (not {first} or not exists permits[owner = viewer])") };
                let secret_rule = if allowed { "deny" } else { &denied };
                let targets = if allowed { format!("table targets:\n  read <- not ({denied})\n") } else { String::new() };
                let page_table = if allowed { "targets" } else { "secrets" };
                let source = format!("table secrets:\n  owner: principal\n  enabled: bool\n  unique byOwner: owner\n  read <- {secret_rule}\ntable permits:\n  owner: principal\n  unique byOwner: owner\n  read <- deny\ntable work:\n  read <- exists work[.id]\n{targets}mutation pass(): server\n  for i in range(0, {work}):\n    r = work[id = 'work']\n  rows = {page_table}[] first 1 by byId\n  return 7\nquery one():\n  return null\n");
                let mut observations = Vec::new();
                for first_matches in [false, true] {
                    let b = compile(&source);
                    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
                    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
                    let mut rows = vec![("work", json!({"id":"work"}))];
                    if equality || first_matches { rows.push(("secrets", json!({"id":"secret","owner":"bob","enabled":first_matches}))); }
                    if allowed { rows.push(("targets", json!({"id":"target"}))); }
                    let rows = rows.into_iter().map(|(table, row)| (table.into(), wire::row_from_json(e.schema().table(table).unwrap(), &row).unwrap())).collect::<Vec<_>>();
                    e.seed(rows).unwrap();
                    assert!(e.store().rows("permits").unwrap().is_empty());
                    assert_eq!(e.store().rows("secrets").unwrap().len(), usize::from(equality || first_matches));
                    let (result, observed) = observation::observe(&mut e, "pass", "bob", json!({}), "same", ("one", json!({})));
                    if work == 0 { assert!(matches!(result.state, WriteState::Sent { result: Value::Int(7), .. })); }
                    else {
                        assert_eq!(observed.body()["why"]["code"], "E_BOUND");
                        assert!(matches!(&result.state, WriteState::Failed { why, .. } if why.message == "rule probes reached the ceiling 8192"), "{:?}", result.state);
                    }
                    assert_eq!(result.metered.rule_probes, work + 2);
                    assert_eq!(result.metered.examined, work + 1 + u64::from(allowed && work == 0));
                    assert_eq!(result.metered.rows_written, 0);
                    observed.assert_unchanged();
                    observations.push(observed);
                }
                observations[0].assert_same(&observations[1]);
                println!("W5 allowed={allowed} form={form} equality={equality} prelude={work}: {:?}", observations[0].meter);
            }
        }
    }
}

#[test]
fn w5_uniform_denied_short_circuit_pages_have_identical_complete_observations() {
    short_circuit_page_pairs(false);
}

#[test]
fn w5_uniform_allowed_short_circuit_pages_have_identical_complete_observations() {
    short_circuit_page_pairs(true);
}

#[test]
fn w5_query_verdicts_charge_the_allowance_without_the_mutation_attempt() {
    for allowed in [false, true] {
        for ceiling in [1, 8192] {
            let denied = "exists secrets[owner = viewer] and exists permits[owner = viewer]";
            let rule = if allowed { format!("not ({denied})") } else { denied.to_owned() };
            let source = format!("table secrets:\n  owner: principal\n  until: time\n  unique byOwner: owner\n  by byExpiry: until\n  expire at .until\n  read <- deny\ntable permits:\n  owner: principal\n  unique byOwner: owner\n  read <- deny\ntable targets:\n  read <- {rule}\nquery page():\n  return targets[] first 1 by byId\n");
            let mut meters = Vec::new();
            for hidden in [false, true] {
                let b = compile(&source);
                assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
                let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
                let mut rows = vec![("targets", json!({"id":"target"}))];
                if hidden { rows.push(("secrets", json!({"id":"secret","owner":"bob","until":2000}))); }
                let rows = rows.into_iter().map(|(table, row)| (table.into(), wire::row_from_json(e.schema().table(table).unwrap(), &row).unwrap())).collect::<Vec<_>>();
                e.seed(rows).unwrap();
                e.set_ceilings(snapback4_core::meter::Ceilings { rule_probes: ceiling, ..e.ceilings() });
                let page = e.query("page", Context::new("bob", [].into()).at(1000)).unwrap();
                assert_eq!(page.complete, ceiling >= 2);
                assert_eq!(page.data.as_array().unwrap().len(), usize::from(allowed && ceiling >= 2));
                assert_eq!(page.metered.rule_probes, 2);
                assert_eq!(page.metered.examined, u64::from(allowed && ceiling >= 2));
                if !allowed { assert_eq!(page.next_expiry, None, "a denied verdict withholds hidden expiry even at a cap"); }
                meters.push(page.metered);
            }
            assert_eq!(meters[0], meters[1]);
        }
    }
}

fn world(source: &str, hidden: usize, expired: bool) -> Engine {
    let b = compile(source);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let rows = (0..hidden).map(|n| json!({"id":format!("hidden{n:05}"),"owner":"alice","amount":0,"text":format!("word{n:05}"),"expiresAt":if expired {json!(1)} else {json!(null)}}))
        .chain([json!({"id":"own","owner":"bob","amount":0,"text":"visible","expiresAt":null})])
        .map(|r| ("items".into(), wire::row_from_json(e.schema().table("items").unwrap(), &r).unwrap())).collect::<Vec<_>>();
    e.seed(rows).unwrap();
    e
}
fn refused_pair(base: &str, operation: &str, population: usize, expired: bool, code: &str, reason: &str) {
    let mut observations = Vec::new();
    for hidden in [0, population] {
        let mut e = world(base, hidden, expired);
        assert_eq!(e.store().rows("items").unwrap().len(), hidden + 1);
        let before = e.store().rows("items").unwrap();
        let b = compile(&format!("{base}\n{operation}"));
        let errors = b.diagnostics.iter().map(|d| json!({"code":d.code,"message":d.message,"rewrite":d.rewrite,"site":d.site.to_string()})).collect::<Vec<_>>();
        assert!(b.diagnostics.iter().any(|d| d.code == code && d.message.contains(reason)), "{:?}", b.diagnostics);
        assert!(!b.programs.iter().any(|p| p.program.name == "pass"));
        assert_eq!(e.store().rows("items").unwrap(), before);
        assert!(e.effects(None, 10).unwrap().is_empty());
        observations.push(json!({"check":errors,"readable":wire::to_json(&e.query("page", Context::new("bob", [("owner".into(), Value::Id("bob".into()))].into()).at(1000)).unwrap().data)}));
    }
    assert_eq!(observations[0], observations[1]);
}

#[test]
fn w2_hidden_word_expansion_and_expired_populations_are_refused_at_check() {
    refused_pair(SOURCE, "mutation pass(): server\n  for r in items['alice'] matching 'word' first 10 by byWords:\n    update items[r] {amount: 1}\n", 40, false, "E_STRUCTURAL_FANOUT", "matching word scans");
    refused_pair(SOURCE, "mutation pass(): server\n  rows = items['alice'] matching 'word' first 10 by byWords\n  return count(rows)\n", 40, false, "E_STRUCTURAL_FANOUT", "matching word scans");
    let expires = SOURCE.replace("  read <-", "  expire at .expiresAt\n  read <-");
    refused_pair(&expires, "mutation pass(): server\n  for r in items['alice'] first 10 by byOwner:\n    update items[r] {amount: 1}\n", 9000, true, "E_STRUCTURAL_FANOUT", "expiry");
    refused_pair(&expires, "mutation pass(): server\n  rows = items['alice'] first 10 by byOwner\n  return count(rows)\n", 9000, true, "E_STRUCTURAL_FANOUT", "expiry");
    refused_pair(SOURCE, "mutation pass(): server\n  rows = merge items first 10 by byOwner:\n    ['alice']\n    ['bob']\n  for r in rows:\n    update items[r] {amount: 1}\n", 40, false, "E_STRUCTURAL_FANOUT", "merge");
}

#[test]
fn w2_a_mutation_binding_a_nonuniform_page_is_refused_with_zero_or_ten_thousand_hidden_rows() {
    refused_pair(SOURCE, "mutation pass(): server\n  rows = items[] first 10 by byOwner\n  return count(rows)\n", 10_000, false, "E_STRUCTURAL_FANOUT", "the mutation page's read rule is not uniformly decided by its prefix");
}

#[test]
fn w2_a_uniform_hidden_page_after_metered_work_has_the_same_complete_observation() {
    for budget in ["steps", "examined", "probes"] {
        let base = if budget == "probes" { SOURCE.replace("read <- .owner = viewer", "read <- exists grants[.owner, viewer]").replace("  sync to .owner last 20 by byOwner\n", "") } else { SOURCE.into() };
        let grants = "\ntable grants:\n  owner: principal\n  reader: principal\n  unique byPair: owner, reader\n  read <- allow\n";
        let work = if budget == "steps" { "  n = 0\n  for i in range(0, 100):\n    n = n + 1\n" } else { "  n = 0\n  for i in range(0, 8192):\n    r = items[id = 'own']\n    n = n + 1\n" };
        let source = format!("{base}{grants}\nmutation pass(): server\n{work}  rows = items['alice'] first 10 by byOwner\n  return n + count(rows)\n");
        let mut observations = Vec::new();
        for hidden in [0, 1, 10_000] {
            let mut e = world(&source, hidden, false);
            let grant = wire::row_from_json(e.schema().table("grants").unwrap(), &json!({"id":"grant","owner":"bob","reader":"bob"})).unwrap();
            e.seed([("grants".into(), grant)]).unwrap();
            let (result, observation) = observation::observe(&mut e, "pass", "bob", json!({}), "same", ("page", json!({"owner":"bob"})));
            if budget == "steps" { assert!(matches!(result.state, WriteState::Sent { result: Value::Int(100), .. })); }
            else { assert_eq!(observation.body()["why"]["code"], "E_BOUND"); }
            assert_eq!(result.metered.examined, if budget == "steps" {1} else {8193});
            assert_eq!(result.metered.rule_probes, if budget == "probes" {8192} else {0});
            assert_eq!(result.metered.rows_written, 0);
            observations.push(observation);
        }
        for pair in observations.windows(2) { pair[0].assert_same(&pair[1]); }
    }
}

#[test]
fn w3_uniform_page_with_expiring_rule_probe_has_no_population_oracle() {
    let source = format!("{}\ntable grants:\n  owner: principal\n  expiresAt: time\n  by byOwner: owner\n  by byExpiry: expiresAt\n  expire at .expiresAt\n  read <- deny\nmutation pass(): server\n  rows = items['alice'] first 10 by byOwner\n  return count(rows)\n", SOURCE.replace("read <- .owner = viewer", "read <- exists grants[owner = .owner]").replace("  sync to .owner last 20 by byOwner\n", ""));
    for admitted in [false, true] {
        let mut observations = Vec::new();
        let mut exhausted = Vec::new();
        for expired in [0, 8000, 9000, 20000] {
            let mut e = world(&source, 1, false);
            let rows = (0..expired).map(|n| json!({"id":format!("g{n:05}"),"owner":"alice","expiresAt":1}))
                .chain([json!({"id":"live-or-decoy","owner":if admitted {"alice"} else {"nobody"},"expiresAt":2000})])
                .map(|r| ("grants".into(), wire::row_from_json(e.schema().table("grants").unwrap(), &r).unwrap())).collect::<Vec<_>>();
            e.seed(rows).unwrap();
            let (result, observation) = observation::observe(&mut e, "pass", "bob", json!({}), "same", ("page", json!({"owner":"bob"})));
            if expired >= 8192 {
                assert!(matches!(&result.state, WriteState::Failed { why, .. } if why.code == "E_RULE"));
                exhausted.push(observation);
                continue;
            }
            assert!(matches!(result.state, WriteState::Sent { result: Value::Int(n), .. } if n == i64::from(admitted)));
            assert_eq!((result.metered.examined, result.metered.rule_probes), if admitted {(2, 1)} else {(1, 1)});
            observations.push(observation);
        }
        observations[0].assert_same(&observations[1]);
        exhausted[0].assert_same(&exhausted[1]);
    }
}

#[test]
fn w3_serialized_nonlooping_merge_without_merge_site_is_refused() {
    use snapback4_core::ir::*;
    let bound = compile(SOURCE);
    let mut program = bound.programs.iter().find(|p| p.program.name == "page").unwrap().program.clone();
    let mut scan = scans(&program)[0].clone(); scan.merge_site = None;
    program.kind = ProgramKind::Mutation;
    program.body = vec![Stmt::Let { name: "rows".into(), value: Expr::Merge(Merge { variant: None, position: None, view: None, order_keys: Vec::new(), site: "structural".into(), lanes: vec![MergeLane { guard: None, distinct: None, branch: None, project: None, setup: vec![], scan: scan.clone(), source: None, binding: "r".into() }] }) }, Stmt::Return(Expr::Literal(Value::Null))];
    let serialized: Program = serde_json::from_str(&serde_json::to_string(&program).unwrap()).unwrap();
    let why = snapback4_core::engine::admission::check(&bound.schema, &serialized).unwrap_err().refusal();
    assert_eq!(why.code, "E_STRUCTURAL_FANOUT");
    assert!(why.message.contains("merge"));
    // The same merely-bound plain prefix is a positive structural control.
    program.body[0] = Stmt::Let { name: "rows".into(), value: Expr::Scan(scan) };
    snapback4_core::engine::admission::check(&bound.schema, &program).unwrap();
}

#[test]
fn w3_predicting_bound_word_page_is_refused_independently_of_hidden_population() {
    refused_pair(SOURCE, "mutation pass():\n  rows = items['alice'] matching 'word' first 10 by byWords\n  return count(rows)\n", 8193, false, "E_STRUCTURAL_FANOUT", "matching word scans");
    let positive = compile(&format!("{SOURCE}\nmutation pass():\n  rows = items['alice'] first 10 by byOwner\n  return count(rows)\n"));
    assert!(positive.diagnostics.is_empty(), "{:?}", positive.diagnostics);
    assert_ne!(positive.schema.operations["pass"].predicts.as_deref(), Some("never"));
}

#[test]
fn w3_upsert_condition_is_one_compiler_refusal_and_update_condition_is_admitted() {
    let operation = "mutation pass(key: items):\n  upsert items[key] {amount: 0} if .amount = 7\n";
    refused_pair(SOURCE, operation, 10_000, false, "E_QUARRY_UNKNOWN", "upsert cannot take a condition");
    let b = compile(&format!("{SOURCE}\n{operation}"));
    assert_eq!(b.diagnostics.len(), 1);
    assert_eq!(b.diagnostics[0].rewrite, "a condition belongs on update; an upsert inserts or patches");
    assert!(compile(&format!("{SOURCE}\n{}", operation.replace("upsert", "update"))).diagnostics.is_empty());
}


#[test]
fn w4_negated_self_probe_empty_and_hidden_pages_match_at_probe_ceiling() {
    // Repeated unchanged points reuse the physical fetch. Both logical
    // ceilings still cut before discovering the hidden population.
    for (work, probe_ceiling) in [(0, 8192), (8192, 8192), (4, 4)] {
        let source = format!("table secrets:\n  read <- deny\ntable work:\n  read <- exists work[.id]\nmutation pass(): server\n  for i in range(0, {work}):\n    r = work[id = 'work']\n  rows = secrets[] first 1 by byId\n  return count(rows)\nquery one():\n  return null\n");
        let mut observations = Vec::new();
        for hidden in [false, true] {
            let mut b = compile(&source);
            assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
            // Literal reference IDs enter through schema IR; this is exactly
            // `read <- not exists secrets[id = 'sentinel']` at the engine boundary.
            b.schema.tables.get_mut("secrets").unwrap().rules.read = snapback4_core::schema::RuleExpr::Not(Box::new(snapback4_core::schema::RuleExpr::Exists {
                table: "secrets".into(), index: "byId".into(), key: vec![snapback4_core::schema::RuleTerm::Literal(Value::Id("sentinel".into()))],
                equalities: vec![], provenance: snapback4_core::ir::KeyProvenance::Const,
            }));
            let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
            let mut rows = vec![("work".into(), snapback4_core::value::object([("id", Value::Id("work".into()))]))];
            if hidden { rows.push(("secrets".into(), snapback4_core::value::object([("id", Value::Id("sentinel".into()))]))); }
            e.seed(rows).unwrap();
            e.set_ceilings(snapback4_core::meter::Ceilings { rule_probes: probe_ceiling, ..e.ceilings() });
            let (result, observed) = observation::observe(&mut e, "pass", "bob", json!({}), "same", ("one", json!({})));
            if work == 0 { assert!(matches!(result.state, WriteState::Sent { result: Value::Int(0), .. })); }
            else { assert_eq!(observed.body()["why"]["code"], "E_BOUND"); }
            assert_eq!((result.metered.examined, result.metered.rule_probes), match work { 0 => (1, 1), 4 => (5, 5), _ => (8193, 8192) });
            observations.push(observed);
        }
        observations[0].assert_same(&observations[1]);
    }
}

const MAINTAIN_PROBE: &str = "table sources:\n  group: text <=10\n  amount: int\n  until: time ?\n  by byGroup: group, id\n  by byExpiry: until\n  expire at .until\n  read <- deny\nmaintain totals: sum sources of amount by group\n  read <- deny\ntable targets:\n  group: text <=10\n  amount: int\n  by byGroup: group, id\n  read <- exists totals[group = .group]\n  update <- allow\nmutation pass(): server\n  rows = targets['g'] first 1 by byGroup\n  return count(rows)\nquery one():\n  return null\n";
fn maintain_probe_world(source: &str, population: usize, live: bool) -> Engine {
    let b = compile(source);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let sources = (0..population).map(|n| json!({"id":format!("expired{n:05}"),"group":"g","amount":0,"until":1}))
        .chain([json!({"id":"live","group":if live {"g"} else {"other"},"amount":2,"until":2000})]);
    let rows = sources.map(|r| ("sources".into(), wire::row_from_json(e.schema().table("sources").unwrap(), &r).unwrap()))
        .chain([("targets".into(), wire::row_from_json(e.schema().table("targets").unwrap(), &json!({"id":"target","group":"g","amount":0})).unwrap())]).collect::<Vec<_>>();
    e.seed(rows).unwrap();
    e
}

#[test]
fn w4_live_maintain_existence_walk_has_one_probe_with_bounded_expired_sources() {
    for live in [false, true] {
        let mut observations = Vec::new();
        for population in [0, 8000, 9000, 20000] {
            let mut e = maintain_probe_world(MAINTAIN_PROBE, population, live);
            let (result, observed) = observation::observe(&mut e, "pass", "bob", json!({}), "same", ("one", json!({})));
            assert!(matches!(result.state, WriteState::Sent { result: Value::Int(n), .. } if n == i64::from(live)));
            assert_eq!((result.metered.rule_probes, result.metered.examined), (1, if live {2} else {1}));
            observations.push(observed);
        }
        for observation in &observations[1..] { observations[0].assert_same(observation); }
    }
}

#[test]
fn w4_live_maintain_probe_equalities_ignore_expired_contributions() {
    for effect in ["read", "update"] {
        let base = if effect == "read" { MAINTAIN_PROBE.to_owned() } else {
            MAINTAIN_PROBE.replace("read <- exists totals[group = .group]", "read <- deny").replace("update <- allow", "update <- exists totals[group = .group]")
                .replace("  rows = targets['g'] first 1 by byGroup\n  return count(rows)", "  update targets[id = 'target'] {amount: 1}")
        };
        let source = base.replace("exists totals[group = .group]", "exists totals[group = .group, value = 2]");
        let refused = compile(&source);
        assert_eq!(refused.diagnostics.len(), 1, "{:?}", refused.diagnostics);
        assert_eq!(refused.diagnostics[0].code, "E_QUARRY_LIVE_MAINTAIN_PROBE");
        assert_eq!(refused.diagnostics[0].rewrite, "read the view in the program; its live value cannot be probed at one unit");
        assert_eq!(refused.diagnostics[0].guide, "expire");
        // Non-expiring maintains retain equality support: same total from 1 or
        // 9,001 sources, one probe, with an actually admitted page/write.
        let control = source.replace("  expire at .until\n", "");
        let mut observations = Vec::new();
        for population in [0, 9000] {
            let mut e = maintain_probe_world(&control, population, true);
            let (result, observed) = observation::observe(&mut e, "pass", "bob", json!({}), "same", ("one", json!({})));
            assert!(matches!(result.state, WriteState::Sent { .. }));
            assert_eq!(result.metered.rule_probes, 1);
            if effect == "read" { assert!(matches!(result.state, WriteState::Sent { result: Value::Int(1), .. })); }
            else { assert_eq!(e.store().rows("targets").unwrap()[0].field("amount"), Ok(&Value::Int(1))); }
            observations.push(observed);
        }
        observations[0].assert_same(&observations[1]);
    }
}

#[test]
fn w14b_expiry_rewrite_names_query_and_job_doors() {
    let expires = SOURCE.split("query page(").next().unwrap().replace("  read <-", "  expire at .expiresAt\n  read <-");
    let bound = compile(&format!("{expires}\nmutation pass(): server\n  rows = items['alice'] first 10 by byOwner\n  return count(rows)\n"));
    let diagnostic = bound.diagnostics.iter().find(|d| d.code == "E_STRUCTURAL_FANOUT").unwrap();
    assert!(diagnostic.message.contains("a mutation page cannot scan a table with expiry"));
    assert_eq!(diagnostic.rewrite, "read this page in a query, then pass the selected ids to the mutation; or use a job chunk, which may read a table with expiry");
    let allowed = compile(&format!("{expires}\njob pass():\n  chunk r in items first 10 by byId:\n    update items[r.id] {{amount: 1}}\n"));
    assert!(allowed.diagnostics.is_empty(), "{:?}", allowed.diagnostics);
    assert!(allowed.notes.is_empty(), "{:?}", allowed.notes);
}
