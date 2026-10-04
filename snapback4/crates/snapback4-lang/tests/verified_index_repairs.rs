//! Every index diagnostic's source edit is pasted verbatim into its caller.
use snapback4_lang::{compile, Diagnostic};

fn repair(source: &str, read: &str, code: &str, offered: bool) -> Diagnostic {
    let bound = compile(&[("schema.q".into(), source.into())]);
    let diagnostic = bound.diagnostics.iter().find(|d| d.code == code)
        .unwrap_or_else(|| panic!("{source}\n{:?}", bound.diagnostics)).clone();
    assert_eq!(!diagnostic.rewrite.is_empty(), offered, "{source}\n{diagnostic:?}");
    if offered {
        assert_eq!(source.matches(read).count(), 1);
        let pasted = source.replace(read, &diagnostic.rewrite);
        let bound = compile(&[("schema.q".into(), pasted.clone())]);
        assert!(bound.diagnostics.is_empty(), "{pasted}\n{:?}", bound.diagnostics);
    } else { assert!(!diagnostic.mechanical); }
    diagnostic
}

const PAIR: &str = "table t:\n  low: principal ?\n  high: principal ?\n  unique pair: low, high\n  unique inverse: high, low\n  public\n";

#[test]
fn program_ambiguity_keeps_required_and_guarded_repairs_only() {
    for (optional, guarded) in [(false, false), (true, false), (true, true)] {
        let opt = if optional { " ?" } else { "" };
        let guard = if guarded { "  require x != null and y != null else MISSING\n" } else { "" };
        for keys in ["low = x, high = y", "high = y, low = x"] {
            for prefix in ["", "exists "] {
                let read = format!("t[{keys}]");
                let source = format!("{PAIR}query q(x: principal{opt}, y: principal{opt}):\n{guard}  return {prefix}{read}\n");
                repair(&source, &read, "E_QUARRY_AMBIGUOUS", !optional || guarded);
            }
        }
    }
    let read = "t[low = null, high = null]";
    repair(&format!("{PAIR}query q():\n  return exists {read}\n"), read, "E_QUARRY_AMBIGUOUS", false);
}

#[test]
fn rule_ambiguity_uses_its_own_row_and_presence_guards() {
    for (optional, guarded) in [(false, false), (true, false), (true, true)] {
        let opt = if optional { " ?" } else { "" };
        let guard = if guarded { ".low != null and .high != null and " } else { "" };
        for keys in ["low = .low, high = .high", "high = .high, low = .low"] {
            for (effect, probe) in [("read", "exists"), ("insert", "created")] {
                let read = format!("t[{keys}]");
                let source = format!("{PAIR}table m:\n  low: principal{opt}\n  high: principal{opt}\n  {effect} <- {guard}{probe} {read}\n");
                repair(&source, &read, "E_QUARRY_AMBIGUOUS", !optional || guarded);
            }
        }
    }
}

#[test]
fn positional_program_ambiguity_offers_only_verified_explicit_indexes() {
    for (optional, guarded) in [(false, false), (true, false), (true, true)] {
        let opt = if optional { " ?" } else { "" };
        let guard = if guarded { "  require x != null and y != null else MISSING\n" } else { "" };
        for read in ["t[x, y]", "t[y, x]"] {
            for probe in ["", "exists "] {
                let source = format!("{PAIR}query q(x: principal{opt}, y: principal{opt}):\n{guard}  return {probe}{read}\n");
                let d = repair(&source, read, "E_QUARRY_POSITIONAL_SCAN", !optional || guarded);
                assert!(!d.mechanical);
                if !d.rewrite.is_empty() { assert_eq!(d.rewrite, format!("{read} by pair")); }
            }
        }
    }
    let read = "t[null, null]";
    repair(&format!("{PAIR}query q():\n  return exists {read}\n"), read, "E_QUARRY_POSITIONAL_SCAN", false);
}

