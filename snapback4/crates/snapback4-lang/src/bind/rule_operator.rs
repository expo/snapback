//! E_QUARRY_RULE_OPERATOR: a table rule uses an expression rules do not
//! evaluate (an ordered comparison outside insert rules and named update
//! transitions, the clock, arithmetic or a helper call). The rewrite moves the
//! author's own comparison into the mutation as `require … else CODE`.

use crate::ast::Expr;
use crate::diag::{Diagnostic, Site};

/// What the rule language lacks for this term, if anything.
pub(super) fn unsupported_side(expr: &Expr) -> Option<&'static str> {
    match expr {
        Expr::Name { name, .. } if name == "now" => Some("the clock (`now`)"),
        Expr::Call { .. } => Some("a helper or function call"),
        Expr::Binary { op, .. } if matches!(op.as_str(), "+" | "-" | "*" | "/" | "%" | "??") => Some("arithmetic"),
        _ => None,
    }
}

/// The effect a rule judges, as the author spelled it.
pub(super) fn effect_word(insert: bool, update: bool, read: bool) -> &'static str {
    if insert { "insert" } else if update { "update" } else if read { "read" } else { "delete" }
}

/// The refusal for one comparison `cmp` in a `table`'s `effect` rule.
pub(super) fn diagnostic(site: &Site, table: &str, effect: &str, transition: bool, cmp: &Expr, what: &str) -> Diagnostic {
    let text = strip_parens(&crate::print::expression(cmp));
    let field = first_field(&text).unwrap_or_else(|| "value".to_owned());
    let code = format!("INVALID_{}", screaming(&field));
    let message = format!("`{text}` in the {effect} rule of {table} uses {what}, which table rules do not evaluate: rules compare columns, viewer and literals with = and !=, and order (<, <=, >, >=) only an insert row's own required int, time, decimal or money columns and integer literals (minor units beside decimal or money), or old/next in a named update (old, next) rule");
    // The mutation names the stored row `row` and supplies new values as arguments.
    let stored = |image: Option<&str>, name: &str| match image { Some("next") => name.to_owned(), _ => format!("row.{name}") };
    let inserted = |_: Option<&str>, name: &str| name.to_owned();
    let rewrite = match effect {
        "insert" => {
            let mutation = map_fields(&text, &inserted);
            if what == "an ordered comparison" {
                format!("compare this row's own required int or time columns or an integer literal in the insert rule, or check it in the mutation that inserts the row: `require {mutation} else {code}`")
            } else {
                format!("check it in the mutation that inserts the row, using the values it inserts: `require {mutation} else {code}`")
            }
        }
        "update" if !transition && what == "an ordered comparison" => {
            let next = map_fields(&text, &|_, name| format!("next.{name}"));
            format!("name both images and bound the new one: `update (old, next) <- {next}`; or check it in the mutation: `row = {table}[id] ! else NOT_FOUND` then `require {} else {code}`", map_fields(&text, &stored))
        }
        "read" if what.contains("now") => format!("a read rule is an audience, which cannot change with time: hide rows past a time column with `expire at .{field}`, or filter the query (`{table} where {} …`)", map_fields(&text, &|_, name| format!(".{name}"))),
        "read" => format!("a read rule is an audience, which cannot compare magnitudes: filter the query instead (`{table} where {} …`)", map_fields(&text, &|_, name| format!(".{name}"))),
        _ => format!("check it in the mutation before the write: `row = {table}[id] ! else NOT_FOUND` then `require {} else {code}`", map_fields(&text, &stored)),
    };
    Diagnostic::new(site, "E_QUARRY_RULE_OPERATOR", message, rewrite).guide("rules")
}

/// An unnamed `update <- R` holds for the row before and after the write, so
/// its named form is `update (old, next) <- R(old) and R(next)`: every clause
/// kept, the ordered one included (lane 062). The mutation form follows.
pub(crate) fn named_update(table: &str, rule: &Expr, comparison: &str) -> String {
    let text = strip_parens(&crate::print::expression(rule));
    let wrap = |s: String| if text.contains(" or ") { format!("({s})") } else { s };
    let old = wrap(map_fields(&text, &|_, name| format!("old.{name}")));
    let next = wrap(map_fields(&text, &|_, name| format!("next.{name}")));
    let field = first_field(comparison).unwrap_or_else(|| "value".to_owned());
    let _ = table;
    format!("name both images; an unnamed update rule holds before and after the write, so the named form keeps both: `update (old, next) <- {old} and {next}`; or drop `{comparison}` from the rule and check the new value in the mutation: `require {} else INVALID_{}`", map_fields(comparison, &|_, name| name.to_owned()), screaming(&field))
}

