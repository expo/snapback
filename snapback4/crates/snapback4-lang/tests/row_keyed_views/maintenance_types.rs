use snapback4_core::{Context, Engine, Value, wire};
use serde_json::json;

fn base() -> String {
    include_str!("../../../snapback4-core/tests/row_view_witness/schema.q")
        .replace("PREDICATE", "allow").replace("MEMBER_EXPIRY", "")
}
fn refuse(tail: &str, field: &str) {
    let b = snapback4_lang::compile(&[("state.q".into(), base() + tail)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_VIEW_KEY" && d.message.contains(field) && d.rewrite.contains("value")), "{tail}\n{:?}", b.diagnostics);
}
#[test]
fn astra_nested_containers_and_all_nonreturn_reads_refuse() {
    for field in ["recountPending", "pending", "total"] {
        for tail in [
            format!("query bad():\n  for row in unread first 10:\n    box = {{ value: row }}\n    if box.value.{field}:\n      return true\n  return false\n"),
            format!("fn wrapped(row: unread):\n  box = {{ value: row }}\n  return box.value.{field}\nquery bad():\n  return unread first 10 {{ allowed: wrapped(.) }}\n"),
            format!("query bad():\n  for box in unread first 10 {{ value: . }}:\n    if box.value.{field}:\n      return true\n  return false\n"),
            format!("query bad():\n  for row in unread first 10:\n    box = {{ value: [row] }}\n    chosen = first(sort(box.value, '{field}'))\n    return chosen\n  return null\n"),
            format!("fn status(row: unread): row.{field}\nquery bad():\n  return unread first 10 {{ status: status(.) }}\n"),
            format!("query bad():\n  for row in unread first 10:\n    state = row.{field}\n    return state\n  return null\n"),
            format!("query bad():\n  return unread first 10 {{ state: .{field} = null }}\n"),
            format!("query bad():\n  values = unread first 10 {{ status: .{field} }}\n  return count(values)\n"),
            format!("mutation bad():\n  for row in unread first 10:\n    return row.{field}\n  return null\n"),
        ] { refuse(&tail, field); }
    }
    refuse("query bad():\n  for row in unread first 10:\n    box = { value: [row] }\n    return first(sort(box.value, '$private'))\n  return null\n", "$private");
    // Discarded reads, arithmetic, aggregates and implicit scalar computation
    // all refuse even when their final value is returned.
    for tail in [
        "query bad():\n  for row in unread first 10:\n    unused = row.recountPending\n  return true\n",
        "query bad():\n  return sum(unread first 10 { value: .recountPending })\n",
        "query bad():\n  return unread first 10 { value: .recountPending + 1 }\n",
    ] { refuse(tail, "recountPending"); }
}

#[test]
fn generated_container_helper_projection_compositions_keep_receiver_types() {
    let mut cases = 0;
    // Each composition is a row-valued expression: the negative leaf must be
    // the maintenance-field read, not a parser/type error in its wrappers.
    for seed in [7u64, 20261002, 0xdeadbeef, 0x5eed] {
        let mut random = seed;
        for _ in 0..24 {
            let mut row = "row".to_string();
            for _ in 0..4 {
                random ^= random << 13; random ^= random >> 7; random ^= random << 17;
                row = match random % 4 {
                    0 => format!("({{ value: {row} }}).value"),
                    1 => format!("(first([{row}]) ! else NOT_FOUND)"),
                    2 => format!("identity({row})"),
                    _ => format!("({row} {{ value: . }}).value"),
                };
            }
            let helpers = "fn identity(row: unread): row\n";
            let allowed = format!("{helpers}query good():\n  for row in unread first 10:\n    box = {row}\n    return box.value\n  return 0\n");
            let b = snapback4_lang::compile(&[("generated.q".into(), base() + &allowed)]);
            assert!(b.diagnostics.is_empty(), "{allowed}\n{:?}", b.diagnostics);
            for field in ["recountPending", "pending", "total", "$private"] {
                let replacement = if field == "$private" { "return count(sort([box], '$private'))".to_string() }
                    else { format!("if box.{field}:\n      return 1") };
                refuse(&allowed.replace("return box.value", &replacement), field);
                cases += 1;
            }
        }
    }
    eprintln!("BG round6 generated types: 4 seeds, 96 depth-4 container/helper/projection compositions, {cases} refusals and 96 value controls");
}

#[test]
fn direct_data_projection_and_whole_rows_return_exact_values() {
    let source = base() + "query status():\n  return unread first 10 { id, value, status: .recountPending, predicted: .pending }\nquery whole():\n  for row in unread first 10:\n    return row\n  return null\nquery wrapped():\n  for row in unread first 10:\n    box = { value: row }\n    return { status: box.value.recountPending }\n  return null\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let rows = [("rooms", json!({"id":"r"})), ("members", json!({"id":"u","room":"r","until":null})),
        ("messages", json!({"id":"m","room":"r","until":10}))].into_iter().map(|(table, row)|
        (table.to_string(), wire::row_from_json(&engine.schema().tables[table], &row).unwrap())).collect::<Vec<_>>();
    engine.seed_at(rows, 1).unwrap();
    for now in [2, 10, 20, 2] {
        let count = if now < 10 { 1 } else { 0 };
        for op in ["status", "whole", "rows", "wrapped"] {
            let result = engine.query(op, Context::new("reader", Default::default()).at(now)).unwrap();
            assert!(result.complete, "{op}: {result:?}");
            let row = if matches!(op, "status" | "rows") { &result.data.as_array().unwrap()[0] } else { &result.data };
            let state = if matches!(op, "status" | "wrapped") { "status" } else { "recountPending" };
            assert_eq!(row.field(state), Ok(&Value::Bool(false)), "{op}: {result:?}");
            if op != "wrapped" { assert_eq!(row.field("value"), Ok(&Value::Int(count)), "{op}: {result:?}"); }
            if op == "status" { assert_eq!(row.field("predicted"), Ok(&Value::Null)); }
        }
    }
}

#[test]
fn ordinary_objects_and_copied_member_total_are_not_maintenance_state() {
    let source = base().replace("  until: time ?\n  \n  cap", "  until: time ?\n  total: int default 1\n  cap")
        .replace("  cap 100 by room\n  public", "  cap 100 by room\n  read <- .total = 1")
        + "query good():\n  for row in unread first 10:\n    box = { value: row, recountPending: false }\n    if box.recountPending:\n      return 0\n    return box.value.total\n  return 0\nquery countAlias():\n  for row in unread first 10:\n    return row.count + 1\n  return 0\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
}

#[test]
fn whole_value_builtins_and_both_status_guesses_refuse() {
    for expected in ["false", "true", "expected"] {
        let guess = format!("{{ id: row.id, member: row.member, value: row.value, recountPending: {expected} }}");
        for expr in [format!("share(1, [row], {guess})"), format!("row = {guess}"), format!("min(row, row) = {guess}")] {
            refuse(&format!("query probe(expected: bool):\n  for row in unread first 10:\n    return {expr}\n  return 0\n"), "recountPending");
        }
    }
    refuse("query twoGuesses():\n  for row in unread first 10:\n    no = { id: row.id, member: row.member, value: row.value, recountPending: false }\n    yes = { id: row.id, member: row.member, value: row.value, recountPending: true }\n    return share(1, [no, yes], row)\n  return 0\n", "recountPending");
    // Whole rows, nested objects, lists and projections: even a later safe
    // projection cannot authorize the preceding inspection.
    for expr in [
        "min(row, row)", "max({nested: row}, {nested: row})", "min([row], [row])",
        "max(row { nested: . }, row { nested: . })", "(min(row, row)).value",
        "share(1, [row], row)", "share(1, [{nested: row}], {nested: row})",
        "sort([{nested: row}], 'nested')", "group([{nested: row}], 'nested')",
        "sort([row], 'id')", "group([row], 'id')", "min([row], .value)",
        "max([row], .value + 1)", "sum([row])", "sha256(row)", "join([row], '')",
        "lower(row)", "trim(row)", "tokens(row)", "day(row)",
        "row in [row]", "[row] = [row]", "row < row", "{nested: row} != {nested: row}",
        "'' + row", // already a type refusal; the diagnostic must name the field
    ] {
        refuse(&format!("query probe():\n  for row in unread first 10:\n    return {expr}\n  return null\n"), "recountPending");
    }
}

#[test]
fn non_inspecting_selectors_and_projected_computation_preserve_exact_data() {
    let mut source = base();
    for (name, expr) in [
        ("firstRow", "first([row])"), ("lastRow", "last([row])"), ("atRow", "at([row], 0)"),
        ("sliceRow", "first(slice([row], 0, 1))"), ("concatRow", "first([row] + [row])"),
        ("nestedRow", "({nested: [row]}).nested"), ("countRows", "count([row])"),
        ("compareValue", "min(row.value, row.value)"), ("shareIds", "share(1, [row.id], row.id)"),
        ("sortIds", "count(sort([{id: row.id}], 'id'))"), ("groupIds", "count(group([{id: row.id}], 'id'))"),
    ] {
        source += &format!("query {name}():\n  for row in unread first 10:\n    return {expr}\n  return null\n");
    }
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let rows = [("rooms", json!({"id":"r"})), ("members", json!({"id":"u","room":"r","until":null})),
        ("messages", json!({"id":"m","room":"r","until":10}))].into_iter().map(|(table, row)|
        (table.to_string(), wire::row_from_json(&engine.schema().tables[table], &row).unwrap())).collect::<Vec<_>>();
    engine.seed_at(rows, 1).unwrap();
    for now in [2, 10, 20, 2] {
        let query = |engine: &mut Engine, op| engine.query(op, Context::new("reader", Default::default()).at(now)).unwrap();
        let whole = query(&mut engine, "rows").data.as_array().unwrap()[0].clone();
        for op in ["firstRow", "lastRow", "atRow", "sliceRow", "concatRow"] {
            let r = query(&mut engine, op);
            assert!(r.complete);
            assert_eq!(r.data, whole, "{op} at {now}");
        }
        assert_eq!(query(&mut engine, "nestedRow").data, Value::Array(vec![whole]));
        for op in ["countRows", "shareIds", "sortIds", "groupIds"] { assert_eq!(query(&mut engine, op).data, Value::Int(1)); }
        assert_eq!(query(&mut engine, "compareValue").data, Value::Int(if now < 10 {1} else {0}));
    }
}

#[test]
fn grok_sorted_and_inspecting_mutations_refuse_but_point_extrema_stay_scalar() {
    for kind in ["query", "mutation"] {
        for choice in ["chosen = min(a, b)", "chosen = max(a, b)", "(discarded, chosen) = sorted(a, b)",
            "chosen = max(a { id, value }, b { id, value })"] {
            for result in ["return chosen.id", "if chosen.value > 0:\n        return chosen.value"] {
                let tail = format!("{kind} probe():\n  for a in unread first 10:\n    for b in unread first 10:\n      {choice}\n      {result}\n  return null\n");
                refuse(&tail, "recountPending");
            }
        }
    }
    let source = base() + "query scalar():\n  return min(unread['u'], unread['v'])\nquery scalarMax():\n  return max(unread['u'], unread['v'])\nquery scalarSorted():\n  (lo, hi) = sorted(unread['u'], unread['v'])\n  return {lo, hi}\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let rows = [("rooms", json!({"id":"r"})), ("members", json!({"id":"u","room":"r","until":null})),
        ("members", json!({"id":"v","room":"r","until":null})), ("messages", json!({"id":"m","room":"r","until":10}))]
        .into_iter().map(|(table, row)| (table.to_string(), wire::row_from_json(&engine.schema().tables[table], &row).unwrap())).collect::<Vec<_>>();
    engine.seed_at(rows, 1).unwrap();
    for now in [2, 10, 20, 2] {
        let expected = Value::Int(if now < 10 {1} else {0});
        for op in ["scalar", "scalarMax", "scalarSorted"] {
            let r = engine.query(op, Context::new("reader", Default::default()).at(now)).unwrap();
            assert!(r.complete);
            if op == "scalarSorted" { for field in ["lo", "hi"] { assert_eq!(r.data.field(field), Ok(&expected)); } }
            else { assert_eq!(r.data, expected); }
        }
    }
}

