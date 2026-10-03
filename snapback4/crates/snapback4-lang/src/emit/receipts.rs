use super::{property, string_literal};
use crate::bind::Bound;

// @ref LLP 3000.032#4.3 — compiler-only bindings preserve the existing receipt protocol.
pub(super) fn emit(bound: &Bound, out: &mut String) {
    if bound.schema.receipts.is_empty() { return; }
    out.push_str("\n/** Receipt families: scope counter, joining floor, recipient count, delivered/seen progress.\n * Keep ordinary history and live decorations in independent reads. */\nexport const api = { ...operations, receiptFamilies: {\n");
    for family in &bound.schema.receipts {
        let member = &bound.receipt_members[&family.name];
        let seen = bound.programs.iter().find(|p| p.program.name == family.seen).unwrap();
        let group = &seen.args[0].0;
        let through = &seen.args[1].0;
        let binding = bound.schema.delivery.iter().find(|b| b.mutation == family.delivered).unwrap();
        let op = |name: &str| name.split('.').fold("operations".to_string(), |s, part| format!("{s}[{}]", string_literal(part)));
        out.push_str(&format!("  /** {}: only visible confirmed positions may be seen. Membership/join floors remain server-authoritative. */\n  {}: {{\n    name: {}, fingerprint: {},\n    member: {}, seen: {},\n    scopeArgument: {}, throughArgument: {},\n    mapping: {{\n", family.name.replace("*/", "* /"), property(&family.name), string_literal(&family.name), string_literal(&binding.fingerprint), op(member), op(&family.seen), string_literal(group), string_literal(through)));
        for (key, value) in [
            ("scope", &family.scope), ("counter", &family.counter), ("messages", &family.messages),
            ("messageGroup", &family.message_group), ("position", &family.position), ("sender", &family.sender),
            ("count", &family.count), ("members", &family.members), ("memberGroup", &family.group),
            ("principal", &family.principal), ("floor", &family.floor), ("delivered", &family.delivered_field),
            ("seen", &family.seen_field), ("runs", &family.runs),
        ] { out.push_str(&format!("      {key}: {},\n", string_literal(value))); }
        out.push_str(&format!("    }},\n  }} satisfies ReceiptFamily<Rows[{}], {}, {}>,\n", string_literal(&family.members), string_literal(group), string_literal(through)));
    }
    out.push_str("} } as const;\n");
}