/// A named transition's comparison the rule language cannot type, as the
/// mutation check that states the same condition.
pub(crate) fn transition_require(table: &str, cmp: &Expr) -> String {
    let text = strip_parens(&crate::print::expression(cmp));
    let field = first_field(&text).unwrap_or_else(|| "value".to_owned());
    let stored = |image: Option<&str>, name: &str| match image { Some("next") => name.to_owned(), _ => format!("row.{name}") };
    format!("check it in the mutation that updates the row: `row = {table}[id] ! else NOT_FOUND` then `require {} else INVALID_{}` (the new values are the mutation's arguments)", map_fields(&text, &stored), screaming(&field))
}

/// A table rule's predicate as the check a mutation states before writing:
/// the row's fields become the values the mutation writes.
pub(crate) fn mutation_check(rule: &Expr) -> String {
    map_fields(&strip_parens(&crate::print::expression(rule)), &|_, name| name.to_owned())
}

/// `else CODE` after a table rule: the refusal of a rule is E_RULE.
pub(crate) fn rule_else(else_site: &Site, effect: &str, rule: &Expr, code: &str) -> Diagnostic {
    let text = strip_parens(&crate::print::expression(rule));
    let code = if code.chars().next().is_some_and(|c| c.is_ascii_uppercase()) { code } else { "NOT_ALLOWED" };
    Diagnostic::new(else_site, "E_QUARRY_SYNTAX",
        format!("a table rule takes no `else`: a write its {effect} rule refuses is E_RULE; only `require … else CODE` and `unique … else CODE` name a refusal"),
        format!("keep `{effect} <- {text}`, and name the refusal in the mutation before the write: `require {} else {code}`", mutation_check(rule))).guide("rules")
}

fn strip_parens(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.starts_with('(') && trimmed.ends_with(')') {
        // Only strip a pair that encloses the whole text.
        let mut depth = 0i32;
        for (i, c) in trimmed.char_indices() {
            match c { '(' => depth += 1, ')' => depth -= 1, _ => {} }
            if depth == 0 && i + 1 < trimmed.len() { return trimmed.to_owned(); }
        }
        return trimmed[1..trimmed.len() - 1].to_owned();
    }
    trimmed.to_owned()
}

fn ident(c: char) -> bool { c.is_ascii_alphanumeric() || c == '_' }

/// The first column the comparison names: `.stars`, `old.highBid` or `next.at`.
fn first_field(text: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if *c == '.' && chars.get(i + 1).is_some_and(|c| c.is_ascii_alphabetic()) {
            return Some(chars[i + 1..].iter().take_while(|c| ident(**c)).collect());
        }
    }
    None
}

/// Rewrite each focal field `.f`, `old.f` and `next.f` through `map(image, f)`,
/// leaving other member accesses alone.
fn map_fields(text: &str, map: &dyn Fn(Option<&str>, &str) -> String) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    let name_at = |at: usize| -> String { chars[at..].iter().take_while(|c| ident(**c)).collect() };
    while i < chars.len() {
        let c = chars[i];
        let previous = if i == 0 { None } else { Some(chars[i - 1]) };
        if c == '.' && previous.is_none_or(|p| !ident(p) && p != ')' && p != ']') && chars.get(i + 1).is_some_and(|c| c.is_ascii_alphabetic()) {
            let name = name_at(i + 1);
            out.push_str(&map(None, &name));
            i += 1 + name.chars().count();
            continue;
        }
        if ident(c) && previous.is_none_or(|p| !ident(p) && p != '.') {
            let word = name_at(i);
            let after = i + word.chars().count();
            if matches!(word.as_str(), "old" | "next") && chars.get(after) == Some(&'.') && chars.get(after + 1).is_some_and(|c| c.is_ascii_alphabetic()) {
                let name = name_at(after + 1);
                out.push_str(&map(Some(&word), &name));
                i = after + 1 + name.chars().count();
                continue;
            }
            out.push_str(&word);
            i = after;
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

fn screaming(name: &str) -> String {
    let mut out = String::new();
    for (i, c) in name.chars().enumerate() {
        if c.is_ascii_uppercase() && i > 0 { out.push('_'); }
        out.push(c.to_ascii_uppercase());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_move_into_the_mutation() {
        let stored = |image: Option<&str>, name: &str| match image { Some("next") => name.to_owned(), _ => format!("row.{name}") };
        assert_eq!(map_fields(".stars >= 1 and .stars <= 5", &|_, name| name.to_owned()), "stars >= 1 and stars <= 5");
        assert_eq!(map_fields("next.highBid >= old.highBid + old.increment", &stored), "highBid >= row.highBid + row.increment");
        assert_eq!(map_fields(".deadline > now", &stored), "row.deadline > now");
        assert_eq!(map_fields("helper(.a, viewer)", &stored), "helper(row.a, viewer)");
        assert_eq!(first_field("(old.highBid + 1)"), Some("highBid".into()));
        assert_eq!(screaming("drawAt"), "DRAW_AT");
        assert_eq!(strip_parens("(.a >= 1)"), ".a >= 1");
        assert_eq!(strip_parens("(.a) + (.b)"), "(.a) + (.b)");
    }
}