#[test]
fn positional_rule_ambiguity_offers_only_verified_explicit_indexes() {
    for (optional, guarded) in [(false, false), (true, false), (true, true)] {
        let opt = if optional { " ?" } else { "" };
        let guard = if guarded { ".low != null and .high != null and " } else { "" };
        for read in ["t[.low, .high]", "t[.high, .low]"] {
            for (effect, probe) in [("read", "exists"), ("insert", "created")] {
                let source = format!("{PAIR}table m:\n  low: principal{opt}\n  high: principal{opt}\n  {effect} <- {guard}{probe} {read}\n");
                let d = repair(&source, read, "E_QUARRY_POSITIONAL_SCAN", !optional || guarded);
                assert!(!d.mechanical);
                if !d.rewrite.is_empty() { assert_eq!(d.rewrite, format!("{read} by pair")); }
            }
        }
    }
}

#[test]
fn positional_ambiguity_tries_the_next_index_and_preserves_operands() {
    let model = PAIR.replace("low: principal ?", "low: principal").replace("high: principal ?", "high: int");
    let read = "t[(x -- keep this operand\n  ), y]";
    let source = format!("{model}query q(x: int, y: principal):\n  return exists {read}\n");
    let d = repair(&source, read, "E_QUARRY_POSITIONAL_SCAN", true);
    assert_eq!(d.rewrite, format!("{read} by inverse"));
    let read = "t[.high, .low]";
    let source = format!("{model}table m:\n  low: principal\n  high: int\n  read <- exists {read}\n");
    let d = repair(&source, read, "E_QUARRY_POSITIONAL_SCAN", true);
    assert_eq!(d.rewrite, format!("{read} by inverse"));
    for read in ["t[true, false]", "t[true, false, true]"] {
        repair(&format!("{model}query q():\n  return exists {read}\n"), read, "E_QUARRY_POSITIONAL_SCAN", false);
        repair(&format!("{model}table m:\n  read <- exists {read}\n"), read, "E_QUARRY_POSITIONAL_SCAN", false);
    }
}

#[test]
fn unknown_positional_index_repairs_program_reads_and_exists() {
    let required = PAIR.replace(" ?", "").replace("  unique inverse: high, low\n", "");
    for (model, args, guard, offered) in [
        (required.as_str(), "principal", "", true),
        (PAIR, "principal", "", true),
        (PAIR, "principal ?", "", false),
        (PAIR, "principal ?", "  require x != null and y != null else MISSING\n", true),
        (required.as_str(), "bool", "", false),
    ] {
        for index in ["typo", "missingPair"] {
            for probe in ["", "exists "] {
                let read = format!("t[x, y] by {index}");
                let source = format!("{model}query q(x: {args}, y: {args}):\n{guard}  return {probe}{read}\n");
                let d = repair(&source, &read, "E_QUARRY_POSITIONAL_SCAN", offered);
                assert!(!d.mechanical);
                if offered { assert_eq!(d.rewrite, "t[x, y] by pair"); }
            }
        }
    }
}

#[test]
fn unknown_positional_index_repairs_rule_probes_in_context() {
    let required = PAIR.replace(" ?", "").replace("  unique inverse: high, low\n", "");
    for (model, args, guard, offered) in [
        (required.as_str(), "principal", "", true),
        (PAIR, "principal ?", "", false),
        (PAIR, "principal ?", ".low != null and .high != null and ", true),
        (required.as_str(), "bool", "", false),
    ] {
        for (effect, probe) in [("read", "exists"), ("insert", "created")] {
            let read = "t[.low, .high] by typo";
            let source = format!("{model}table m:\n  low: {args}\n  high: {args}\n  {effect} <- {guard}{probe} {read}\n");
            let d = repair(&source, read, "E_QUARRY_POSITIONAL_SCAN", offered);
            assert!(!d.mechanical);
            if offered { assert_eq!(d.rewrite, "t[.low, .high] by pair"); }
        }
    }
}

