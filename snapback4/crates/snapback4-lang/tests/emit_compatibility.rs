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