#[test]
fn astra_captured_rows_survive_skipped_resets_and_all_consumers() {
    for transfer in ["break", "continue"] {
        for kind in ["query", "mutation"] {
            for consumer in [
                "return max(chosen, chosen)",
                "(lo, hi) = sorted(chosen, chosen)\n  return hi.id",
                "return share(1, [chosen], chosen)",
                "return chosen = chosen",
                "if max(chosen, chosen).value > 0:\n    return chosen.id\n  return null",
            ] {
                let tail = format!("{kind} probe(stop: bool):\n  saved = null\n  for row in unread first 10:\n    saved = row\n    if stop:\n      {transfer}\n    saved = null\n  chosen = saved ! else NOT_FOUND\n  {consumer}\n");
                refuse(&tail, "recountPending");
            }
        }
    }
}

#[test]
fn reuse_is_scope_wide_even_before_the_row_assignment() {
    // Both uses are null at runtime, but the local carries a row in this scope.
    for tail in [
        "query probe():\n  for row in unread first 10:\n    saved = row\n    saved = null\n    return share(1, [saved], saved)\n  return null\n",
        "query probe():\n  saved = null\n  answer = share(1, [saved], saved)\n  for row in unread first 10:\n    saved = row\n  return answer\n",
    ] {
        let b = snapback4_lang::compile(&[("reuse.q".into(), base() + tail)]);
        assert!(b.diagnostics.iter().any(|d| d.code == "E_VIEW_KEY" && d.message.contains("recountPending")
            && d.rewrite.contains("use a separate variable for the row")), "{tail}\n{:?}", b.diagnostics);
    }
}

