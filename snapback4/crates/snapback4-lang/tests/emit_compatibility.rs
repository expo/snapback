// @ref LLP 3000.000.000.000#3-generated-compatibility — baseline optionality follows inferred rows and projections.
use snapback4_lang::{compile, emit};

fn checked(source: &str) -> snapback4_lang::Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}
const OLD: &str = "table items:\n  body: text <=100\n  public 'test items'\n  insert <- allow\n  update <- allow\n  online only\nquery row(id: items):\n  return items[id]\nquery projected(id: items):\n  r = items[id]! else NOT_FOUND\n  return {body: r.body}\nmutation edit(id: items, body: text <=100):\n  return update items[id] {body: body}\n";
#[test]
fn opt_in_optional_fields_and_arguments_without_changing_default_requiredness() {
    let old = checked(OLD);
    let next = checked(&OLD.replace("  body: text <=100", "  body: text <=100\n  color: text <=20 default 'none'")
        .replace("body: r.body}", "body: r.body, color: r.color}")
        .replace("body: text <=100):", "body: text <=100, flag: bool ?):"));
    let ordinary = emit::typescript(&next);
    assert!(ordinary.contains("    color: string;"), "{ordinary}");
    let compatible = emit::typescript_spanning(&next, &old, 2);
    assert!(compatible.contains("/** Since release 2; optional: releases before 2 lack this column. */\n    color?: string;"), "{compatible}");
    assert!(compatible.contains("/** Since release 2; optional: releases before 2 lack this column. */ color?: string"), "{compatible}");
    assert!(compatible.contains("/** Since release 2. */ flag?: boolean | null"), "{compatible}");
    assert!(compatible.contains("available(release: ReleaseSnapshot): boolean"));
    assert!(compatible.contains("operationAvailable(release, \"edit\", \"mutation\""));
}
#[test]
fn baseline_retains_old_enum_domains_and_new_operation_required_arguments() {
    let old = checked("table states:\n  state: enum('old','common')\n  public 'state test'\n  online only\nquery state():\n  return 'old'\n");
    let new = checked("table states:\n  state: enum('new','common')\n  public 'state test'\n  online only\nquery state():\n  return 'new'\nquery newOnly(text: text <=20):\n  return text\n");
    let api = emit::typescript_spanning(&new, &old, 2);
    assert!(api.contains("newOnly: Query<{ text: string }, string>"), "{api}");
    assert!(!api.contains("text?:"));
    assert!(api.contains("\"new\" | \"common\" | \"old\""), "{api}");
}

#[test]
fn declared_optional_arguments_stay_optional_without_baseline_or_since_label() {
    let bound=checked("query greet(name: text <=20 ?):\n  return name\n");
    for api in [emit::typescript(&bound),emit::typescript_spanning(&bound,&bound,2)] {
        assert!(api.contains("greet: Query<{ name?: string | null }"),"{api}");
        assert!(!api.contains("Since release"));
    }
}
#[test]
fn baseline_nominal_results_survive_removed_tables_and_nested_return_shapes() {
    let old=checked("table oldRows:\n  n: int\n  public 'old test'\n  online only\nquery rows():\n  return oldRows[] first 10 by .id\nquery nested():\n  return {rows: oldRows[] first 10 by .id}\n");
    let new=checked("table newRows:\n  n: int\n  public 'new test'\n  online only\nquery rows():\n  return newRows[] first 10 by .id\nquery nested():\n  return {rows: newRows[] first 10 by .id}\n");
    let api=emit::typescript_spanning(&new,&old,2);
    assert!(api.contains("type BaselineRows = {\n  oldRows: {"),"{api}");
    assert!(api.contains("Rows[\"newRows\"][] | BaselineRows[\"oldRows\"][]"),"{api}");
    assert!(!api.contains("| Rows[\"oldRows\"]"));
    assert!(api.contains("  newRows: {\n    id: string;\n    n: number;"), "a row from an entirely new table still has its required fields: {api}");
}
#[test]
fn field_hidden_in_either_release_remains_optional_in_spanning_rows() {
    let private="table profiles:\n  owner: principal\n  secret: text <=20 default '' written by .owner\n  public 'profiles test'\n  online only\nquery rows():\n  return profiles[] first 10 by .id\n";
    let old=checked(private); let new=checked(&private.replace("written by .owner","written by .owner readable by audience"));
    assert!(emit::typescript(&new).contains("    secret: string;"));
    let api=emit::typescript_spanning(&new,&old,2);
    assert!(api.contains("    secret?: string;"),"{api}");
    assert!(emit::typescript_spanning(&old,&new,2).contains("    secret?: string;"));
}

