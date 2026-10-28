//! Schema-bound, editable proof recipes. No new runtime or authorization analysis.
// @ref LLP 3000.011.003.000.000#19-generated-proof-scaffolding-scaf1 — preserve edits by content hash; incomplete scenarios refuse.
mod infer;
use crate::project::Project;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use snapback4_core::{
    ir::{ArgType, Expr, Input, ProgramKind, Stmt},
    schema::ColumnType,
};
use snapback4_lang::Bound;
use std::{collections::BTreeMap, io, path::Path};

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn quoted(value: &str) -> String {
    serde_json::to_string(value).unwrap()
}

/// Return JS rather than opaque placeholder JSON: every sample is an editable expression.
fn sample(kind: &ArgType, name: &str) -> String {
    match kind {
        ArgType::Optional(_) | ArgType::Cursor => "null".into(),
        ArgType::Principal => "account.principal".into(),
        ArgType::Id | ArgType::Ref { .. } => format!(
            "ctx.rows[{}] /* TODO: existing row id from setup */",
            quoted(name)
        ),
        ArgType::Text { min, max, .. } => {
            quoted(&"x".repeat((*min).max(1).min(*max).min(120) as usize))
        }
        ArgType::Enum { variants } => variants.first().map(|s| quoted(s)).unwrap_or("null".into()),
        ArgType::IntRange { min, max } => 0_i64.clamp(*min, *max).to_string(),
        ArgType::Int | ArgType::Decimal { .. } | ArgType::Money { .. } => "1".into(),
        ArgType::Bool => "false".into(),
        ArgType::Time => "await ctx.host.now() /* use the staging clock */".into(),
        ArgType::Image { .. } => "await ctx.upload(account, 'image')".into(),
        ArgType::File { types, .. } => format!(
            "await ctx.upload(account, 'file', {})",
            quoted(types.first().map(String::as_str).unwrap_or("text/plain"))
        ),
        ArgType::Video { .. } | ArgType::Bytes { .. } | ArgType::Scalar => {
            "undefined /* TODO: typed sample */".into()
        }
        ArgType::Json { .. } => "{}".into(),
        ArgType::ListRange { of, min, .. } => format!(
            "[{}]",
            (0..(*min).min(10))
                .map(|_| of.as_deref().map(|k| sample(k, name)).unwrap_or("1".into()))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        ArgType::List { .. } => "[]".into(),
    }
}
fn args(args: &BTreeMap<String, ArgType>) -> String {
    format!(
        "{{ {} }}",
        args.iter()
            .map(|(n, k)| format!("{}: {}", quoted(n), {
                let v = sample(k, n);
                if v.contains("ctx.") || v.contains("await ") {
                    "undefined /* TODO: extra provisioning value */".into()
                } else {
                    v
                }
            }))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn approvals(body: &[Stmt], args: &BTreeMap<String, ArgType>) -> Vec<Value> {
    let mut out = Vec::new();
    for stmt in body {
        let target = match stmt {
            Stmt::Update { table, patch, .. } => Some((table, patch)),
            Stmt::WriteTarget { target, patch, .. } => Some((&target.table, patch)),
            _ => None,
        };
        if let Some((table, Expr::Object(fields))) = target {
            for (by, value) in fields {
                if matches!(value, Expr::Input(Input::Viewer)) {
                    for (why, value) in fields {
                        if let Expr::Variable(reason) = value
                            && matches!(args.get(reason), Some(ArgType::Text { .. }))
                        {
                            out.push(json!({"table":table,"by":by,"why":why,"reasonArg":reason}));
                        }
                    }
                }
            }
        }
        match stmt {
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                out.extend(approvals(then_body, args));
                out.extend(approvals(else_body, args));
            }
            Stmt::For { body, .. } => out.extend(approvals(body, args)),
            _ => {}
        }
    }
    out
}

fn walk(value: &Value, guards: &mut Vec<Value>) {
    match value {
        Value::Object(fields) => {
            if let Some(r) = fields.get("Require") {
                guards.push(r.clone());
            }
            for value in fields.values() {
                walk(value, guards);
            }
        }
        Value::Array(values) => {
            for value in values {
                walk(value, guards);
            }
        }
        _ => {}
    }
}
fn uses_clock(value: &Value, names: &std::collections::BTreeSet<String>) -> bool {
    match value {
        Value::Object(m) => {
            m.get("Input")
                .is_some_and(|v| v == "Now" || v == "ReadTime")
                || m.get("Variable")
                    .and_then(Value::as_str)
                    .is_some_and(|n| names.contains(n))
                || m.values().any(|v| uses_clock(v, names))
        }
        Value::Array(v) => v.iter().any(|v| uses_clock(v, names)),
        _ => false,
    }
}
fn clock_bindings(value: &Value, names: &mut std::collections::BTreeSet<String>) {
    match value {
        Value::Object(m) => {
            for tag in ["Let", "Const", "Assign"] {
                if let Some(binding) = m.get(tag)
                    && uses_clock(&binding["value"], names)
                    && let Some(name) = binding["name"].as_str()
                {
                    names.insert(name.into());
                }
            }
            for v in m.values() {
                clock_bindings(v, names);
            }
        }
        Value::Array(v) => {
            for v in v {
                clock_bindings(v, names);
            }
        }
        _ => {}
    }
}

fn files(bound: &Bound) -> Vec<(&'static str, String)> {
    let candidates = bound
        .programs
        .iter()
        .filter(|p| p.program.kind == ProgramKind::Mutation)
        .filter_map(|p| {
            let principal = p
                .program
                .args
                .iter()
                .filter(|(_, k)| matches!(k, ArgType::Principal))
                .collect::<Vec<_>>();
            let roles = p
                .program
                .args
                .iter()
                .filter_map(|(n, k)| {
                    if let ArgType::Enum { variants } = k {
                        Some((n, variants))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>();
            let service_guard=p.program.body.iter().any(|stmt| if let Stmt::Require{condition:Expr::Binary{op:snapback4_core::ir::BinaryOp::Eq,left,right},..}=stmt { matches!((&**left,&**right),(Expr::Input(Input::Viewer),Expr::Literal(snapback4_core::Value::Id(s)))|(Expr::Literal(snapback4_core::Value::Id(s)),Expr::Input(Input::Viewer)) if s.starts_with("service:")) }else{false});
            (principal.len() == 1
                && (p.program.name=="provision" || service_guard)
                && roles.len() == 1
                && roles[0].1.len() <= 48
                && infer::Roster::shape(
                    &p.program,
                    principal[0].0,
                    roles[0].0,
                    &roles[0].1[0],
                    &bound.schema,
                )
                .is_some())
            .then(|| (&p.program, principal[0].0, roles[0].0, roles[0].1))
        })
        .collect::<Vec<_>>();
    // Prefer the conventional name; never silently pick an ambiguous custom mutation.
    let provision = candidates
        .iter()
        .find(|(p, _, _, _)| p.name == "provision")
        .or_else(|| (candidates.len() == 1).then(|| &candidates[0]));
    let mut roles = provision
        .map(|(_, _, _, v)| (*v).clone())
        .unwrap_or_else(|| {
            bound
                .schema
                .visible_tables()
                .filter_map(|(_, t)| {
                    if let Some(ColumnType::Enum { variants }) = t.columns.get("role") {
                        Some(variants.clone())
                    } else {
                        None
                    }
                })
                .flatten()
                .collect()
        });
    roles.sort();
    roles.dedup();
    if !roles.iter().any(|r| r == "users") {
        roles.push("users".into());
    }
    let plan = if let Some((p, principal, role, variants)) = provision {
        let mut services = Vec::new();
        fn services_in(v: &Value, out: &mut Vec<String>) {
            match v {
                Value::String(s) if s.starts_with("service:") => out.push(s[8..].into()),
                Value::Object(m) => {
                    for v in m.values() {
                        services_in(v, out)
                    }
                }
                Value::Array(v) => {
                    for v in v {
                        services_in(v, out)
                    }
                }
                _ => {}
            }
        }
        services_in(&serde_json::to_value(&p.body).unwrap(), &mut services);
        services.sort();
        services.dedup();
        let extra = p
            .args
            .iter()
            .filter(|(n, _)| *n != *principal && *n != *role)
            .map(|(n, k)| {
                format!("{}: {}", quoted(n), {
                    let v = sample(k, n);
                    if v.contains("ctx.") || v.contains("await ") {
                        "undefined /* TODO: extra provisioning value */".into()
                    } else {
                        v
                    }
                })
            })
            .collect::<Vec<_>>();
        format!(
            "{{ roles: {}, users: {}, provision: {{ name: {} }}, service: {}, args: (account) => ({{ {}{}: account.principal, {}: account.role{} }}) }}",
            serde_json::to_string(&variants.iter().map(|r| (r, 2)).collect::<BTreeMap<_, _>>())
                .unwrap(),
            if variants.iter().any(|r| r == "users") {
                0
            } else {
                2
            },
            quoted(&p.name),
            quoted(
                services
                    .first()
                    .filter(|_| services.len() == 1)
                    .map(String::as_str)
                    .unwrap_or("operator")
            ),
            ["principal", "role"]
                .iter()
                .filter(|name| !p.args.contains_key(**name))
                .map(|name| format!("{}: undefined, ", quoted(name)))
                .collect::<String>(),
            quoted(principal),
            quoted(role),
            if extra.is_empty() {
                String::new()
            } else {
                format!(", {}", extra.join(", "))
            }
        )
    } else {
        if roles.len() == 1 && roles[0] == "users" {
            "{ users: 2 }".into()
        } else {
            format!(
                "{{ roles: {}, users: 2, provision: null /* TODO: explicit role provisioning handle and args(account) */ }}",
                serde_json::to_string(
                    &roles
                        .iter()
                        .filter(|r| r.as_str() != "users")
                        .map(|r| (r, 2))
                        .collect::<BTreeMap<_, _>>()
                )
                .unwrap()
            )
        }
    };
    let mut facts = Vec::new();
    let mut cases = String::new();
    for p in &bound.programs {
        let p = &p.program;
        if p.kind == ProgramKind::Job {
            continue;
        }
        let body = serde_json::to_value(&p.body).unwrap();
        let mut clock_names = std::collections::BTreeSet::new();
        loop {
            let count = clock_names.len();
            clock_bindings(&body, &mut clock_names);
            if count == clock_names.len() {
                break;
            }
        }
        let mut guards = Vec::new();
        walk(&body, &mut guards);
        let guards=guards.into_iter().enumerate().map(|(i,g)|json!({"id":format!("guard-{i}"),"code":g["code"],"site":g["site"],"clock":uses_clock(&g,&clock_names),"condition":g["condition"]})).collect::<Vec<_>>();
        let approvals = approvals(&p.body, &p.args);
        facts.push(json!({"name":p.name,"kind":p.kind.word(),"args":p.args,"guards":guards,"approvals":approvals}));
        for role in &roles {
            let roster = provision.and_then(|(p, principal, role_arg, _)| {
                infer::Roster::from(p, principal, role_arg, role, &bound.schema)
            });
            let refusal = infer::refusal(p, roster.as_ref(), &bound.schema);
            let assertion = if !approvals.is_empty() && refusal.is_none() {
                "async (result, ctx, account, args) => { /* TODO: fill approvalRow in cases.mjs */ for (const a of ctx.schema.operations.find(p => p.name === OP_NAME).approvals) { const row = await approvalRow(ctx, account, args, result, a); ctx.assertApproval(row, account, args[a.reasonArg], a); } }".replace("OP_NAME",&quoted(&p.name))
            } else {
                "null /* TODO: async (result, ctx, account, args) => assert business data */".into()
            };
            cases.push_str(&format!("  {{ op: {}, role: {}, args: async (ctx, account) => ({}),\n    expected: {}, // TODO: tighten status/data; excluded roles need the exact refusal code.\n    assert: {} }},\n",quoted(&p.name),quoted(role),args(&p.args),refusal.map(|c|format!("{{ code: {} }}",quoted(&c))).unwrap_or(if p.kind==ProgramKind::Query {"{ complete: true }"}else if p.kind==ProgramKind::Action {"{ state: 'done' }"}else{"{ state: 'sent' }"}.into()),assertion));
        }
        for g in &guards {
            cases.push_str(&format!("  {{ op: {}, guard: {}, role: {}, args: null,\n    expected: {{ code: {} }}, advance: {}, // TODO: isolate this guard; earlier guards must pass.\n    assert: null }},\n",quoted(&p.name),g["id"],quoted(&roles[0]),g["code"],if g["clock"]==true {"null /* set e.g. '31d'; setup a fresh row before crossing its deadline */"}else{"undefined"}));
        }
    }
    let uploads=bound.schema.visible_tables().flat_map(|(table,t)|t.columns.iter().filter_map(move |(column,kind)| match kind.leaf(){ColumnType::Image{max,..}=>Some(json!({"table":table,"column":column,"kind":"image","max":max})),ColumnType::File{max,types}=>Some(json!({"table":table,"column":column,"kind":"file","max":max,"types":types})),_=>None})).collect::<Vec<_>>();
    let lifetimes = bound
        .schema
        .visible_tables()
        .filter(|(_, t)| t.expire.is_some() || t.not_before.is_some())
        .map(|(n, t)| json!({"table":n,"expire":t.expire,"notBefore":t.not_before}))
        .collect::<Vec<_>>();
    let schema = json!({"roles":roles,"operations":facts,"uploads":uploads,"lifetimes":lifetimes,"schedules":bound.schema.schedules,"password":bound.schema.auth.password});
    let mut time_cases=lifetimes.iter().flat_map(|t|["expire","notBefore"].into_iter().filter_map(move |k|t[k].as_str().map(|field|format!("  {{ table: {}, field: {}, advance: null, assert: null }}, // TODO: before/after {}; use host.advance, then authorized reads",t["table"],quoted(field),field)))).collect::<Vec<_>>().join("\n");
    for schedule in &bound.schema.schedules {
        time_cases.push_str(&format!("\n  {{ schedule: {}, advance: {}, assert: null }}, // TODO: assert job/action results and fired report; choose a fresh boundary", quoted(&schedule.name), quoted(&format!("{}ms",if schedule.months>0 { 32*86400000_u64*schedule.months as u64 }else{schedule.every_ms}))));
    }
    // Expand right-to-left once, so schema strings are never interpreted as placeholders.
    let cases = include_str!("proof_scaffold/cases.mjs")
        .replacen("TIME_CASES", &time_cases, 1)
        .replacen("OPERATION_CASES", &cases, 1)
        .replacen("ACCOUNT_PLAN", &plan, 1);
    vec![
        (
            "schema.json",
            format!("{}\n", serde_json::to_string_pretty(&schema).unwrap()),
        ),
        ("cases.mjs", cases),
        ("host.mjs", include_str!("proof_scaffold/host.mjs").into()),
        (
            "acceptance.mjs",
            include_str!("proof_scaffold/acceptance.mjs").into(),
        ),
        (
            "frontend-proof.mjs",
            include_str!("proof_scaffold/frontend-proof.mjs").into(),
        ),
        (
            "probe-serve.mjs",
            include_str!("proof_scaffold/probe-serve.mjs").into(),
        ),
        ("README.md", include_str!("proof_scaffold/README.md").into()),
    ]
}

/// Called only after a green check, never during deploy/private source checks.
pub(crate) fn generate(project: &Project, bound: &Bound) -> io::Result<Option<String>> {
    let dir = project.root.join("scripts/proof-scaffold");
    // Refuse symlink custody for directories and files, including the manifest.
    for path in [project.root.join("scripts"), dir.clone()] {
        if std::fs::symlink_metadata(path).is_ok_and(|m| !m.is_dir()) {
            return Ok(Some(
                "proof scaffold: scripts/proof-scaffold preserved (directory is not owned)".into(),
            ));
        }
    }
    std::fs::create_dir_all(&dir)?;
    let manifest = dir.join(".generated-hashes.json");
    let old: BTreeMap<String, String> = if regular(&manifest)? {
        serde_json::from_slice(&std::fs::read(&manifest)?).unwrap_or_default()
    } else {
        BTreeMap::new()
    };
    let mut hashes = old.clone();
    let mut written = Vec::new();
    let mut kept = Vec::new();
    let packet = files(bound);
    hashes.insert(
        "$current-schema".into(),
        hash(
            packet
                .iter()
                .find(|(name, _)| *name == "schema.json")
                .unwrap()
                .1
                .as_bytes(),
        ),
    );
    for (name, text) in packet {
        let path = dir.join(name);
        let regular = regular(&path)?;
        let current = if regular {
            Some(std::fs::read(&path)?)
        } else {
            None
        };
        if current.as_deref() == Some(text.as_bytes()) {
            hashes.insert(name.into(), hash(text.as_bytes()));
            continue;
        }
        if std::fs::symlink_metadata(&path).is_ok()
            && (!regular
                || current
                    .as_ref()
                    .is_none_or(|b| old.get(name) != Some(&hash(b))))
        {
            kept.push(name);
            continue;
        }
        // create_new prevents collisions on first generation; rename replaces only a hash-checked regular file.
        if current.is_none() {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)?;
            f.write_all(text.as_bytes())?;
        } else {
            std::fs::write(&path, text.as_bytes())?;
        }
        hashes.insert(name.into(), hash(text.as_bytes()));
        written.push(name);
    }
    if hashes != old
        && (std::fs::symlink_metadata(&manifest)
            .is_err_and(|e| e.kind() == io::ErrorKind::NotFound)
            || regular(&manifest)?)
    {
        std::fs::write(&manifest, serde_json::to_vec_pretty(&hashes)?)?;
    }
    if written.is_empty() && kept.is_empty() {
        return Ok(None);
    }
    Ok(Some(format!(
        "proof scaffold: scripts/proof-scaffold/ ({} written, {} edited files kept); node scripts/proof-scaffold/acceptance.mjs",
        written.len(),
        kept.len()
    )))
}
fn regular(path: &Path) -> io::Result<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(m) => Ok(m.is_file()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}
