//! Frequencies describe actual generated cases; overlapping features count once.
use crate::{ast::*, generate::Case};
use std::collections::BTreeSet;
pub fn features(case: &Case) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for table in &case.program.tables {
        out.insert(format!("rule/{:?}", table.rule));
        out.insert(format!("residency/{:?}", table.residency));
        for c in &table.columns {
            out.insert(format!("column/{:?}", c.ty));
        }
        if table.keys.iter().any(|k| k.2) {
            out.insert("schema/unique-key".into());
        }
        if table.keys.iter().any(|k| !k.2) {
            out.insert("schema/index".into());
        }
    }
    if let Some(table) = case.program.tables.first() {
        out.insert(format!("items-rule/{:?}", table.rule));
        out.insert(format!("items-residency/{:?}", table.residency));
    }
    match &case.program.body {
        Body::Scalar(e) => {
            out.insert("body/scalar".into());
            expr(e, &mut out);
        }
        Body::Write(w, e) => {
            out.insert(format!("body/{w:?}"));
            if !matches!(w, Write::Delete) {
                expr(e, &mut out);
            }
        }
        Body::Read {
            kind,
            descending,
            filter,
            ..
        } => {
            out.insert(format!("body/{kind:?}"));
            if matches!(kind, Read::Page | Read::Bounded) {
                out.insert(format!(
                    "order/{}",
                    if *descending {
                        "descending"
                    } else {
                        "ascending"
                    }
                ));
            }
            if *filter {
                out.insert("read/filter".into());
            }
        }
    }
    if case.args["n"].is_null() {
        out.insert("input/null".into());
    }
    let inputs =
        serde_json::to_string(&case.args).unwrap() + &serde_json::to_string(&case.rows).unwrap();
    if inputs.contains("900719925474099") {
        out.insert("input/near-i53".into());
    }
    if inputs.chars().any(|c| c as u32 > 0xffff) {
        out.insert("input/non-bmp".into());
    }
    out
}
fn expr(e: &Expr, out: &mut BTreeSet<String>) {
    match e {
        Expr::Binary(op, a, b) => {
            out.insert(format!("expr/{op:?}"));
            expr(a, out);
            expr(b, out);
        }
        Expr::Assert(e) => {
            out.insert("expr/null-assert".into());
            expr(e, out);
        }
        Expr::Identity(e) => {
            out.insert("expr/helper-call".into());
            expr(e, out);
        }
        Expr::Text(s) if s.chars().any(|c| c as u32 > 0xffff) => {
            out.insert("expr/non-bmp".into());
        }
        _ => {}
    }
}
