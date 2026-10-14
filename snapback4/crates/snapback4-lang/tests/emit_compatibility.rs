// @ref LLP 3000.000.000.000#3-generated-compatibility — baseline optionality follows inferred rows and projections.
use snapback4_lang::{compile, emit};

fn checked(source: &str) -> snapback4_lang::Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}
const OLD: &str = "table items:\n  body: text <=100\n  public 'test items'\n  insert <- allow\n  update <- allow\n  online only\nquery row(id: items):\n  return items[id]\nquery projected(id: items):\n  r = items[id]! else NOT_FOUND\n  return shape r {body: r.body}\nmutation edit(id: items, body: text <=100):\n  return update items[id] {body: body}\n";
#[test]
fn opt_in_optional_fields_and_arguments_without_changing_default_requiredness() {
    let old = checked(OLD);
    let next = checked(&OLD.replace("  body: text <=100", "  body: text <=100\n  color: text <=20 default 'none'")
        .replace("body: r.body}", "body: r.body, color: r.color}")
        .replace("body: text <=100):", "body: text <=100, flag: bool ?):"));
    let ordinary = emit::typescript(&next);
    assert!(ordinary.contains("    color: string;"), "{ordinary}");
    let compatible = emit::typescript_spanning(&next, &old, 2);
    assert!(compatible.contains("/** Since release 2. */\n    color?: string;"), "{compatible}");
    assert!(compatible.contains("/** Since release 2. */ color?: string"), "{compatible}");
    assert!(compatible.contains("/** Since release 2. */ flag?: boolean | null"), "{compatible}");
    assert!(compatible.contains("available(release: ReleaseSnapshot): boolean"));
    assert!(compatible.contains("operationAvailable(release, \"edit\", \"mutation\""));
}
#[test]
fn baseline_retains_old_enum_domains_and_new_operation_required_arguments() {
    let old = checked("query state():\n  return 'old'\n");
    let new = checked("query state():\n  return 'new'\nquery newOnly(text: text <=20):\n  return text\n");
    let api = emit::typescript_spanning(&new, &old, 2);
    assert!(api.contains("newOnly: Query<{ text: string }, string>"), "{api}");
    assert!(!api.contains("text?:"));
}
