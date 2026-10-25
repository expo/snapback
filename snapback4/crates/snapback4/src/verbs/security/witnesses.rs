//! Concrete question evidence; this never changes gate or invariant verdicts.
// @ref LLP 3000.036.004#19-wave-28-output-and-witness-decisions-dx11 — inferred witnesses never become authored refutations.
use super::*;
use snapback4_core::schema::ColumnType;
use snapback4_lang::{
    Diagnostic,
    security::challenges::{self, Counterexample},
};
fn hash(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}
// Generated values only: retain typed scalars, redact opaque payloads.
fn safe(value: &snapback4_core::Value, kind: Option<&ColumnType>) -> serde_json::Value {
    use snapback4_core::Value;
    match (value, kind.map(ColumnType::required)) {
        (
            _,
            Some(
                ColumnType::Text { .. }
                | ColumnType::Json { .. }
                | ColumnType::Bytes { .. }
                | ColumnType::Image { .. }
                | ColumnType::File { .. }
                | ColumnType::Video { .. },
            ),
        ) => json!("<redacted>"),
        (
            Value::Array(xs),
            Some(ColumnType::List { of, .. } | ColumnType::ListRange { of, .. }),
        ) => json!(xs.iter().map(|v| safe(v, Some(of))).collect::<Vec<_>>()),
        (
            Value::String(_) | Value::Bytes(_) | Value::Row(_) | Value::Map(_) | Value::Array(_),
            None,
        ) => json!("<redacted>"),
        _ => serde_json::to_value(value).unwrap(),
    }
}
fn image(bound: &Bound, table: &str, row: &snapback4_core::Value) -> serde_json::Value {
    let snapback4_core::Value::Row(fields) = row else {
        return json!("<redacted>");
    };
    json!(
        fields
            .iter()
            .map(|(name, value)| (
                name,
                safe(
                    value,
                    bound.schema.table(table).and_then(|t| t.columns.get(name))
                )
            ))
            .collect::<BTreeMap<_, _>>()
    )
}
fn actual_args(c: &Counterexample) -> &BTreeMap<String, snapback4_core::Value> {
    if !c.args.is_empty() {
        return &c.args;
    }
    c.history
        .iter()
        .rev()
        .find(|step| step.operation == c.operation && step.viewer == c.viewer)
        .map(|step| &step.args)
        .unwrap_or(&c.args)
}
fn evidence(bound: &Bound, inv: &security::Invariant, c: &Counterexample) -> serde_json::Value {
    let args = actual_args(c)
        .iter()
        .map(|(name, value)| (name, safe(value, None)))
        .collect::<BTreeMap<_, _>>();
    let old = c.old.as_ref().map(|row| image(bound, &inv.table, row));
    let next = image(bound, &inv.table, &c.row);
    let summary = format!(
        "{}({}) as {} → ok; {} {} -> {}; candidate invariant {} only {} (finite generated-fixture replay, not proof)",
        c.operation,
        serde_json::to_string(&args).unwrap(),
        c.viewer,
        inv.target_label(),
        old.as_ref()
            .map(|v| v.to_string())
            .unwrap_or_else(|| "absent".into()),
        next,
        inv.target,
        inv.predicate
    );
    let history=c.history.iter().map(|step|json!({"operation":step.operation,"viewer":step.viewer,"args":step.args.iter().map(|(k,v)|(k,safe(v,None))).collect::<BTreeMap<_,_>>(),"state":step.result["state"]})).collect::<Vec<_>>();
    let supporting = c
        .supporting_rows
        .iter()
        .map(|(table, rows)| {
            (
                table,
                rows.iter()
                    .map(|r| image(bound, table, r))
                    .collect::<Vec<_>>(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    json!({"history":history,"supportingRows":supporting,"summary":summary,"candidate":format!("invariant {} only {}",inv.target_label(),inv.predicate),"operation":c.operation,"viewer":c.viewer,"args":args,"effect":c.effect,"old":old,"row":next,"reachability":c.reachability,"scope":c.scope})
}
fn candidate(sources: &[(String, String)], line: &str) -> Option<security::Invariant> {
    let mut sources = sources.to_vec();
    sources.push(("$dx11-question.q".into(), format!("{line}\n")));
    let bound = snapback4_lang::compile(&sources);
    if !bound.diagnostics.is_empty() {
        return None;
    }
    let mut inv = bound
        .invariants
        .into_iter()
        .find(|i| i.site.file == "$dx11-question.q")?;
    inv.site.file = format!("$derived/dx11/{}", hash(line.as_bytes()));
    Some(inv)
}
fn candidates(
    bound: &Bound,
    sources: &[(String, String)],
    notes: &[Diagnostic],
) -> Vec<(usize, security::Invariant)> {
    let derived = security::derived::invariants(sources, bound);
    let mut out = Vec::new();
    for (index, n) in notes.iter().enumerate() {
        if n.code == "N_DERIVED_WRITE_AUTHORITY" {
            for inv in &derived {
                if inv.site == n.site {
                    out.push((index, inv.clone()));
                }
            }
        }
        if n.code == "N_INSERT_WRITE_INTENT" {
            if let Some(subject) = n
                .message
                .split(": ")
                .nth(1)
                .and_then(|s| s.split_whitespace().next())
            {
                for inv in &derived {
                    if subject == format!("{}.{}", inv.table, inv.column.as_deref().unwrap_or("")) {
                        out.push((index, inv.clone()));
                    }
                }
                if let Some(policy) = n
                    .message
                    .split("without the edit restriction of ")
                    .nth(1)
                    .and_then(|s| s.split_once(": ").map(|(_, p)| p))
                    .and_then(|s| s.split("; creation admission:").next())
                {
                    if let Some(inv) = candidate(
                        sources,
                        &format!("invariant {subject} update only {policy}"),
                    ) {
                        out.push((index, inv));
                    }
                }
            }
        }
        if n.code == "N_ARGUMENT_GRANT" {
            let Some(subject) = n.message.split("reader-grant column ").nth(1) else {
                continue;
            };
            let Some((table, column)) = subject.split_once('.') else {
                continue;
            };
            // Name-matched role membership is a candidate question, never a rule.
            for (roles, t) in bound.schema.visible_tables() {
                for (role, kind) in &t.columns {
                    if let ColumnType::Enum { variants } = kind.required() {
                        if variants.iter().any(|v| v == column) {
                            if let Some(principal) = t.columns.iter().find_map(|(c, k)| {
                                matches!(k.required(), ColumnType::Principal).then_some(c)
                            }) {
                                if let Some(inv) = candidate(
                                    sources,
                                    &format!(
                                        "invariant {table} always exists {roles}[{principal} = .{column}, {role} = '{column}']"
                                    ),
                                ) {
                                    out.push((index, inv));
                                }
                            }
                        }
                    }
                }
            }
        }
        if n.code == "N_APPROVAL_NOT_ENFORCED" {
            let Some((subject, _)) = n.message.split_once(':') else {
                continue;
            };
            let Some((table, column)) = subject.split_once('.') else {
                continue;
            };
            let Some(t) = bound.schema.table(table) else {
                continue;
            };
            if !matches!(
                t.columns.get(column).map(ColumnType::required),
                Some(ColumnType::Bool)
            ) {
                continue;
            }
            let stem = column
                .to_lowercase()
                .split("approv")
                .next()
                .unwrap_or("")
                .to_owned();
            let trigger = t.columns.iter().find_map(|(c, k)| {
                (c != column
                    && !stem.is_empty()
                    && c.to_lowercase().starts_with(&stem)
                    && matches!(k.required(), ColumnType::Bool))
                .then_some(c)
            });
            let predicate = trigger
                .map(|trigger| format!("not .{trigger} or .{column}"))
                .unwrap_or_else(|| format!(".{column}"));
            let Some(ops) = n
                .message
                .split("transitions ")
                .nth(1)
                .and_then(|s| s.split(" do not").next())
            else {
                continue;
            };
            // A column-change candidate uses the campaign's mature transition
            // exploration; it observes the same operation, without adding a rule.
            fn columns(
                value: &serde_json::Value,
                table: &str,
                out: &mut std::collections::BTreeSet<String>,
            ) {
                if let Some(write) = value
                    .get("WriteTarget")
                    .filter(|w| w["target"]["table"] == table)
                {
                    if let Some(fields) = write["patch"]["Object"].as_object() {
                        out.extend(fields.keys().cloned());
                    }
                }
                if let Some(write) = value.get("Update").filter(|w| w["table"] == table) {
                    if let Some(fields) = write["patch"]["Object"].as_object() {
                        out.extend(fields.keys().cloned());
                    }
                }
                match value {
                    serde_json::Value::Object(xs) => {
                        for v in xs.values() {
                            columns(v, table, out)
                        }
                    }
                    serde_json::Value::Array(xs) => {
                        for v in xs {
                            columns(v, table, out)
                        }
                    }
                    _ => {}
                }
            }
            for op in ops.split(", ").collect::<Vec<_>>().into_iter().rev() {
                if let Some(program) = bound.programs.iter().find(|p| p.program.name == op) {
                    let mut changed = std::collections::BTreeSet::new();
                    columns(
                        &serde_json::to_value(&program.program).unwrap(),
                        table,
                        &mut changed,
                    );
                    for col in changed.into_iter().filter(|c| {
                        matches!(
                            t.columns.get(c).map(ColumnType::required),
                            Some(ColumnType::Time)
                        )
                    }) {
                        if let Some(inv) = candidate(
                            sources,
                            &format!("invariant {table}.{col} update only {predicate}"),
                        ) {
                            out.push((index, inv));
                        }
                    }
                }
            }
        }
    }
    out
}
/// Once an edit is admitted, try a concrete decreasing edit through that same
/// operation. Both writes run on the engine; no fabricated old/new values.
fn decreasing_edit(
    bound: &Bound,
    inv: &security::Invariant,
    c: &Counterexample,
) -> Option<Counterexample> {
    use snapback4_core::{Context, Engine, Value};
    let column = inv.column.as_ref()?;
    if !matches!(
        bound.schema.tables[&inv.table]
            .columns
            .get(column)?
            .required(),
        ColumnType::Money { .. }
            | ColumnType::Int
            | ColumnType::IntRange { .. }
            | ColumnType::Decimal { .. }
    ) || !actual_args(c).contains_key(column)
    {
        return None;
    }
    let mut engine = Engine::memory(
        bound.schema.clone(),
        bound.programs.iter().map(|p| p.program.clone()),
    )
    .ok()?;
    if inv.policy.as_ref().is_some_and(|p|p.any_term(&|term|matches!(term,snapback4_core::schema::RuleTerm::Field(c)|snapback4_core::schema::RuleTerm::OldField(c)|snapback4_core::schema::RuleTerm::NextField(c) if c==column))){return None;}
    let mut dependencies = inv
        .policy
        .as_ref()
        .map(security::kernel::dependencies)
        .unwrap_or_default();
    dependencies.insert(inv.table.clone());
    if bound
        .programs
        .iter()
        .find(|p| p.program.name == c.operation)
        .is_some_and(|p| {
            snapback4_core::ir::write_tables(&p.program)
                .iter()
                .any(|(table, _)| table != &inv.table && dependencies.contains(table))
        })
    {
        return None;
    }
    let id = c.old.as_ref()?.field("id").ok()?.clone();
    let mut rows = c
        .supporting_rows
        .iter()
        .filter(|(table, _)| dependencies.contains(*table))
        .flat_map(|(table, rows)| rows.iter().map(move |row| (table.clone(), row.clone())))
        .filter(|(table, row)| table != &inv.table || row.field("id").ok() != Some(&id))
        .collect::<Vec<_>>();
    rows.push((inv.table.clone(), c.row.clone()));
    let initial = rows.clone();
    engine.seed_at(rows, challenges::NOW).ok()?;
    let mut high = actual_args(c).clone();
    high.insert(column.clone(), Value::Int(54321));
    let first = engine
        .mutate(
            &c.operation,
            None,
            Context::new(&c.viewer, high.clone()).at(challenges::NOW),
        )
        .ok()?;
    if serde_json::to_value(&first).ok()?["state"] != "sent" {
        return None;
    }
    let old = engine
        .store()
        .rows(&inv.table)
        .ok()?
        .into_iter()
        .find(|r| r.field("id").ok() == Some(&id))?;
    let mut low = actual_args(c).clone();
    low.insert(column.clone(), Value::Int(0));
    let second = engine
        .mutate(
            &c.operation,
            None,
            Context::new(&c.viewer, low.clone()).at(challenges::NOW),
        )
        .ok()?;
    if serde_json::to_value(&second).ok()?["state"] != "sent" {
        return None;
    }
    let row = engine
        .store()
        .rows(&inv.table)
        .ok()?
        .into_iter()
        .find(|r| r.field("id").ok() == Some(&id))?;
    if !matches!((old.field(column).ok()?,row.field(column).ok()?),(Value::Int(a),Value::Int(b)) if a>b)
    {
        return None;
    }
    let mut next = c.clone();
    next.args = low.clone();
    next.old = Some(old);
    next.row = row;
    next.history.clear();
    next.supporting_rows.clear();
    for (table, row) in initial {
        next.supporting_rows.entry(table).or_default().push(row);
    }
    next.scope="two actual operations on the reconstructed generated fixture after an observed update; fixture initialization is not claimed reachable from an empty application".into();
    if let Some(step) = c.history.last() {
        let mut first_step = step.clone();
        first_step.operation = c.operation.clone();
        first_step.viewer = c.viewer.clone();
        first_step.args = high;
        first_step.result = serde_json::to_value(first).ok()?;
        next.history.push(first_step);
        let mut second_step = step.clone();
        second_step.operation = c.operation.clone();
        second_step.viewer = c.viewer.clone();
        second_step.args = low;
        second_step.result = serde_json::to_value(second).ok()?;
        next.history.push(second_step);
    }
    Some(next)
}
/// Fixed work cap; generated cache never clears a gate or supplies authority.
pub(in crate::verbs) fn collect(
    project: &Project,
    bound: &Bound,
    sources: &[(String, String)],
    notes: &[Diagnostic],
    expanded: bool,
) -> Vec<Option<serde_json::Value>> {
    let key = hash(
        &serde_json::to_vec(&(
            "dx11-witness-5",
            sources,
            notes,
            record::capture(sources, None).ok(),
        ))
        .unwrap(),
    );
    let path = project
        .schema_dir()
        .join("generated/security-witnesses.json");
    if let Some(cached) = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
    {
        if cached["key"] == key {
            if let Ok(values) = serde_json::from_value(cached["values"].clone()) {
                return values;
            }
        }
    }
    if !expanded {
        return vec![None; notes.len()];
    }
    let selected = candidates(bound, sources, notes);
    let mut result = vec![None; notes.len()];
    if !selected.is_empty() {
        let mut questions = bound.clone();
        questions.invariants = selected.iter().map(|(_, i)| i.clone()).collect();
        let mut campaign = challenges::Campaign {
            work_remaining: Some(8192),
            ..Default::default()
        };
        challenges::generated_campaign(&questions, &mut campaign, false);
        for (index, inv) in &selected {
            if result[*index].is_some() {
                continue;
            }
            if let Some(c)=campaign.violations.iter().filter(|c|c.invariant_site==inv.site.to_string()&&c.reachability.is_reachable()).max_by_key(|c| {
                let decrease=inv.column.as_ref().and_then(|column|Some((c.old.as_ref()?.field(column).ok()?,c.row.field(column).ok()?))).is_some_and(|(old,next)|matches!((old,next),(snapback4_core::Value::Int(a),snapback4_core::Value::Int(b)) if a>b));
                (decrease,c.history.len())
            }) {let replay=decreasing_edit(bound,inv,c);result[*index]=Some(evidence(bound,inv,replay.as_ref().unwrap_or(c)));}
        }
    }
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    if std::fs::write(
        &temporary,
        serde_json::to_vec(&json!({"key":key,"values":result})).unwrap(),
    )
    .is_ok()
    {
        let _ = std::fs::rename(&temporary, &path);
    }
    let _ = std::fs::remove_file(temporary);
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opaque_argument_image_payloads_are_redacted() {
        let secret = snapback4_core::Value::String("not-a-real-credential-sentinel".into());
        for kind in [
            None,
            Some(ColumnType::Text { max: 100 }),
            Some(ColumnType::Json { max_bytes: 100 }),
        ] {
            assert!(
                !safe(&secret, kind.as_ref())
                    .to_string()
                    .contains("credential-sentinel")
            );
        }
        assert_eq!(
            safe(&snapback4_core::Value::Int(42), None),
            json!({"Int":42})
        );
    }
}
