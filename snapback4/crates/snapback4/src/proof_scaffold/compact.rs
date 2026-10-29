//! One small authored scenario, without an operation/role/guard expansion.
// @ref LLP 3000.037.000#17-optional-proof-scaffolding-muse1 — a bounded helper remains available explicitly; default drafts still attracted Muse expansion.
use super::{account_plan, host_template, quoted};
use crate::project::Project;
use snapback4_lang::Bound;
use snapback4_core::ir::ProgramKind;
use std::{io, io::Write};

pub(super) fn files(bound: &Bound) -> Vec<(&'static str, String)> {
    let (_, plan, _) = account_plan(bound);
    // This is a reading budget, not a schema/role ceiling. Large/custom plans
    // remain author-owned; never silently truncate accounts or provisioning args.
    let plan = if plan.len() <= 512 { plan } else { "null /* Fill a real-account plan; guide api proof. */".into() };
    let op = bound.programs.iter().find(|p| p.program.kind != ProgramKind::Job && p.program.name != "provision")
        .map(|p| quoted(&p.program.name)).filter(|s| s.len() <= 256).unwrap_or("null".into());
    let cases = include_str!("draft-cases.mjs").replacen("OP_NAME", &op, 1).replacen("ACCOUNT_PLAN", &plan, 1);
    let facts = format!("export const schema={{password:{},roles:[...Object.keys(accountPlan?.roles??{{}}),...(accountPlan?.users?['users']:[])],operations:[...operations.values()].map(({{name,kind}})=>({{name,kind}}))}};", bound.schema.auth.password);
    let host = host_template(&facts, false);
    vec![("cases.mjs", cases), ("host.mjs", host), ("acceptance.mjs", include_str!("draft-acceptance.mjs").into())]
}
pub(super) fn generate(project: &Project, bound: &Bound) -> io::Result<Option<String>> {
    let dir = project.root.join("scripts/proof-draft");
    // Any existing directory/file/symlink belongs to its author. Code is born
    // once; schema checks and verify never rewrite or expand the draft.
    if std::fs::symlink_metadata(project.root.join("scripts")).is_ok_and(|m| !m.is_dir()) { return Ok(None); }
    if std::fs::symlink_metadata(&dir).is_ok() { return Ok(None); }
    let packet = files(bound);
    debug_assert!(packet.iter().map(|(_, s)| s.len()).sum::<usize>() <= 8000);
    std::fs::create_dir_all(project.root.join("scripts"))?;
    match std::fs::create_dir(&dir) {
        Ok(()) => {},
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Ok(None),
        Err(e) => return Err(e),
    }
    for (name, text) in packet {
        let mut file = std::fs::OpenOptions::new().create_new(true).write(true).open(dir.join(name))?;
        file.write_all(text.as_bytes())?;
    }
    Ok(Some("proof draft: scripts/proof-draft/cases.mjs; set acceptance to node scripts/proof-draft/acceptance.mjs".into()))
}