#[test]
fn helper_parameters_and_results_join_calls_across_operations() {
    for helper in ["fn identity(row: unread): row\n", "fn identity(row: unread):\n  return row\n",
        "fn identity(row: unread):\n  local = row\n  return local\n"] {
        for reversed in [false, true] {
            let mut calls = ["query scalar():\n  return min(identity('u'), identity('u'))\n",
                "query helperRows():\n  for row in unread first 10:\n    return identity(row)\n  return null\n"];
            if reversed { calls.reverse(); }
            refuse(&format!("{helper}{}{}", calls[0], calls[1]), "recountPending");
        }
    }
    refuse("fn captured(stop: bool):\n  saved = null\n  for row in unread first 10:\n    saved = row\n    if stop:\n      return saved\n    saved = null\n  return saved\nquery probe(stop: bool):\n  chosen = captured(stop) ! else NOT_FOUND\n  return max(chosen, chosen)\n", "recountPending");
}

#[test]
fn generated_control_flow_cannot_erase_maintenance_types() {
    let mut refusals = 0;
    let mut controls = 0;
    for seed in [7u64, 20261002, 0xdeadbeef, 0x5eed] {
        let mut random = seed;
        for _ in 0..12 {
            random ^= random << 13; random ^= random >> 7; random ^= random << 17;
            let row = match random % 3 {
                0 => "row",
                1 => "({nested: row}).nested",
                _ => "identity(first([row]) ! else NOT_FOUND)",
            };
            for transfer in ["break", "continue"] {
                let statements = if random & 1 == 0 {
                    format!("    if stop:\n      saved = {row}\n      {transfer}\n    saved = null\n")
                } else {
                    format!("    saved = {row}\n    if stop:\n      {transfer}\n    if not stop:\n      saved = null\n")
                };
                let head = format!("fn identity(row: unread): row\nquery probe(stop: bool):\n  saved = null\n  for row in unread first 10:\n{statements}  chosen = saved ! else NOT_FOUND\n");
                let consumer = match random % 4 {
                    0 => "  return max(chosen, chosen)\n",
                    1 => "  return share(1, [chosen], chosen)\n",
                    2 => "  (lo, hi) = sorted(chosen, chosen)\n  return hi\n",
                    _ => "  return chosen = chosen\n",
                };
                for kind in ["query", "mutation"] {
                    refuse(&(head.replace("query probe", &format!("{kind} probe")) + consumer), "recountPending");
                    refusals += 1;
                }
                let allowed = head + "  return chosen.value\n";
                let b = snapback4_lang::compile(&[("generated.q".into(), base() + &allowed)]);
                assert!(b.diagnostics.is_empty(), "{allowed}\n{:?}", b.diagnostics);
                controls += 1;
            }
        }
    }
    eprintln!("BG round8 generated control flow: 4 seeds, {refusals} refusals, {controls} ordinary-field controls");
}