#[test]
fn spanning_domains_deduplicate_enum_variants_and_equal_ts_values() {
    let source = "table notes:\n  status: enum('open', 'closed')\n  amount: int\n  public 'shared'\nquery list():\n  return notes first 20 by .id\n";
    let old = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    let new = snapback4_lang::compile(&[("schema.q".into(), source.replace("'open', 'closed'", "'open', 'closed', 'held'").replace("amount: int", "amount: int 0..100"))]);
    assert!(old.diagnostics.is_empty() && new.diagnostics.is_empty(), "{:?}", new.diagnostics);
    let api = snapback4_lang::emit::typescript_spanning(&new, &old, 2);
    assert!(api.contains("status: \"open\" | \"closed\" | \"held\";"), "{api}");
    assert!(!api.contains("number | number"), "{api}");
}


#[test]
fn conditional_enum_projections_keep_literal_and_nullable_domains() {
    let source = "table instruments:\n  mode: enum('standby', 'measure')\n  optionalMode: enum('standby', 'measure') ?\n  dynamic: text <=20\n  active: bool\n  public 'instrument modes'\n  online only\nquery modes():\n  return instruments first 50 by .id { mode: .mode if .active else 'standby', mixed: 'other' if .active else .mode, nullable: .optionalMode if .active else 'standby', dynamic: .mode if .active else .dynamic }\n";
    let bound = checked(source);
    let api = emit::typescript(&bound);
    assert!(api.contains("mode: \"standby\" | \"measure\""), "{api}");
    assert!(api.contains("mixed: \"other\" | \"standby\" | \"measure\""), "{api}");
    assert!(api.contains("nullable: \"standby\" | \"measure\" | null"), "{api}");
    assert!(api.contains("dynamic: string"), "{api}");
    let baseline = checked(&source.replace("'standby', 'measure'", "'standby', 'old'"));
    let spanning = emit::typescript_spanning(&bound, &baseline, 2);
    assert!(spanning.contains("mode: \"standby\" | \"measure\" | \"old\""), "{spanning}");
}


#[test]
fn plain_text_conditional_retains_concatenation() {
    let bound = checked("query label(active: bool):\n  return ('a' if active else 'b') + 'c'\n");
    assert!(emit::typescript(&bound).contains("label: Query<{ active: boolean }, string>"));
}


#[test]
fn finite_conditional_domains_keep_all_present_text_operations() {
    let source = "query label(mode: enum('standby', 'measure'), active: bool):\n  v = mode if active else 'standby'\n  return {domain: v, suffix: v + 'c', prefix: 'c' + v, paired: v + mode, lower: lower(v), trim: trim(v), size: count(v), hash: sha256(v), tokens: tokens(v), slice: slice(v, 0, 3), joined: join([v], ',')}\nquery reversed(mode: enum('standby','measure'), active: bool):\n  return ('standby' if active else mode) + 'c'\n";
    let bound = checked(source);
    let api = emit::typescript(&bound);
    assert!(api.contains("domain: \"standby\" | \"measure\"") && api.contains("suffix: string") && api.contains("size: number"), "{api}");
    let mut engine = snapback4_core::Engine::memory(bound.schema, bound.programs.into_iter().map(|p|p.program)).unwrap();
    let args = std::collections::BTreeMap::from([("mode".into(), snapback4_core::Value::String("measure".into())), ("active".into(), snapback4_core::Value::Bool(true))]);
    let reply = engine.query("label", snapback4_core::Context::new("user:test", args)).unwrap();
    let debug = format!("{reply:?}");
    assert!(debug.contains("measurec") && debug.contains("cmeasure") && debug.contains("mea"), "{debug}");
    let nullable = compile(&[("schema.q".into(), "query bad(mode: enum('standby','measure') ?, active: bool):\n  return lower(mode if active else 'standby')\n".into())]);
    assert!(!nullable.diagnostics.is_empty(), "optional strings still need narrowing");
}


