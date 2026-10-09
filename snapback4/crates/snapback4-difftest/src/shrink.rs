//! Greedy structural reduction to a fixed point of the declared reductions.
use crate::{
    ast::*,
    generate::Case,
    oracle::{self, Finding, Verdict},
};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Artifact {
    pub version: u32,
    pub case: Case,
    pub finding: Finding,
    pub shrink_attempts: u64,
}
fn smaller(case: &Case) -> Vec<Case> {
    let mut out = vec![];
    for i in 0..case.rows.len() {
        let mut c = case.clone();
        c.rows.remove(i);
        out.push(c);
    }
    for i in 0..case.program.lets.len() {
        let mut c = case.clone();
        c.program.lets.remove(i);
        out.push(c);
    }
    for i in 0..case.program.tables.len() {
        let mut c = case.clone();
        let table = c.program.tables.remove(i);
        c.rows.retain(|(t, _)| *t != table.name);
        out.push(c);
        for j in 0..case.program.tables[i].columns.len() {
            let mut c = case.clone();
            let table = &mut c.program.tables[i];
            let col = table.columns.remove(j);
            table.keys.retain(|(_, cols, _)| !cols.contains(&col.name));
            for (t, row) in &mut c.rows {
                if *t == table.name {
                    row.as_object_mut().unwrap().remove(&col.name);
                }
            }
            out.push(c);
        }
        for j in 0..case.program.tables[i].keys.len() {
            let mut c = case.clone();
            c.program.tables[i].keys.remove(j);
            out.push(c);
        }
    }
    // Lean variants (`lean.rs`): drop each, back to the base generator.
    if case.program.order.is_some() {
        let mut c = case.clone();
        c.program.order = None;
        out.push(c);
    }
    if case.program.residual.is_some() {
        let mut c = case.clone();
        c.program.residual = None;
        out.push(c);
    }
    for i in 0..case.program.tables.len() {
        if case.program.tables[i].effects.is_some() {
            let mut c = case.clone();
            c.program.tables[i].effects = None;
            out.push(c);
        }
    }
    if case.program.helper {
        let mut c = case.clone();
        c.program.helper = false;
        out.push(c);
    }
    match &case.program.body {
        Body::Scalar(e) | Body::Write(_, e) => {
            for expr in e.simpler() {
                let mut c = case.clone();
                match &mut c.program.body {
                    Body::Scalar(e) | Body::Write(_, e) => *e = expr,
                    _ => unreachable!(),
                };
                out.push(c);
            }
        }
        Body::Block(b) => {
            for reduced in block_smaller(b) {
                let mut c = case.clone();
                c.program.body = Body::Block(reduced);
                out.push(c);
            }
        }
        Body::Read { take, filter, project, .. } => {
            if let Some(fields) = project {
                let mut c = case.clone();
                if let Body::Read { project, .. } = &mut c.program.body {
                    *project = None;
                }
                out.push(c);
                for i in 0..fields.len() {
                    let mut c = case.clone();
                    if let Body::Read { project: Some(f), .. } = &mut c.program.body {
                        f.remove(i);
                    }
                    out.push(c);
                }
            }
            if *take > 1 {
                let mut c = case.clone();
                if let Body::Read { take, .. } = &mut c.program.body {
                    *take = 1;
                }
                out.push(c);
            }
            if *filter {
                let mut c = case.clone();
                if let Body::Read { filter, .. } = &mut c.program.body {
                    *filter = false;
                }
                out.push(c);
            }
        }
    }
    // The prelude, its clock and sweeps, and expiry.
    for i in 0..case.program.prelude.len() {
        let mut c = case.clone();
        c.program.prelude.remove(i);
        if i < c.steps.len() {
            c.steps.remove(i);
        }
        out.push(c);
        for reduced in block_smaller(&case.program.prelude[i]) {
            let mut c = case.clone();
            c.program.prelude[i] = reduced;
            out.push(c);
        }
    }
    for i in 0..case.steps.len() {
        let step = &case.steps[i];
        if step.sweep || step.viewer.is_some() {
            let mut c = case.clone();
            c.steps[i].sweep = false;
            out.push(c);
            let mut c = case.clone();
            c.steps[i].viewer = None;
            out.push(c);
        }
    }
    if case.sweep {
        let mut c = case.clone();
        c.sweep = false;
        out.push(c);
    }
    if case.seeded_at.is_some() {
        // Collapse time: every operation at `clock`.
        let mut c = case.clone();
        c.seeded_at = None;
        for s in &mut c.steps {
            s.at = c.clock;
        }
        out.push(c);
    }
    for i in 0..case.program.tables.len() {
        if case.program.tables[i].expire.is_some() {
            let mut c = case.clone();
            c.program.tables[i].expire = None;
            out.push(c);
        }
    }
    for i in 0..case.rows.len() {
        if case.rows[i].1.get("until").is_some_and(|u| !u.is_null()) {
            let mut c = case.clone();
            c.rows[i].1["until"] = serde_json::Value::Null;
            out.push(c);
        }
    }
    for field in ["a", "b", "n", "bucket"] {
        if case.args[field].is_number() && case.args[field] != 0 {
            let mut c = case.clone();
            c.args[field] = serde_json::json!(0);
            out.push(c);
        }
    }
    out
}
/// Structural reductions of a block: drop a statement, inline either branch
/// of an `if`, drop an `else`, simplify each expression, and plain writes.
pub fn block_smaller(b: &Block) -> Vec<Block> {
    let mut out = vec![];
    let mut with = |f: &dyn Fn(&mut Block)| {
        let mut c = b.clone();
        f(&mut c);
        out.push(c);
    };
    for i in 0..b.stmts.len() {
        with(&|c| {
            c.stmts.remove(i);
        });
        if let Stmt::If(cond, then, otherwise) = &b.stmts[i] {
            for branch in [then, otherwise] {
                with(&|c| {
                    c.stmts.splice(i..=i, branch.clone());
                });
            }
            if !otherwise.is_empty() {
                with(&|c| {
                    if let Stmt::If(_, _, e) = &mut c.stmts[i] {
                        e.clear();
                    }
                });
            }
            for j in 0..then.len() + otherwise.len() {
                with(&|c| {
                    if let Stmt::If(_, t, e) = &mut c.stmts[i] {
                        if j < t.len() {
                            if t.len() > 1 {
                                t.remove(j);
                            }
                        } else {
                            e.remove(j - t.len());
                        }
                    }
                });
            }
            for e in cond.simpler() {
                with(&|c| {
                    if let Stmt::If(x, ..) = &mut c.stmts[i] {
                        *x = e.clone();
                    }
                });
            }
        }
        match &b.stmts[i] {
            Stmt::Let(_, e) | Stmt::Require(e, _) => {
                for e in e.simpler() {
                    with(&|c| {
                        if let Stmt::Let(_, x) | Stmt::Require(x, _) = &mut c.stmts[i] {
                            *x = e.clone();
                        }
                    });
                }
            }
            Stmt::Write { value, tag, ttl, target, .. } => {
                for e in value.simpler() {
                    with(&|c| {
                        if let Stmt::Write { value, .. } = &mut c.stmts[i] {
                            *value = e.clone();
                        }
                    });
                }
                if ttl.is_some() || tag != "tag" || *target != Key::Key {
                    with(&|c| {
                        if let Stmt::Write { ttl, .. } = &mut c.stmts[i] {
                            *ttl = None;
                        }
                    });
                    with(&|c| {
                        if let Stmt::Write { tag, .. } = &mut c.stmts[i] {
                            *tag = "tag".into();
                        }
                    });
                    with(&|c| {
                        if let Stmt::Write { target, .. } = &mut c.stmts[i] {
                            *target = Key::Key;
                        }
                    });
                }
            }
            Stmt::If(..) => {}
        }
    }
    for e in b.ret.simpler() {
        with(&|c| c.ret = e.clone());
    }
    out
}
pub fn shrink(case: Case, finding: Finding) -> Artifact {
    shrink_with(case, finding, oracle::reproduce)
}
pub fn shrink_with(
    mut case: Case,
    mut finding: Finding,
    mut reproduce: impl FnMut(&Case, &str, &oracle::Oracle) -> Result<Verdict, String>,
) -> Artifact {
    let mut attempts = 0;
    loop {
        let mut reduced = None;
        // A reduction that changes nothing would be accepted forever.
        let current = serde_json::to_string(&case).unwrap();
        for c in smaller(&case) {
            if serde_json::to_string(&c).unwrap() == current {
                continue;
            }
            attempts += 1;
            if let Ok(Verdict::Disagree(f)) = reproduce(&c, &c.program.source(), &finding.oracle) {
                if f.signature == finding.signature {
                    reduced = Some((c, f));
                    break;
                }
            }
        }
        match reduced {
            Some((c, f)) => {
                case = c;
                finding = f;
            }
            None => break,
        }
    }
    Artifact {
        version: 1,
        case,
        finding,
        shrink_attempts: attempts,
    }
}
pub fn save(path: &Path, artifact: &Artifact) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    fs::write(path.join("case.q"), artifact.case.program.source()).map_err(|e| e.to_string())?;
    fs::write(
        path.join("case.json"),
        serde_json::to_vec_pretty(artifact).unwrap(),
    )
    .map_err(|e| e.to_string())
}
pub fn replay(path: &Path) -> Result<Verdict, String> {
    let a: Artifact =
        serde_json::from_slice(&fs::read(path.join("case.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if a.version != 1 {
        return Err("unsupported case version".into());
    }
    let source = fs::read_to_string(path.join("case.q")).map_err(|e| e.to_string())?;
    if source != a.case.program.source() {
        return Err("case.q differs from the structural case.json; edit the AST to retain rewrite/shrink semantics".into());
    }
    oracle::reproduce(&a.case, &source, &a.finding.oracle)
}
