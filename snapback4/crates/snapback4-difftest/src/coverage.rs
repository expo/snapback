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
    // LLP 3000.036.001: whether the compiled page is the merge of its branches.
    if case.program.domain.is_some() || case.program.tables.first().is_some_and(|t| t.rule == Rule::TwoParty) {
        out.insert("read/branch-shape".into());
        let bound = snapback4_lang::compile(&[("schema.q".into(), case.program.source())]);
        let merged = bound.programs.iter().filter(|p| p.program.name == "run")
            .any(|p| snapback4_core::search_plan::merges(&p.program.body).iter().any(|m| m.branches()));
        out.insert(format!("read/branch-{}", if merged { "merged" } else { "single-index" }));
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
        Body::Block(b) => {
            out.insert("body/block".into());
            block(b, "block", &mut out);
        }
        Body::Read {
            kind,
            descending,
            filter,
            project,
            ..
        } => {
            out.insert(format!("body/{kind:?}"));
            if let Some(fields) = project {
                out.insert("read/projection".into());
                for f in fields {
                    out.insert(format!("projection/{f:?}"));
                }
            }
            if project.as_ref().is_some_and(|f| f.iter().any(|f| *f != Proj::Score)) || matches!(kind, Read::Fold) {
                out.insert("read/prefetch-reachable".into());
            }
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
    for table in &case.program.tables {
        if table.expire.is_some() {
            out.insert(format!("expire/{}", table.name));
        }
        if table.name == "tags" {
            out.insert(format!("tags-rule/{:?}", table.rule));
            out.insert(format!("tags-residency/{:?}", table.residency));
        }
    }
    if !case.program.prelude.is_empty() {
        out.insert("prelude/present".into());
        out.insert(format!("prelude/steps-{}", case.program.prelude.len()));
        for b in &case.program.prelude {
            block(b, "prelude", &mut out);
        }
        if case.steps.iter().any(|s| s.viewer.is_some()) {
            out.insert("prelude/other-viewer".into());
        }
    }
    let seeded = crate::execute::seed_clock(case);
    if seeded != case.clock {
        out.insert("clock/advances".into());
    }
    if case.steps.windows(2).any(|w| w[0].at == w[1].at) || case.steps.last().is_some_and(|s| s.at == case.clock) {
        out.insert("clock/simultaneous-operations".into());
    }
    if case.sweep || case.steps.iter().any(|s| s.sweep) {
        out.insert("clock/sweep".into());
    }
    let times: Vec<i64> = std::iter::once(seeded).chain(case.steps.iter().map(|s| s.at)).chain([case.clock]).collect();
    for (_, row) in &case.rows {
        if let Some(until) = row.get("until").and_then(|u| u.as_i64()) {
            out.insert("expire/row-with-deadline".into());
            if until <= case.clock {
                out.insert("expire/row-expired-by-run".into());
            }
            if times.contains(&until) {
                out.insert("expire/row-deadline-at-an-operation".into());
            }
            if until < seeded {
                out.insert("expire/row-expired-when-seeded".into());
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
        Expr::Var(..) => {
            out.insert("expr/local".into());
        }
        Expr::Score(_) | Expr::Present(_) => {
            out.insert("expr/read-in-mutation".into());
        }
        Expr::Calendar(f, e) => {
            out.insert(format!("expr/calendar-{}", f.source("t").split('(').next().unwrap_or_default()));
            expr(e, out);
        }
        _ => {}
    }
}

fn block(b: &Block, scope: &str, out: &mut BTreeSet<String>) {
    let all = b.all();
    out.insert(format!("{scope}/statements-{}", b.stmts.len().min(5)));
    let writes = all.iter().filter(|s| matches!(s, Stmt::Write { .. })).count();
    if writes > 1 {
        out.insert(format!("{scope}/multi-write"));
    }
    for s in &all {
        match s {
            Stmt::Let(_, e) => {
                out.insert(format!("{scope}/let"));
                expr(e, out);
            }
            Stmt::Require(e, _) => {
                out.insert(format!("{scope}/require"));
                expr(e, out);
            }
            Stmt::If(e, _, otherwise) => {
                out.insert(format!("{scope}/if{}", if otherwise.is_empty() { "" } else { "-else" }));
                expr(e, out);
            }
            Stmt::Write { kind, target, value, tag, ttl } => {
                out.insert(format!("{scope}/write-{kind:?}"));
                if *target == Key::K2 {
                    out.insert(format!("{scope}/write-second-key"));
                }
                if matches!(kind, Write::Insert | Write::Upsert) && matches!(tag.as_str(), "tag0" | "tag1") {
                    out.insert(format!("{scope}/unique-tag-clash-candidate"));
                }
                if ttl.is_some() && !matches!(kind, Write::Delete) {
                    out.insert(format!("{scope}/write-ttl"));
                }
                // A delete prints no value.
                if !matches!(kind, Write::Delete) {
                    expr(value, out);
                }
            }
        }
    }
    let lets: Vec<_> = b.stmts.iter().filter(|s| matches!(s, Stmt::Let(..))).collect();
    if lets.len() > 1 {
        out.insert(format!("{scope}/let-chain"));
    }
    expr(&b.ret, out);
}