#[test]
fn precise_conditional_domains_keep_string_comparisons() {
    let bound = checked("query compare(mode: enum('standby','measure'), other: enum('standby','sleep'), active: bool):\n  v = mode if active else 'standby'\n  return {equal: v = other, unequal: v != other, before: v < other, through: v <= other, after: v > other, from: v >= other, lowest: min(v, other), highest: max(v, other)}\n");
    let mut engine = snapback4_core::Engine::memory(bound.schema, bound.programs.into_iter().map(|p|p.program)).unwrap();
    let args = std::collections::BTreeMap::from([("mode".into(), snapback4_core::Value::String("standby".into())), ("other".into(), snapback4_core::Value::String("standby".into())), ("active".into(), snapback4_core::Value::Bool(true))]);
    let reply = engine.query("compare", snapback4_core::Context::new("user:test", args)).unwrap();
    let debug = format!("{reply:?}");
    assert!(debug.contains("equal") && debug.contains("Bool(true)"), "{debug}");
    let nullable = compile(&[("schema.q".into(), "query bad(mode: enum('standby','measure') ?, other: enum('standby','sleep'), active: bool):\n  return (mode if active else 'standby') < other\n".into())]);
    assert!(!nullable.diagnostics.is_empty(), "ordering still requires non-null proof");
}


#[test]
fn inferred_locals_join_enum_domains_without_weakening_declared_arguments() {
    let source = "query direct(mode: enum('standby','measure'), other: enum('standby','sleep'), active: bool):\n  v = mode if active else 'standby'\n  v = other\n  return v\nquery branched(mode: enum('standby','measure'), other: enum('standby','sleep'), active: bool):\n  v = mode if active else 'standby'\n  if active:\n    v = other\n  return {mode: v}\nquery nested(mode: enum('standby','measure'), other: enum('standby','sleep'), active: bool):\n  v = {mode: mode if active else 'standby'}\n  if active:\n    v = {mode: other}\n  return v\nquery looped(mode: enum('standby','measure'), other: enum('standby','sleep'), active: bool):\n  v = mode if active else 'standby'\n  for i in range(0, 2):\n    v = other\n  return {mode: v}\n";
    let bound = checked(source);
    let api = emit::typescript(&bound);
    assert!(api.contains("direct: Query<{ mode: \"standby\" | \"measure\"; other: \"standby\" | \"sleep\"; active: boolean }, \"standby\" | \"sleep\">"), "{api}");
    for name in ["branched", "nested", "looped"] {
        let result = &bound.programs.iter().find(|p|p.program.name == name).unwrap().result;
        let snapback4_lang::types::Ty::Object(fields) = result else { panic!("{result:?}") };
        let snapback4_lang::types::Ty::Enum(variants) = &fields["mode"] else { panic!("{result:?}") };
        assert_eq!(variants.iter().map(String::as_str).collect::<std::collections::BTreeSet<_>>(), ["standby", "measure", "sleep"].into_iter().collect());
    }
    let invalid = compile(&[("schema.q".into(), "fn only(value: enum('standby')):\n  return value\nquery bad(mode: enum('standby','measure'), active: bool):\n  return only(mode if active else 'standby')\n".into())]);
    assert!(!invalid.diagnostics.is_empty(), "explicit enum parameter domains remain enforced");
}