#[test]
fn unknown_positional_index_tries_compatible_alternatives_with_original_operands() {
    let model = PAIR.replace("low: principal ?", "low: principal").replace("high: principal ?", "high: int");
    let read = "t[(x -- preserve operand\n  ), y] by typo";
    let source = format!("{model}query q(x: int, y: principal):\n  return exists {read}\n");
    let d = repair(&source, read, "E_QUARRY_POSITIONAL_SCAN", true);
    assert_eq!(d.rewrite, read.replace("by typo", "by inverse"));
    let read = "t[.high, .low] by typo";
    let source = format!("{model}table m:\n  low: principal\n  high: int\n  read <- exists {read}\n");
    let d = repair(&source, read, "E_QUARRY_POSITIONAL_SCAN", true);
    assert_eq!(d.rewrite, "t[.high, .low] by inverse");
    let model = model.replace("unique", "by");
    let read = "t[x, y] by typo";
    repair(&format!("{model}query q(x: principal, y: int):\n  return exists {read}\n"), read, "E_QUARRY_POSITIONAL_SCAN", false);
    let read = "t[.low, .high] by typo";
    repair(&format!("{model}table m:\n  low: principal\n  high: int\n  read <- exists {read}\n"), read, "E_QUARRY_POSITIONAL_SCAN", false);
}

#[test]
fn range_mismatch_never_turns_column_names_into_expressions() {
    let model = "table t:\n  low: principal\n  high: principal\n  by inverse: high, low\n  public\n";
    for keys in ["123", "123, 456", "low = x, high = 123"] {
        let read = format!("t[{keys}] first 50 by inverse");
        repair(&format!("{model}query q(x: principal):\n  return {read}\n"), &read, "E_QUARRY_TYPE", false);
    }
}

const PAGES: &str = "table t:\n  low: principal\n  high: principal\n  by lowRows: low, id\n  by highRows: high, id\n  immutable low, high\n  public\n";

#[test]
fn range_alternative_keeps_actual_arguments_cursor_direction_and_filter() {
    for read in ["t[low = x] after c last 7 by highRows", "t[low = x] after c first 7 by highRows where .high != x"] {
        let source = format!("{PAGES}query q(x: principal, c: cursor ?):\n  return {read}\n");
        let d = repair(&source, read, "E_QUARRY_TYPE", true);
        assert!(d.rewrite.contains("low = x") && d.rewrite.contains("after c") && d.rewrite.contains("by lowRows"));
    }
}

#[test]
fn job_ambiguity_offers_only_context_checked_indexes() {
    for (optional, guarded) in [(false, false), (true, false), (true, true)] {
        let opt = if optional { " ?" } else { "" };
        let guard = if guarded { "x != null and y != null and " } else { "" };
        let read = "t[low = x, high = y]";
        let source = format!("{PAIR}job q(x: principal{opt}, y: principal{opt}):\n  chunk row in t first 2 by byId:\n    if {guard}exists {read}:\n      return\n");
        repair(&source, read, "E_QUARRY_AMBIGUOUS", !optional || guarded);
    }
}

#[test]
fn job_repairs_compile_in_the_chunk_context() {
    let read = "t[low = x] first 7 by highRows";
    repair(&format!("{PAGES}job q(x: principal):\n  chunk row in {read}:\n    return\n"), read, "E_QUARRY_TYPE", true);
    let model = PAIR.replace(" ?", "").replace("  unique inverse: high, low\n", "");
    let read = "t[x, y] by byId";
    repair(&format!("{model}job q(x: principal, y: principal):\n  chunk row in t first 2 by byId:\n    if exists {read}:\n      return\n"), read, "E_QUARRY_TYPE", true);
    for (optional, unique) in [(false, true), (true, true), (false, false)] {
        let opt = if optional { " ?" } else { "" };
        let kind = if unique { "unique" } else { "by" };
        let read = "profiles[author] first 1 by byPrincipal";
        let source = format!("table profiles:\n  principal: principal{opt}\n  {kind} byPrincipal: principal\n  immutable principal\n  public\njob q(author: principal{opt}):\n  chunk row in {read}:\n    return\n");
        let d = repair(&source, read, "E_QUARRY_TYPE", false);
        assert!(d.message.contains("filter inside the chunk body"));
        assert!(!d.message.contains("`chunk") && !d.message.contains("`if"));
    }
}

