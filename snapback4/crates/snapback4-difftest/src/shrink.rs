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
        Body::Read { take, filter, .. } => {
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
    for field in ["a", "b", "n", "bucket"] {
        if case.args[field].is_number() && case.args[field] != 0 {
            let mut c = case.clone();
            c.args[field] = serde_json::json!(0);
            out.push(c);
        }
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
        for c in smaller(&case) {
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