#[test]
fn precise_enum_domains_keep_nested_value_comparisons() {
    let bound=checked("query compare(mode: enum('standby','measure'), other: enum('standby','sleep'), active: bool):\n  v = mode if active else 'standby'\n  return {lists: [v] = [other], objects: {mode: v} = {mode: other}, nested: {modes: [v]} = {modes: [other]}}\n");
    let mut engine=snapback4_core::Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    let args=std::collections::BTreeMap::from([("mode".into(),snapback4_core::Value::String("standby".into())),("other".into(),snapback4_core::Value::String("standby".into())),("active".into(),snapback4_core::Value::Bool(true))]);
    let reply=engine.query("compare",snapback4_core::Context::new("user:test",args)).unwrap();
    assert_eq!(reply.data,snapback4_core::value::object([("lists",snapback4_core::Value::Bool(true)),("objects",snapback4_core::Value::Bool(true)),("nested",snapback4_core::Value::Bool(true))]));
}


#[test]
fn nested_nullable_enum_ordering_keeps_existing_total_order() {
    let bound=checked("query compare(mode: enum('standby','measure') ?, active: bool):\n  v = mode if active else 'standby'\n  return {ordered: [{mode: v}] < [{mode: 'x'}], lowest: min([{mode: v}], [{mode: 'x'}])}\n");
    let mut engine=snapback4_core::Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    let args=std::collections::BTreeMap::from([("mode".into(),snapback4_core::Value::Null),("active".into(),snapback4_core::Value::Bool(true))]);
    let reply=engine.query("compare",snapback4_core::Context::new("user:test",args)).unwrap();
    assert_eq!(reply.data.field("ordered").unwrap(), &snapback4_core::Value::Bool(true));
    assert_eq!(reply.data.field("lowest").unwrap(), &snapback4_core::Value::Array(vec![snapback4_core::value::object([("mode",snapback4_core::Value::Null)])]));
}


#[test]
fn enum_precision_compares_and_rebinds_shapes_with_opposing_field_bounds() {
    let source = "query compare(mode: enum('a','long'), short: enum('a'), small: enum('x'), wide: enum('x','wide'), active: bool):\n  left = {mode: mode if active else 'a', tag: small}\n  right = {mode: short, tag: wide}\n  equal = left = right\n  left = right\n  return {equal, left}\n";
    let bound=checked(source);
    let mut engine=snapback4_core::Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program)).unwrap();
    let args=std::collections::BTreeMap::from([("mode".into(),snapback4_core::Value::String("a".into())),("short".into(),snapback4_core::Value::String("a".into())),("small".into(),snapback4_core::Value::String("x".into())),("wide".into(),snapback4_core::Value::String("x".into())),("active".into(),snapback4_core::Value::Bool(true))]);
    let reply=engine.query("compare",snapback4_core::Context::new("user:test",args)).unwrap();
    assert_eq!(reply.data.field("equal").unwrap(),&snapback4_core::Value::Bool(true));
}

#[test]
fn enum_text_builtins_do_not_launder_forbidden_control_characters() {
    let control="\u{1}";
    checked(&format!("query raw(value: enum('{control}')):\n  return value\n"));
    for expr in ["lower(value)", "trim(value)", "value + 'x'", "'x' + value", "slice(value, 0, 1)", "join([value], ',')"] {
        let bound=compile(&[("schema.q".into(),format!("query bad(value: enum('{control}')):\n  return {expr}\n"))]);
        assert!(bound.diagnostics.iter().any(|d|d.code=="E_QUARRY_TYPE"), "{expr}: {:?}",bound.diagnostics);
    }
}


#[test]
fn unrepresentable_enum_text_selections_never_gain_unknown_assignment_authority() {
    let control="\u{1}";
    for helper in ["fn take(value: enum('safe')):\n  return value\n", "fn take(value: text <=20):\n  return value\n"] {
        for expression in ["min(bad, text)", "max(bad, text)", "bad if active else text"] {
            let source=format!("{helper}query example(bad: enum('{control}'), text: text <=10, active: bool):\n  return take({expression})\n");
            assert!(!compile(&[("schema.q".into(),source)]).diagnostics.is_empty(),"{expression}");
        }
        let source=format!("{helper}query example(bad: enum('{control}'), text: text <=10, active: bool):\n  value = bad\n  if active:\n    value = text\n  return take(value)\n");
        assert!(!compile(&[("schema.q".into(),source)]).diagnostics.is_empty(),"unsafe local flow cannot acquire Unknown authority");
    }
}
