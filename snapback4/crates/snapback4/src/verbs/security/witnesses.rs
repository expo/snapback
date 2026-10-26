//! Concrete question evidence: hypotheses remain separate from authored intent.
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
        _ => snapback4_core::wire::to_json(value),
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
// Retain the actual trace's transitive data/authority graph, not unrelated
// fixture populations. Helpers are expanded in the bound IR read/write sites.
// @ref LLP 3000.036.004.000#13-witness-backed-enforcement-and-shipping-precision — unrelated tables cannot invalidate a witnessed decision.
fn dependencies(sources:&[(String,String)],bound:&Bound,inv:&security::Invariant,c:&Counterexample)->std::collections::BTreeSet<String>{
    use snapback4_core::ir;
    let mut tables=security::derived::witness_dependencies(sources,bound,inv);
    fn named(value:&serde_json::Value,bound:&Bound,out:&mut std::collections::BTreeSet<String>){match value{
        serde_json::Value::Object(fields)=>for (key,value) in fields{
            if matches!(key.as_str(),"table"|"source"|"target"|"parent")&&let Some(name)=value.as_str().filter(|name|bound.schema.tables.contains_key(*name)){out.insert(name.into());}
            named(value,bound,out);
        },serde_json::Value::Array(values)=>for value in values{named(value,bound,out)},_=>{}
    }}
    for operation in std::iter::once(c.operation.as_str()).chain(c.history.iter().map(|step|step.operation.as_str())){
        let Some(program)=bound.programs.iter().find(|p|p.program.name==operation)else{return bound.schema.tables.keys().cloned().collect();};
        if program.program.native{return bound.schema.tables.keys().cloned().collect();}
        tables.extend(ir::read_sites(&program.program).into_iter().map(|site|site.table));
        tables.extend(ir::write_tables(&program.program).into_iter().map(|(table,_)|table));
        named(&serde_json::to_value(&program.program.args).unwrap(),bound,&mut tables);
    }
    loop{
        let before=tables.len();for table in tables.clone(){if let Some(definition)=bound.schema.tables.get(&table){named(&serde_json::to_value(definition).unwrap(),bound,&mut tables);}}
        for maintain in &bound.schema.maintains{if tables.contains(&maintain.source)||tables.contains(&maintain.target){tables.insert(maintain.source.clone());tables.insert(maintain.target.clone());}}
        if tables.len()==before{break;}
    }tables
}
pub(in crate::verbs) fn evidence(sources:&[(String,String)],bound: &Bound, inv: &security::Invariant, c: &Counterexample) -> serde_json::Value {
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
    let dependencies=dependencies(sources,bound,inv,c);
    let committed=c.history.last().and_then(|step|step.result.get("committedRows")).and_then(|value|serde_json::from_value::<BTreeMap<String,Vec<snapback4_core::Value>>>(value.clone()).ok());
    let supporting = c
        .supporting_rows
        .iter()
        .filter(|(table,_)|dependencies.contains(*table))
        .map(|(table, rows)| {
            (
                table,
                rows.iter()
                    .map(|r| image(bound, table, r))
                    .collect::<Vec<_>>(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut generated_ids=std::collections::BTreeSet::new();
    let mut add_id=|value:&snapback4_core::Value|{if let snapback4_core::Value::Id(value)=value&&value.len()==26&&value.bytes().all(|b|b"0123456789ABCDEFGHJKMNPQRSTVWXYZ".contains(&b)){generated_ids.insert(value.clone());}};
    let row_ids=|table:&str,row:&snapback4_core::Value,add:&mut dyn FnMut(&snapback4_core::Value)|{if let snapback4_core::Value::Row(fields)=row{for (column,value) in fields.iter(){if column=="id"||bound.schema.table(table).and_then(|t|t.columns.get(column)).is_some_and(|k|matches!(k.required(),ColumnType::Id|ColumnType::Ref{..}|ColumnType::Principal)){add(value);}}}};
    row_ids(&inv.table,&c.row,&mut add_id);if let Some(old)=&c.old{row_ids(&inv.table,old,&mut add_id);}
    for (table,rows) in &c.supporting_rows{if dependencies.contains(table){for row in rows{row_ids(table,row,&mut add_id);}}}
    if let Some(rows)=&committed{for (table,rows) in rows{if dependencies.contains(table){for row in rows{row_ids(table,row,&mut add_id);}}}}
    for value in actual_args(c).values(){add_id(value);}for step in &c.history{for value in step.args.values(){add_id(value);}}
    let mut value=json!({"generatedIds":generated_ids,"history":history,"supportingRows":supporting,"summary":summary,"candidate":format!("invariant {} only {}",inv.target_label(),inv.predicate),"operation":c.operation,"viewer":c.viewer,"args":args,"effect":c.effect,"old":old,"row":next,"reachability":c.reachability,"scope":c.scope});
    if let Some(rows)=committed{value["committedRows"]=json!(rows.iter().filter(|(table,_)|dependencies.contains(*table)).map(|(table,rows)|(table,rows.iter().map(|row|image(bound,table,row)).collect::<Vec<_>>())).collect::<BTreeMap<_,_>>());}
    super::super::security_reviews::witness::stamp(value)
}
mod approval_applicability;
use approval_applicability::{approval_trigger,precise_approval};
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
    let stages = security::derived::workflow_columns_from_sources(sources, bound);
    let mut out = Vec::new();
    for (index, n) in notes.iter().enumerate() {
        if n.code == "N_INSERT_WRITE_INTENT" {
            if let Some(subject) = n
                .message
                .split(": ")
                .nth(1)
                .and_then(|s| s.split_whitespace().next())
            {
                // One grouped create/edit question can name several columns;
                // each shares this audience. Replay a real column, not a
                // comma-joined identifier that cannot compile as an invariant.
                let subject=subject.split(',').next().unwrap_or(subject);
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
                        &format!("invariant {subject} write only {policy}"),
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
                Some(ColumnType::Bool | ColumnType::Time)
            ) {
                continue;
            }
            let trigger=approval_trigger(bound,table,column);
            let approved=if matches!(t.columns[column].required(),ColumnType::Time){format!(".{column} != null")}else{format!(".{column}")};
            let predicate = trigger.as_ref().map(|trigger| format!("not .{trigger} or ({approved})")).unwrap_or(approved);
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
            // Prefer a workflow's actual multi-step producer to its earlier
            // quote/registration path. The witness names the executed operation.
            fn writes(value:&serde_json::Value,table:&str)->usize {
                let own=usize::from(value.get("WriteTarget").is_some_and(|w|w["target"]["table"]==table)||value.get("Update").is_some_and(|w|w["table"]==table));
                own+match value{serde_json::Value::Object(xs)=>xs.values().map(|v|writes(v,table)).sum(),serde_json::Value::Array(xs)=>xs.iter().map(|v|writes(v,table)).sum(),_=>0}
            }
            let mut programs=bound.programs.iter().rev().collect::<Vec<_>>();
            programs.sort_by_key(|p|{let value=serde_json::to_value(&p.program).unwrap();let mut fields=std::collections::BTreeSet::new();columns(&value,table,&mut fields);std::cmp::Reverse((writes(&value,table),fields.len()))});
            fn self_guard(value:&serde_json::Value,principals:&std::collections::BTreeSet<&String>)->bool {
                let Some(binary)=value.get("Binary")else{return false;};
                match binary["op"].as_str(){Some("And")=>self_guard(&binary["left"],principals)||self_guard(&binary["right"],principals),Some("Or")=>self_guard(&binary["left"],principals)&&self_guard(&binary["right"],principals),Some("Eq")=>[("left","right"),("right","left")].into_iter().any(|(field,viewer)|binary[viewer]=="Viewer"&&binary[field]["Field"]["name"].as_str().is_some_and(|name|principals.iter().any(|p|p.as_str()==name))),_=>false}
            }
            let principals=t.columns.iter().filter(|(_,kind)|matches!(kind.required(),ColumnType::Principal)).map(|(name,_)|name).collect();
            for program in programs {
                if program.program.kind != snapback4_core::ir::ProgramKind::Mutation {continue;}
                // A customer's own acceptance establishes an earlier decision;
                // it is not the subsequent staff-performed approved act.
                if serde_json::to_value(&program.program.body).unwrap().as_array().is_some_and(|body|body.iter().any(|stmt|stmt.get("Require").is_some_and(|require|self_guard(&require["condition"],&principals)))){continue;}
                let mut changed=std::collections::BTreeSet::new();
                columns(&serde_json::to_value(&program.program).unwrap(),table,&mut changed);
                if changed.contains(column)||!changed.iter().any(|column|stages.contains(&(table.into(),column.clone()))){continue;}
                if let Some(inv)=candidate(sources,&format!("invariant {table}.{} only {predicate}",program.program.name)){out.push((index,inv));}
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
/// Deployment and its prescribed acknowledgment consume the same actual
/// campaign verdict, without a different display-only counterexample chooser.
pub(in crate::verbs) fn apply_report(sources:&[(String,String)],bound:&Bound,report:&security::Report,notes:&[Diagnostic],evidence:&mut [Option<serde_json::Value>]) {
    for (index,note) in notes.iter().enumerate().filter(|(_,n)|n.code=="N_DERIVED_WRITE_AUTHORITY") {
        if let Some(verdict)=report.invariants.iter().find(|v|v.invariant.site==note.site&&v.status==security::Status::Refuted&&v.counterexample.as_ref().is_some_and(|c|c.reachability.is_reachable())) {
            let value=self::evidence(sources,bound,&verdict.invariant,verdict.counterexample.as_ref().unwrap());
            if super::super::security_reviews::witness::concrete(&value){evidence[index]=Some(value);}
        }
    }
}
/// Fixed work per mode; a generated presentation cache never supplies a gate.
// @ref LLP 3000.036.004.000#13-witness-backed-enforcement-and-shipping-precision — every gate replays current source even when advice is cached.
pub(in crate::verbs) fn collect(project:&Project,bound:&Bound,sources:&[(String,String)],notes:&[Diagnostic],expanded:bool,options:&Options)->Vec<Option<serde_json::Value>> {
    let key=hash(&serde_json::to_vec(&("sec10-witness-8",sources,notes,record::capture(sources,None).ok())).unwrap());
    let path=project.schema_dir().join("generated/security-witnesses.json");
    let gate=|index:usize|super::super::security_reviews::gated(&notes[index].code)&&precise_approval(bound,&notes[index]);
    let cached=std::fs::read(&path).ok().and_then(|b|serde_json::from_slice::<serde_json::Value>(&b).ok()).filter(|v|v["key"]==key).and_then(|v|serde_json::from_value::<Vec<Option<serde_json::Value>>>(v["values"].clone()).ok()).filter(|v|v.len()==notes.len());
    let mut result=vec![None;notes.len()];
    if let Some(cached)=&cached{for (index,value) in cached.iter().enumerate(){if !gate(index)&&notes[index].code!="N_DERIVED_WRITE_AUTHORITY"{result[index]=value.clone();}}}
    let selected=candidates(bound,sources,notes);
    for enforcement in [true,false] {
        if !enforcement&&(!expanded||cached.is_some()){continue;}
        let selected=selected.iter().filter(|(index,_)|gate(*index)==enforcement).collect::<Vec<_>>();
        if selected.is_empty(){continue;}
        let mut questions=bound.clone();questions.invariants=selected.iter().map(|(_,inv)|inv.clone()).collect();
        let mut campaign=challenges::Campaign::work_bounded(if enforcement{3072}else{8192});
        challenges::generated_campaign(&questions,&mut campaign,false);
        for (index,inv) in selected {
            if result[*index].is_some()&&notes[*index].code!="N_INSERT_WRITE_INTENT"{continue;}
            if let Some(c)=campaign.violations.iter().filter(|c|c.invariant_site==inv.site.to_string()&&c.reachability.is_reachable()).max_by_key(|c| {
                let decrease=inv.column.as_ref().and_then(|column|Some((c.old.as_ref()?.field(column).ok()?,c.row.field(column).ok()?))).is_some_and(|(old,next)|matches!((old,next),(snapback4_core::Value::Int(a),snapback4_core::Value::Int(b)) if a>b));
                (decrease,c.history.len())
            }) {let replay=decreasing_edit(bound,inv,c);let value=evidence(sources,bound,inv,replay.as_ref().unwrap_or(c));if super::super::security_reviews::witness::concrete(&value){
                let decrease=|v:&serde_json::Value|v["old"].as_object().is_some_and(|fields|fields.iter().any(|(field,old)|old.as_i64().zip(v["row"][field].as_i64()).is_some_and(|(a,b)|a>b)));
                if result[*index].is_none()||decrease(&value)&&!result[*index].as_ref().is_some_and(decrease){result[*index]=Some(value);}
            }}
        }
    }
    if expanded&&notes.iter().any(|n|n.code=="N_DERIVED_WRITE_AUTHORITY"&&!n.site.file.contains("/label-consistency/")) {
        let mut deploy=options.clone();deploy.flags.insert("security-deploy".into(),String::new());
        let report=super::report(project,bound,sources,&deploy);apply_report(sources,bound,&report,notes,&mut result);
    }
    // Reapply current eligibility even to cached advice: editable presentation
    // evidence cannot promote an unresolved approval question into a gate.
    for (index,value) in result.iter_mut().enumerate(){if !precise_approval(bound,&notes[index]){if let Some(value)=value{value["advisory"]=true.into();}}}
    if expanded {let advice=result.iter().enumerate().map(|(index,value)|if gate(index)||notes[index].code=="N_DERIVED_WRITE_AUTHORITY"{None}else{value.clone()}).collect::<Vec<_>>();
        let temporary=path.with_extension(format!("{}.tmp",std::process::id()));
        if std::fs::write(&temporary,serde_json::to_vec(&json!({"key":key,"values":advice})).unwrap()).is_ok(){let _=std::fs::rename(&temporary,&path);}let _=std::fs::remove_file(temporary);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conservation_witness_identity_keeps_the_material_charge_ledger(){
        let sources=vec![("schema.q".into(),include_str!("../../../../snapback4-lang/tests/security/wave27/020.q").into())];
        let bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let mut replay=security::derived::augmented(&sources,&bound);replay.invariants.retain(|inv|inv.site.file.contains("/participant-conservation/"));
        assert_eq!(replay.invariants.len(),1);let inv=&replay.invariants[0];
        let mut campaign=challenges::Campaign::work_bounded(3072);challenges::generated_campaign(&replay,&mut campaign,false);
        let trace=campaign.violations.iter().find(|trace|trace.invariant_site==inv.site.to_string()&&trace.reachability.is_reachable()).expect("actual committed removal without refund");
        let first=evidence(&sources,&bound,inv,trace);let mut changed=trace.clone();
        let receipt=changed.supporting_rows.get_mut("receipts").and_then(|rows|rows.iter_mut().find(|row|row.field("kind").ok()==Some(&snapback4_core::Value::String("charge".into())))).expect("charge ledger is a material initial-state input");
        if let snapback4_core::Value::Row(fields)=receipt{let amount=fields.get_mut("amount").unwrap();let snapback4_core::Value::Int(value)=amount else{panic!("typed money amount")};*value+=1;}
        let second=evidence(&sources,&bound,inv,&changed);
        assert!(first["supportingRows"]["receipts"].is_array());
        assert_ne!(first["id"],second["id"],"changing a charge changes the witness even when the participant deletion and caller are unchanged");
    }
    #[test]
    fn committed_partial_refunds_change_the_witness_and_drop_an_old_decision(){
        fn replay(source:&str)->(Vec<(String,String)>,Bound,security::Invariant,Counterexample){
            let sources=vec![("schema.q".into(),source.into())];let bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
            let mut augmented=security::derived::augmented(&sources,&bound);augmented.invariants.retain(|inv|inv.site.file.contains("/participant-conservation/"));assert_eq!(augmented.invariants.len(),1);
            let mut engine=snapback4_core::Engine::memory(augmented.schema.clone(),augmented.programs.iter().map(|p|p.program.clone())).unwrap();
            let values=[("trips",json!({"id":"trip","name":"Trip"})),("participants",json!({"id":"entry","trip":"trip","person":"dev:hiker"})),("ledger",json!({"id":"charge","trip":"trip","person":"dev:hiker","paidCents":100,"kind":"charge"}))];
            let rows=values.into_iter().map(|(table,row)|(table.into(),snapback4_core::wire::row_from_json(&augmented.schema.tables[table],&row).unwrap())).collect::<Vec<_>>();engine.seed_at(rows,challenges::NOW).unwrap();
            let mut campaign=challenges::Campaign::work_bounded(1024);challenges::fixture_observers(&augmented,&engine,&mut campaign);
            let trace=campaign.violations.into_iter().find(|c|c.operation=="remove"&&c.reachability.is_reachable()).expect("committed partial refund remains insufficient");
            (sources,bound,augmented.invariants.remove(0),trace)
        }
        let source=include_str!("../../../../snapback4-lang/tests/security/sec10-shipping/conservation.q");
        let (sources,bound,inv,trace)=replay(source);let first=evidence(&sources,&bound,&inv,&trace);
        let changed_source=source.replace("paidCents:1,kind:'refund'","paidCents:2,kind:'refund'");
        let (changed,next_bound,next_inv,next_trace)=replay(&changed_source);let second=evidence(&changed,&next_bound,&next_inv,&next_trace);
        assert_eq!(first["old"],second["old"]);assert_eq!(first["row"],second["row"]);assert_eq!(first["history"],second["history"]);
        assert_ne!(first["committedRows"]["ledger"],second["committedRows"]["ledger"]);assert_ne!(first["id"],second["id"]);
        struct Scratch(std::path::PathBuf);impl Drop for Scratch{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
        let root=Scratch(std::env::temp_dir().join(format!("sb4-sec10-committed-decision-{}",std::process::id())));std::fs::create_dir_all(root.0.join("snapback")).unwrap();let project=Project{root:root.0.clone()};std::fs::write(project.schema_dir().join("schema.q"),source).unwrap();
        let note=Diagnostic::new(&inv.site,"N_DERIVED_WRITE_AUTHORITY","participants: committed conservation","refund before removal");let notes=[note];let evidence1=[Some(first.clone())];
        let initial=crate::verbs::security_reviews::review_evidence(&project,&sources,&notes,None,&evidence1).unwrap();
        let reason=format!("witness {}; permit remove as {}; intended effect: this test specification deliberately permits this partial refund",first["id"].as_str().unwrap(),first["viewer"].as_str().unwrap());
        crate::verbs::security_reviews::review_evidence(&project,&sources,&notes,Some((&initial[0].id,&reason)),&evidence1).unwrap();
        std::fs::write(project.schema_dir().join("schema.q"),changed_source).unwrap();let next=crate::verbs::security_reviews::review_evidence(&project,&changed,&notes,None,&[Some(second)]).unwrap();
        assert_ne!(initial[0].id,next[0].id);assert!(!next[0].acknowledged);assert!(next[0].reason.is_none());
    }
    #[test]
    fn applicability_requires_a_positive_flag_on_the_same_approved_resource(){
        let source=include_str!("../../../../snapback4-lang/tests/security/sec10-shipping/w30-033.q");
        let bound=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
        let actual=approval_trigger(&bound,"jobs","dampApproved");
        assert_eq!(actual,Some("dampSigned".into()),"{}",serde_json::to_string_pretty(&bound.programs.iter().find(|p|p.program.name=="approveDamp").unwrap().program).unwrap());
        let negative=source.replace("require j.dampSigned = true","require j.dampSigned = false");let bound=snapback4_lang::compile(&[("schema.q".into(),negative)]);assert!(bound.diagnostics.is_empty());assert_eq!(approval_trigger(&bound,"jobs","dampApproved"),None);
        let two=source.replace("mutation approveDamp(job: jobs,", "mutation approveDamp(job: jobs, otherJob: jobs,");let bound=snapback4_lang::compile(&[("schema.q".into(),two)]);assert!(bound.diagnostics.is_empty());assert_eq!(approval_trigger(&bound,"jobs","dampApproved"),None);
    }
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
            json!(42)
        );
    }
}