#[test]
fn job_viewer_reads_keep_client_maintenance_field_restrictions() {
    for field in ["recountPending", "pending", "total"] {
        // The same non-output read refuses in a client query and an as block.
        refuse(&format!("query bad():\n  row = first(unread first 10) ! else MISSING\n  unused = row.{field}\n  return true\n"), field);
        refuse(&format!("job bad():\n  for member in members:\n    as 'reader':\n      row = first(unread first 10) ! else MISSING\n      unused = row.{field}\n"), field);
    }
    // A UI query's output permission does not become a job's computation
    // permission. This includes returned scalars and cursor-page projections.
    for (query, call) in [
        ("query badge():\n  return unread first 10 { state: .recountPending }\n", "unused = badge().data"),
        ("query badge():\n  for row in unread first 10:\n    return row.recountPending\n  return false\n", "unused = badge().data"),
        ("query badges(c: cursor ?):\n  return unread first 10 after c { state: .recountPending }\n", "for row in all(badges(null)):\n        unused = row.state"),
    ] {
        let b = snapback4_lang::compile(&[("schema.q".into(), base() + query)]);
        assert!(b.diagnostics.is_empty(), "{query}\n{:?}", b.diagnostics);
        refuse(&format!("{query}job bad():\n  for member in members:\n    as 'reader':\n      {call}\n"), "recountPending");
    }
    let source = base() + "effect push\nquery page(c: cursor ?):\n  return unread first 10 after c\njob good():\n  for member in members:\n    n = 0\n    as 'reader':\n      for row in all(page(null)):\n        n = n + row.value\n    emit push { n }\n";
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let rows = [("rooms", json!({"id":"r"})), ("members", json!({"id":"u","room":"r","until":null})),
        ("messages", json!({"id":"m","room":"r","until":10}))].into_iter().map(|(table, row)|
        (table.to_string(), wire::row_from_json(&engine.schema().tables[table], &row).unwrap())).collect::<Vec<_>>();
    engine.seed_at(rows, 1).unwrap();
    for now in [2, 10, 20, 2] {
        let client = engine.query("page", Context::new("reader", [("c".into(), Value::Null)].into()).at(now)).unwrap();
        assert!(client.complete && !client.unavailable);
        let expected = client.data.as_array().unwrap()[0].field("value").unwrap().clone();
        assert_eq!(expected, Value::Int(if now < 10 { 1 } else { 0 }));
        let run = engine.run_job("good", Default::default(), now).unwrap();
        assert_eq!(run.state, snapback4_core::engine::job::JobState::Done, "{run:?}");
        assert_eq!(engine.effects(None, 100).unwrap().first().unwrap().payload.field("n").unwrap(), &expected);
    }
}

#[test]
fn job_viewer_captured_rows_keep_scope_wide_types_after_resets() {
    let queries = "query one():\n  return first(unread first 10)\nquery page(c: cursor ?):\n  return unread first 10 after c\n";
    for read in [
        "carried = first(unread first 10)",
        "carried = one().data",
        "for row in all(page(null)):\n        carried = row",
    ] {
        for reset in ["", "    carried = null\n"] {
            for consumer in ["max(carried, carried)", "share(1, [carried], carried)", "carried = carried"] {
                if !reset.is_empty() && consumer.starts_with("max") { continue; }
                let tail = format!("{queries}job bad():\n  for member in members:\n    carried = null\n    as 'reader':\n      {read}\n{reset}    unused = {consumer}\n");
                refuse(&tail, "recountPending");
                let b = snapback4_lang::compile(&[("schema.q".into(), base() + &tail)]);
                if !reset.is_empty() { assert!(b.diagnostics.iter().any(|d| d.code == "E_VIEW_KEY" && format!("{} {}", d.message, d.rewrite).contains("use a separate variable for the row")), "{:?}", b.diagnostics); }
            }
        }
    }
}