#[test]
fn range_to_point_checks_result_consumers_and_helper_callers() {
    let model = PAIR.replace(" ?", "").replace("  unique inverse: high, low\n", "");
    let read = "t[x, y] first 2 by pair";
    repair(&format!("{model}query q(x: principal, y: principal):\n  return count({read})\n"), read, "E_QUARRY_TYPE", false);
    let helper = format!("{model}fn rows(x: principal, y: principal): {read}\n");
    repair(&format!("{helper}query q(x: principal, y: principal):\n  return count(rows(x, y))\n"), read, "E_QUARRY_TYPE", false);
    repair(&format!("{helper}query q(x: principal, y: principal):\n  return rows(x, y)\n"), read, "E_QUARRY_TYPE", true);
}

#[test]
fn repairs_recheck_callers_in_other_files() {
    let model = PAIR.replace(" ?", "").replace("  unique inverse: high, low\n", "");
    let read = "t[x, y] first 2 by pair";
    let helper = format!("fn rows(x: principal, y: principal): {read}\n");
    for (value, offered) in [("helpers.rows(x, y)", true), ("count(helpers.rows(x, y))", false)] {
        let mut sources = vec![("schema.q".into(), model.clone()), ("helpers.q".into(), helper.clone()),
            ("queries.q".into(), format!("query q(x: principal, y: principal):\n  return {value}\n"))];
        let bound = compile(&sources);
        let d = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_TYPE").unwrap();
        assert_eq!(!d.rewrite.is_empty(), offered, "{value}: {:?}", bound.diagnostics);
        if offered {
            sources[1].1 = helper.replace(read, &d.rewrite);
            let bound = compile(&sources);
            assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        }
    }
}

#[test]
fn candidates_preserve_authored_operands_and_unicode_offsets() {
    let model = "table t:\n  low: text <=100\n  high: text <=100\n  unique pair: low, high\n  public\n";
    for read in ["t[low = (x if choose else 'héllo -- by'), high = (y)] by byId",
        "t[low = (x -- keep this comment\n  ), high = (y),] by byId"] {
        let source = format!("{model}query q(x: text <=40, y: text <=40, choose: bool):\n  return {{ label: 'é', row: {read} }}\n");
        let d = repair(&source, read, "E_QUARRY_TYPE", true);
        if read.contains("-- keep") { assert!(d.rewrite.contains("-- keep this comment")); }
        else { assert!(d.rewrite.contains("(x if choose else 'héllo -- by')")); }
    }
}

#[test]
fn parenthesized_read_spans_are_replaced_in_their_actual_scope() {
    let model = PAIR.replace(" ?", "").replace("  unique inverse: high, low\n", "");
    for read in ["(t[x, y] by byId)", "((t[x, y]) by byId)"] {
        repair(&format!("{model}query q(x: principal, y: principal):\n  return {read}\n"), read, "E_QUARRY_TYPE", true);
    }
}

#[test]
fn other_context_errors_withhold_unproved_index_edits_without_recursion() {
    let model = PAIR.replace(" ?", "").replace("  unique inverse: high, low\n", "");
    let read = "t[x, y] by byId";
    for tail in ["  return missing\n", "  return other\n"] {
        let source = format!("{model}query q(x: principal, y: principal):\n  other = {read}\n{tail}");
        repair(&source, read, "E_QUARRY_TYPE", !tail.contains("missing"));
    }
    let source = format!("{PAIR}query q(x: principal, y: principal):\n  a = t[low = x, high = y]\n  return exists t[high = y, low = x]\n");
    let bound = compile(&[("schema.q".into(), source)]);
    assert_eq!(bound.diagnostics.len(), 2, "{:?}", bound.diagnostics);
    assert!(bound.diagnostics.iter().all(|d| d.rewrite.is_empty()));
}

