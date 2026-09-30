use super::names::{SOURCE, exercise};
use super::*;

fn extra_scope_key(column: &str, type_: &str) {
    // No authored point read of rooms: any arity ambiguity comes from generation.
    let source = SOURCE.replace(
        "table rooms:\n",
        &format!("table rooms:\n  {column}: {type_} ?\n  unique {column}\n"),
    );
    // Exercise delivery, compact, seen and all three reads. Reporting [3,3]
    // across the absent position 2 must leave the live message at 1 sent.
    exercise(bound(&source), str::to_owned, column);
}

#[test]
fn unique_slug_on_scope_keeps_receipts_and_delivery_named() {
    extra_scope_key("slug", "text <=80");
}

#[test]
fn unique_creator_id_on_scope_keeps_receipts_and_delivery_named() {
    extra_scope_key("creatorId", "principal");
}