#[test]
fn named_shape_repairs_use_every_retained_focal_context() {
    for optional in [false, true] {
        let model = if optional { PAIR.into() } else { PAIR.replace(" ?", "") };
        for read in ["t[low = .low, high = .high]", "t[high = .high, low = .low]"] {
            for probe in ["", "exists "] {
                for caller in ["card", "{ ...card }", "wrapper"] {
                    let source = format!("{model}shape card = {{ found: {probe}{read} }}\nshape wrapper = {{ ...card }}\nquery q():\n  return t first 5 {caller}\n");
                    repair(&source, read, "E_QUARRY_AMBIGUOUS", !optional);
                }
            }
        }
    }
    // One valid instantiation cannot hide another whose nullable focal fields
    // would make the suggested point inadmissible.
    let read = "t[low = .low, high = .high]";
    let source = format!("{PAIR}table required:\n  low: principal\n  high: principal\n  public\nshape card = {{ found: exists {read} }}\nquery good():\n  return required first 5 card\nquery bad():\n  return t first 5 card\n");
    repair(&source, read, "E_QUARRY_AMBIGUOUS", false);
}

#[test]
fn writing_helper_repairs_use_the_mutation_caller() {
    let model = PAIR.replace(" ?", "");
    let read = "t[low = x, high = y]";
    let helper = format!("{model}fn f(x: principal, y: principal):\n  insert t {{low: x, high: y}}\n  return exists {read}\n");
    for call in ["f(x, y)", "outer(x, y)"] {
        let source = format!("{helper}fn outer(x: principal, y: principal): f(x, y)\nmutation q(x: principal, y: principal):\n  return {call}\n");
        repair(&source, read, "E_QUARRY_AMBIGUOUS", true);
    }
    let source = format!("{helper}mutation good(x: principal, y: principal):\n  return f(x, y)\nquery bad(x: principal, y: principal):\n  return f(x, y)\n");
    repair(&source, read, "E_QUARRY_AMBIGUOUS", false);
}

#[test]
fn user_repair_probe_operation_does_not_suppress_helper_repairs() {
    let model = PAIR.replace(" ?", "");
    let read = "t[low = x, high = y]";
    let source = format!("{model}fn f(x: principal, y: principal): exists {read}\nquery repairProbe():\n  return 1\nquery q(x: principal, y: principal):\n  return f(x, y)\n");
    repair(&source, read, "E_QUARRY_AMBIGUOUS", true);
}

#[test]
fn shape_and_writing_helper_repairs_retain_cross_file_callers() {
    let model = PAIR.replace(" ?", "");
    for (read, declaration, caller) in [
        ("t[low = .low, high = .high]", "shape card = { found: exists t[low = .low, high = .high] }\n", "query q():\n  return t first 5 card\n"),
        ("t[low = x, high = y]", "fn f(x: principal, y: principal):\n  insert t {low: x, high: y}\n  return exists t[low = x, high = y]\n", "mutation q(x: principal, y: principal):\n  return helpers.f(x, y)\n"),
    ] {
        let mut sources = vec![("schema.q".into(), model.clone()), ("helpers.q".into(), declaration.into()), ("callers.q".into(), caller.into())];
        let bound = compile(&sources);
        let d = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_AMBIGUOUS").unwrap();
        assert!(!d.rewrite.is_empty(), "{:?}", bound.diagnostics);
        sources[1].1 = declaration.replace(read, &d.rewrite);
        let pasted = compile(&sources);
        assert!(pasted.diagnostics.is_empty(), "{:?}", pasted.diagnostics);
    }
}
