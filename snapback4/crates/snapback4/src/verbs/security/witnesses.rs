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
        // Absence is the material fact in presence questions, not an opaque
        // payload. Preserve it for optional text/assets while redacting bytes.
        (Value::Null, _) => serde_json::Value::Null,
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
// Preserve delivered field sets and typed row values separately from the
// physical policy image. Opaque JSON/text/assets never expose their payload.
// @ref LLP 3000.036.004.001#read-payloads — a changed disclosure renews the witness decision.
fn observed_data(bound:&Bound,ty:&snapback4_lang::types::Ty,value:&snapback4_core::Value)->serde_json::Value {
    use snapback4_lang::types::Ty;
    use snapback4_core::Value;
    if *value==Value::Null{return serde_json::Value::Null;}
    match ty {
        Ty::Row(table)|Ty::WriteRow(table)=>image(bound,table,value),
        Ty::Page(table,_)=>if let Value::Array(rows)=value{json!(rows.iter().map(|r|image(bound,table,r)).collect::<Vec<_>>())}else{json!("<redacted>")},
        Ty::Optional(inner)|Ty::Omittable(inner)=>observed_data(bound,inner,value),
        Ty::List(inner,_)|Ty::Collection(inner,_)=>if let Value::Array(values)=value{json!(values.iter().map(|v|observed_data(bound,inner,v)).collect::<Vec<_>>())}else{json!("<redacted>")},
        Ty::Object(fields)|Ty::RowShape(fields)|Ty::RowObject(fields)=>json!(fields.iter().filter_map(|(name,ty)|value.field(name).ok().map(|v|(name,observed_data(bound,ty,v)))).collect::<BTreeMap<_,_>>()),
        Ty::Id|Ty::Principal|Ty::Ref(_) if matches!(value,Value::Id(_))=>snapback4_core::wire::to_json(value),
        Ty::Enum(variants) if matches!(value,Value::String(s) if variants.contains(s))=>snapback4_core::wire::to_json(value),
        Ty::Json|Ty::Text(_)|Ty::Bytes|Ty::Image|Ty::Video|Ty::File|Ty::Cursor|Ty::Unknown=>json!("<redacted>"),
        _=>safe(value,None),
    }
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
    let observation=c.history.last().filter(|step|step.result["state"]=="observed").and_then(|step|{
        let data=step.observed_data.as_ref()?.clone();
        let result=&bound.programs.iter().find(|p|p.program.name==c.operation)?.result;
        let visible=observed_data(bound,result,&data);
        Some((data,visible,step.result["complete"].clone()))
    });
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
    // @ref LLP 3000.037.000#1-default-verdict — compact exact fields retain the full replay in JSON.
    // The default verdict shows the candidate's exact fields; full images and
    // replay history remain in JSON and the expanded review summary.
    let mut fields=std::collections::BTreeSet::new();
    if let Some(column)=&inv.column {fields.insert(column.clone());}
    let selected=std::cell::RefCell::new(fields);
    if let Some(policy)=&inv.policy {policy.any_term(&|term| {
        if let snapback4_core::schema::RuleTerm::Field(column)|snapback4_core::schema::RuleTerm::OldField(column)|snapback4_core::schema::RuleTerm::NextField(column)=term {selected.borrow_mut().insert(column.clone());}
        false
    });}
    let focused=|row:&serde_json::Value| row.as_object().map(|row|row.iter().filter(|(key,_)|selected.borrow().contains(*key)).map(|(k,v)|(k.clone(),v.clone())).collect::<serde_json::Map<_,_>>()).map(serde_json::Value::Object).unwrap_or(serde_json::Value::Null);
    let compact_summary=format!("{} as {} → ok; {} {} -> {} (bounded replay; not proof)",c.operation,c.viewer,inv.target_label(),old.as_ref().map(|row|focused(row).to_string()).unwrap_or_else(||"absent".into()),focused(&next));
    let history=c.history.iter().map(|step|json!({"operation":step.operation,"viewer":step.viewer,"args":step.args.iter().map(|(k,v)|(k,safe(v,None))).collect::<BTreeMap<_,_>>(),"state":step.result["state"],"clock":step.clock.unwrap_or(challenges::NOW)})).collect::<Vec<_>>();
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
    fn observation_ids(value:&snapback4_core::Value,add:&mut dyn FnMut(&snapback4_core::Value)) {
        use snapback4_core::Value;
        match value{Value::Id(_)=>add(value),Value::Row(fields)=>for v in fields.values(){observation_ids(v,add)},Value::Map(fields)=>for v in fields.values(){observation_ids(v,add)},Value::Array(values)=>for v in values{observation_ids(v,add)},_=>{}}
    }
    if let Some((data,visible,_))=&observation{
        fn strings(value:&serde_json::Value,out:&mut std::collections::BTreeSet<String>){match value{
            serde_json::Value::String(s)=>{out.insert(s.clone());},serde_json::Value::Object(fields)=>for v in fields.values(){strings(v,out)},serde_json::Value::Array(values)=>for v in values{strings(v,out)},_=>{}
        }}
        let mut shown=std::collections::BTreeSet::new();strings(visible,&mut shown);
        observation_ids(data,&mut |v|if let snapback4_core::Value::Id(id)=v&&shown.contains(id){add_id(v)});
    }
    let mut value=json!({"compactSummary":compact_summary,"generatedIds":generated_ids,"history":history,"supportingRows":supporting,"summary":summary,"candidate":format!("invariant {} only {}",inv.target_label(),inv.predicate),"operation":c.operation,"viewer":c.viewer,"args":args,"effect":c.effect,"old":old,"row":next,"reachability":c.reachability,"scope":c.scope});
    if let Some((_,data,complete))=observation {
        value["kind"]="read-payload".into();
        value["observation"]=json!({"data":data,"complete":complete});
        value["summary"]=format!("{}({}) as {} → disclosed {}; policy image {}; observed result {}; candidate invariant {} only {} (repeatable typed payload on a finite generated-fixture replay, not proof)",c.operation,serde_json::to_string(&args).unwrap(),c.viewer,inv.target_label(),next,data,inv.target_label(),inv.predicate).into();
        value["compactSummary"]=format!("{} as {} → disclosed {}; policy fields {} (bounded replay; not proof)",c.operation,c.viewer,inv.target_label(),focused(&next)).into();
    }
    if let Some(rows)=committed{value["committedRows"]=json!(rows.iter().filter(|(table,_)|dependencies.contains(*table)).map(|(table,rows)|(table,rows.iter().map(|row|image(bound,table,row)).collect::<Vec<_>>())).collect::<BTreeMap<_,_>>());}
    super::super::security_reviews::witness::stamp(value)
}
mod approval_applicability;
mod questions;
mod candidate_batch;
use candidate_batch::Candidate;
mod answers;
use approval_applicability::{approval_trigger,precise_approval};
pub(super) fn candidate(sources: &[(String, String)], line: &str) -> Option<security::Invariant> {
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
    let approval_questions=security::derived::approval_questions(sources,bound).into_iter().chain(security::derived::assignment_questions(sources,bound)).chain(security::derived::transition_questions(sources,bound)).collect::<Vec<_>>();
    let times=security::time_anchors::candidates(sources,bound);
    for (index, n) in notes.iter().enumerate() {
        for q in times.iter().filter(|q|q.note==*n) {
            out.push((index,Candidate::Time(q.invariant.clone(),q.column.clone(),n.code=="N_MOVABLE_TIME_ANCHOR")));
        }
        out.extend(questions::proposals(bound,index,n));
        out.extend(approval_questions.iter().filter(|(note,_)|note.site==n.site&&note.code==n.code).map(|(_,inv)|(index,Candidate::Bound(inv.clone()))));
        if n.code=="N_RELEASE_CREATE_AUTHORITY"{if let Some(inv)=super::release_create::candidate(sources,n){out.push((index,Candidate::Bound(inv)));}}
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
                        out.push((index, Candidate::Bound(inv.clone())));
                    }
                }
                if let Some(policy) = n
                    .message
                    .split("without the edit restriction of ")
                    .nth(1)
                    .and_then(|s| s.split_once(": ").map(|(_, p)| p))
                    .and_then(|s| s.split("; creation admission:").next())
                {
                    out.push((index, Candidate::Source(format!("invariant {subject} write only {policy}"), false)));
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
                                out.push((index, Candidate::Source(format!(
                                    "invariant {table} always exists {roles}[{principal} = .{column}, {role} = '{column}']"
                                ), false)));
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
                out.push((index,Candidate::Source(format!("invariant {table}.{} only {predicate}",program.program.name),false)));
            }
        }
    }
    candidate_batch::resolve(sources, out)
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
pub(in crate::verbs) fn apply_report(project:&Project,options:&Options,sources:&[(String,String)],bound:&Bound,report:&security::Report,notes:&[Diagnostic],evidence:&mut [Option<serde_json::Value>]) {
    for (index,note) in notes.iter().enumerate().filter(|(_,n)|n.code=="N_DERIVED_WRITE_AUTHORITY") {
        if let Some(verdict)=report.invariants.iter().find(|v|v.invariant.site==note.site&&v.status==security::Status::Refuted&&v.counterexample.as_ref().is_some_and(|c|c.reachability.is_reachable())) {
            let mut value=self::evidence(sources,bound,&verdict.invariant,verdict.counterexample.as_ref().unwrap());
            answers::attach(sources,bound,&verdict.invariant,verdict.counterexample.as_ref().unwrap(),&answers::lines(project,options),&mut value);
            if super::super::security_reviews::witness::concrete(&value){evidence[index]=Some(value);}
        }
    }
}
/// Fixed work per mode; a generated presentation cache never supplies a gate.
// @ref LLP 3000.036.004.000#13-witness-backed-enforcement-and-shipping-precision — every gate replays current source even when advice is cached.
pub(in crate::verbs) fn collect(project:&Project,bound:&Bound,sources:&[(String,String)],notes:&[Diagnostic],expanded:bool,options:&Options)->Vec<Option<serde_json::Value>> {
    collect_with_report(project,bound,sources,notes,expanded,options,None)
}
pub(in crate::verbs) fn collect_with_report(project:&Project,bound:&Bound,sources:&[(String,String)],notes:&[Diagnostic],expanded:bool,options:&Options,current:Option<&security::Report>)->Vec<Option<serde_json::Value>> {
    collect_inner(project,bound,sources,notes,expanded,options,current,false,true)
}
/// Independent restoration has its own work and reads no ordinary advice cache.
// @ref LLP 3000.036.004.000.000#parallel-question-restoration — join before the original ordered reduction and current-source guards.
pub(in crate::verbs) fn collect_and_restore(project:&Project,bound:&Bound,sources:&[(String,String)],report:&mut security::Report,options:&Options,prefix:&str)->Vec<Option<serde_json::Value>> {
    let original=&*report;
    let (mut evidence,(notes,values))=std::thread::scope(|scope|{
        let restoration=scope.spawn(||phase::measure(&format!("{prefix}.restored_questions"),||{
            let mut copy=original.clone();let count=copy.notes.len();let mut values=vec![None;count];
            restore_questions(project,bound,sources,&mut copy,&mut values,options);
            (copy.notes.split_off(count),values.split_off(count))
        }));
        let evidence=phase::measure(&format!("{prefix}.witnesses"),||collect(project,bound,sources,&original.notes,true,options));
        (evidence,restoration.join().expect("restoration campaign panicked"))
    });
    report.notes.extend(notes);evidence.extend(values);evidence
}
/// Only the exact joined note vector may consume this independent replay.
// @ref LLP 3000.036.004.000.000#parallel-question-restoration — speculative work supplies no verdict until the current report matches.
pub(in crate::verbs) struct PendingRestoration {
    original:Vec<Diagnostic>, notes:Vec<Diagnostic>, values:Vec<Option<serde_json::Value>>,
}
impl PendingRestoration {
    pub(in crate::verbs) fn finish(self,report:&mut security::Report,evidence:&mut Vec<Option<serde_json::Value>>)->bool {
        if self.original!=report.notes{return false;}
        report.notes.extend(self.notes);evidence.extend(self.values);true
    }
}
pub(in crate::verbs) fn restoration(project:&Project,bound:&Bound,sources:&[(String,String)],notes:&[Diagnostic],options:&Options)->PendingRestoration {
    let basis=security::question_basis(sources,bound).into_iter().filter(|note|!notes.iter().any(|n|n.code==note.code&&n.site==note.site)).collect::<Vec<_>>();
    debug_assert!(basis.iter().all(|n|!super::super::security_reviews::gated(&n.code)));
    let current=if basis.is_empty(){Vec::new()}else{collect_inner(project,bound,sources,&basis,true,options,None,false,false)};
    let (restored,values)=basis.into_iter().zip(current).filter(|(_,value)|value.as_ref().is_some_and(super::super::security_reviews::witness::concrete)).unzip();
    PendingRestoration{original:notes.to_vec(),notes:restored,values}
}
/// Questions cannot supply derived enforcement until the current report joins.
pub(in crate::verbs) struct PendingEvidence<'a>{bound:&'a Bound,sources:&'a[(String,String)],notes:&'a[Diagnostic],values:Vec<Option<serde_json::Value>>}
impl PendingEvidence<'_>{
    pub(in crate::verbs) fn finish(mut self,project:&Project,options:&Options,report:&security::Report)->Option<Vec<Option<serde_json::Value>>>{
        if self.notes!=report.notes.as_slice(){return None;}
        apply_report(project,options,self.sources,self.bound,report,&report.notes,&mut self.values);Some(self.values)
    }
}
pub(in crate::verbs) fn collect_for_report<'a>(project:&Project,bound:&'a Bound,sources:&'a[(String,String)],notes:&'a[Diagnostic],options:&Options)->PendingEvidence<'a>{
    PendingEvidence{bound,sources,notes,values:collect_inner(project,bound,sources,notes,true,options,None,true,true)}
}
fn collect_inner(project:&Project,bound:&Bound,sources:&[(String,String)],notes:&[Diagnostic],expanded:bool,options:&Options,current:Option<&security::Report>,defer_derived:bool,advice_cache:bool)->Vec<Option<serde_json::Value>> {
    let key=hash(&serde_json::to_vec(&("integration29-witness-1",sources,notes,record::capture(sources,None).ok())).unwrap());
    let path=project.schema_dir().join("generated/security-witnesses.json");
    let gate=|index:usize|super::super::security_reviews::gated(&notes[index].code)&&precise_approval(bound,&notes[index]);
    let cached=advice_cache.then(||std::fs::read(&path).ok()).flatten().and_then(|b|serde_json::from_slice::<serde_json::Value>(&b).ok()).filter(|v|v["key"]==key).and_then(|v|serde_json::from_value::<Vec<Option<serde_json::Value>>>(v["values"].clone()).ok()).filter(|v|v.len()==notes.len());
    let mut result=vec![None;notes.len()];
    if let Some(cached)=&cached{for (index,value) in cached.iter().enumerate(){if !gate(index)&&notes[index].code!="N_DERIVED_WRITE_AUTHORITY"{result[index]=value.clone();}}}
    let selected=phase::measure("witness.candidates", || candidates(bound,sources,notes));
    let times=security::time_anchors::candidates(sources,bound);
    let answer_lines=answers::lines(project,options);
    let prior_policies=notes.iter().enumerate().filter(|(_,n)|n.code=="N_RELEASE_CREATE_AUTHORITY").filter_map(|(index,n)|super::release_create::prior_policy(sources,n).and_then(|inv|inv.policy).map(|p|(index,p))).collect::<BTreeMap<_,_>>();
    let stages=phase::measure("witness.stages", || security::derived::workflow_columns_from_sources(sources,bound));
    // @ref LLP 3000.036.004.000.000#independent-campaigns — independent searches join before ordered witness selection.
    // Each campaign already has its own replay-ID scope and fixed work budget.
    // Run independent searches concurrently, then reduce in the original order.
    let need_derived=expanded&&notes.iter().any(|n|n.code=="N_DERIVED_WRITE_AUTHORITY"&&!n.site.file.contains("/label-consistency/"));
    let (campaigns,derived_report)=std::thread::scope(|scope|{
        let derived=if need_derived&&current.is_none()&&!defer_derived{Some(scope.spawn(||{
            let mut deploy=options.clone();deploy.flags.insert("security-deploy".into(),String::new());
            phase::measure("witness.derived_report", || super::report(project,bound,sources,&deploy))
        }))}else{None};
        let mut handles=Vec::new();
        for enforcement in [true,false] {
            if !enforcement&&(!expanded||cached.is_some()){continue;}
            let selection=selected.iter().filter(|(index,_)|gate(*index)==enforcement).collect::<Vec<_>>();
            if selection.is_empty(){continue;}
            let times=&times;
            handles.push(scope.spawn(move||{
                let mut questions=bound.clone();questions.invariants=selection.iter().map(|(_,inv)|inv.clone()).collect();
                let mut campaign=challenges::Campaign::work_bounded(if enforcement{3072}else{8192});
                if !enforcement{security::time_anchors::configure_campaign(&questions,times,&mut campaign);}
                phase::measure(if enforcement {"witness.gate_campaign"} else {"witness.question_campaign"}, || challenges::generated_campaign(&questions,&mut campaign,false));
                (selection,campaign)
            }));
        }
        (handles.into_iter().map(|h|h.join().expect("question campaign panicked")).collect::<Vec<_>>(),derived.map(|h|h.join().expect("derived campaign panicked")))
    });
    for (selected,campaign) in campaigns {
        for (index,inv) in selected {
            if result[*index].is_some()&&notes[*index].code!="N_INSERT_WRITE_INTENT"{continue;}
            if let Some(c)=campaign.violations.iter().filter(|c|c.invariant_site==inv.site.to_string()&&c.reachability.is_reachable()&&times.iter().find(|q|q.note==notes[*index]).is_none_or(|q|notes[*index].code!="N_MOVABLE_TIME_ANCHOR"||c.effect=="update"&&c.old.as_ref().and_then(|r|r.field(&q.column).ok()).zip(c.row.field(&q.column).ok()).is_some_and(|(old,next)|matches!((old,next),(snapback4_core::Value::Int(a),snapback4_core::Value::Int(b)) if a!=b)))&&(notes[*index].code!="N_RELEASE_CREATE_AUTHORITY"||c.effect=="insert"&&c.old.is_none()&&challenges::release_witness::retained_value(inv,c)&&inv.operation.as_ref()==Some(&c.operation)&&prior_policies.get(index).is_some_and(|policy|challenges::release_witness::prior_allowed(bound,policy,c)==Some(true)))&&(notes[*index].code!="N_GUARD_NOT_CONSUMED"||c.history.len()==1&&c.effect=="insert")&&(notes[*index].code!="N_ASSIGNMENT_SCOPE"||c.history.len()==1&&c.history.last().is_some_and(|s|s.observed_data.is_some()))&&(notes[*index].code!="N_CHILD_EVIDENCE_PRESENCE"||notes[*index].message.contains(": creations ")||questions::transition(inv,c,&stages))).max_by_key(|c| {
                let decrease=inv.column.as_ref().and_then(|column|Some((c.old.as_ref()?.field(column).ok()?,c.row.field(column).ok()?))).is_some_and(|(old,next)|matches!((old,next),(snapback4_core::Value::Int(a),snapback4_core::Value::Int(b)) if a>b));
                (decrease,if notes[*index].code=="N_ASSIGNMENT_SCOPE"||inv.site.file.contains("/sec11-transition/"){std::cmp::Reverse(c.viewer.clone())}else{std::cmp::Reverse(String::new())},if inv.site.file.contains("/sec11-transition/"){usize::MAX-c.history.len()}else{c.history.len()})
            }) {let replay=decreasing_edit(bound,inv,c);let mut value=evidence(sources,bound,inv,replay.as_ref().unwrap_or(c));
                if notes[*index].code=="N_GUARD_NOT_CONSUMED" {let Some(repeated)=questions::repeat(bound,inv,c,&notes[*index],sources)else{continue;};value=repeated;}
                if notes[*index].code=="N_ASSIGNMENT_SCOPE" {if value["kind"]!="read-payload"{continue;}let Some(assigned)=questions::assignment_evidence(value,&notes[*index],inv)else{continue;};value=assigned;}
                if notes[*index].code=="N_TRANSITION_BYPASS"&&inv.site.file.contains("/sec11-transition/"){let Some(transition)=questions::transition_evidence(value,&notes[*index],inv)else{continue;};value=transition;}
                if notes[*index].code=="N_TEXT_EVIDENCE" {value=questions::text_evidence(value,&notes[*index]);}
                if questions::advisory(&notes[*index].code)||matches!(notes[*index].code.as_str(),"N_MOVABLE_TIME_ANCHOR"|"N_EVENT_TIME_ANCHOR"){value["advisory"]=true.into();}
                if notes[*index].code=="N_RELEASE_CREATE_AUTHORITY"{
                    let Some((setter,argument))=super::release_create::setter(&notes[*index])else{continue;};
                    let Some(actor)=challenges::release_witness::setter_actor(bound,inv,&setter,&argument,c)else{continue;};
                    value["predecessorAudience"]=prior_policies[index].quarry().into();
                    value["setterAudience"]=serde_json::json!({"operation":setter,"viewer":actor,"qualification":"straight-line input/read/write judgment on current committed witness state"});
                }
                if matches!(notes[*index].code.as_str(),"N_OPTIONAL_EVIDENCE"|"N_CHILD_EVIDENCE_PRESENCE") {value=questions::absence_evidence(value,&notes[*index]);}
                if gate(*index){answers::attach(sources,bound,inv,replay.as_ref().unwrap_or(c),&answer_lines,&mut value);}
                value=super::super::security_reviews::witness::stamp(value);
                if super::super::security_reviews::witness::concrete(&value){
                let decrease=|v:&serde_json::Value|v["old"].as_object().is_some_and(|fields|fields.iter().any(|(field,old)|old.as_i64().zip(v["row"][field].as_i64()).is_some_and(|(a,b)|a>b)));
                if result[*index].is_none()||decrease(&value)&&!result[*index].as_ref().is_some_and(decrease){result[*index]=Some(value);}
            }}
        }
    }
    if need_derived {
        if let Some(report)=current.or(derived_report.as_ref()){apply_report(project,options,sources,bound,report,notes,&mut result);}
    }
    // Reapply current eligibility even to cached advice: editable presentation
    // evidence cannot promote an unresolved approval question into a gate.
    for (index,value) in result.iter_mut().enumerate(){if !precise_approval(bound,&notes[index]){if let Some(value)=value{value["advisory"]=true.into();}}}
    if expanded&&advice_cache {let advice=result.iter().enumerate().map(|(index,value)|if gate(index)||notes[index].code=="N_DERIVED_WRITE_AUTHORITY"{None}else{value.clone()}).collect::<Vec<_>>();
        let temporary=path.with_extension(format!("{}.tmp",std::process::id()));
        if std::fs::write(&temporary,serde_json::to_vec(&json!({"key":key,"values":advice})).unwrap()).is_ok(){let _=std::fs::rename(&temporary,&path);}let _=std::fs::remove_file(temporary);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn advisory_omission_preserves_only_current_witnessed_questions(){
        struct Scratch(std::path::PathBuf);impl Drop for Scratch{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
        let root=Scratch(std::env::temp_dir().join(format!("sb4-integration28-tier-{}",std::process::id())));
        std::fs::create_dir_all(root.0.join("snapback/generated")).unwrap();let project=Project{root:root.0.clone()};
        let options=Options{positionals:vec![],flags:BTreeMap::new(),json:true};
        let source="table parents:\n  enabled:bool default false\n  read <- allow\n  insert <- allow\n  online only\ntable children:\n  parent:parents\n  read <- allow\n  insert <- allow\n  online only\nmutation add(parent:parents):\n  p=parents[parent] ! else NO\n  require not p.enabled else CLOSED\n  return insert children {parent}\n";
        let replay=|text:&str|{
            let sources=vec![("schema.q".into(),text.into())];let bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
            let mut report=security::analyze_rules(&bound);security::add_source_notes(&mut report,&sources,&bound);
            assert!(!report.notes.iter().any(|n|n.code=="N_GUARD_NOT_CONSUMED"),"standing guards retain SECP advisory precision");
            assert!(security::question_basis(&sources,&bound).iter().any(|n|n.code=="N_GUARD_NOT_CONSUMED"),"{text}");
            let original=serde_json::to_value(&report.notes).unwrap();let count=report.notes.len();let mut evidence=vec![None;count];
            restore_questions(&project,&bound,&sources,&mut report,&mut evidence,&options);
            assert_eq!(serde_json::to_value(&report.notes[..count]).unwrap(),original,"ordinary gates and questions are untouched");
            assert_eq!(report.notes.len(),evidence.len());
            for (note,value) in report.notes[count..].iter().zip(&evidence[count..]){assert!(!super::super::super::security_reviews::gated(&note.code));assert!(value.as_ref().is_some_and(super::super::super::security_reviews::witness::concrete));}
            let once=serde_json::to_value(&report.notes).unwrap();restore_questions(&project,&bound,&sources,&mut report,&mut evidence,&options);assert_eq!(serde_json::to_value(&report.notes).unwrap(),once,"one finding has one tier");
            report.notes[count..].to_vec()
        };
        assert!(replay(source).iter().any(|n|n.code=="N_GUARD_NOT_CONSUMED"));
        let cache=project.schema_dir().join("generated/security-witnesses.json");let poison=b"{\"key\":\"not-current\",\"values\":[{\"kind\":\"fake\"}]}";std::fs::write(&cache,poison).unwrap();
        assert!(replay(&source.replace("  parent:parents\n", "  parent:parents\n  unique parent\n")).is_empty(),"no current replay means no restoration");
        assert_eq!(std::fs::read(cache).unwrap(),poison,"independent question replay never trusts or replaces advice caches");
    }
    #[test]
    fn parallel_restoration_matches_sequential_payloads_and_note_order(){
        struct Scratch(std::path::PathBuf);impl Drop for Scratch{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
        let root=Scratch(std::env::temp_dir().join(format!("sb4-lat1-restoration-{}",std::process::id())));
        std::fs::create_dir_all(root.0.join("snapback/generated")).unwrap();let project=Project{root:root.0.clone()};
        let options=Options{positionals:vec![],flags:BTreeMap::new(),json:true};
        let text="table parents:\n  enabled:bool default false\n  read <- allow\n  insert <- allow\n  online only\ntable children:\n  parent:parents\n  read <- allow\n  insert <- allow\n  online only\nmutation add(parent:parents):\n  p=parents[parent] ! else NO\n  require not p.enabled else CLOSED\n  return insert children {parent}\n";
        for unique in [false,true]{
            let text=if unique{text.replace("  parent:parents\n","  parent:parents\n  unique parent\n")}else{text.into()};
            std::fs::write(project.schema_dir().join("schema.q"),&text).unwrap();
            let sources=vec![("schema.q".into(),text)];let bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty());
            let initial=super::super::report(&project,&bound,&sources,&options);let mut sequential=initial.clone();
            let cache=project.schema_dir().join("generated/security-witnesses.json");let _=std::fs::remove_file(&cache);
            let mut old=collect(&project,&bound,&sources,&sequential.notes,true,&options);
            restore_questions(&project,&bound,&sources,&mut sequential,&mut old,&options);
            let pending=restoration(&project,&bound,&sources,&initial.notes,&options);
            let mut staged=initial.clone();let mut staged_values=collect(&project,&bound,&sources,&staged.notes,true,&options);
            assert!(pending.finish(&mut staged,&mut staged_values));
            assert_eq!(serde_json::to_vec(&(&sequential,&old)).unwrap(),serde_json::to_vec(&(&staged,&staged_values)).unwrap(),"production pending restoration retains the exact sequential suffix");
            let pending=restoration(&project,&bound,&sources,&initial.notes,&options);
            let mut changed=initial.clone();changed.notes.push(Diagnostic::new(&Default::default(),"N_ARGUMENT_GRANT","changed actual note vector","repair"));
            let mut unchanged_values=vec![None;changed.notes.len()];let before=serde_json::to_vec(&(&changed,&unchanged_values)).unwrap();
            assert!(!pending.finish(&mut changed,&mut unchanged_values));
            assert_eq!(serde_json::to_vec(&(&changed,&unchanged_values)).unwrap(),before,"a prediction mismatch supplies no note or payload authority");
            let _=std::fs::remove_file(&cache);
            let mut parallel=initial.clone();let new=collect_and_restore(&project,&bound,&sources,&mut parallel,&options,"test");
            assert_eq!(serde_json::to_vec(&(&sequential,&old)).unwrap(),serde_json::to_vec(&(&parallel,&new)).unwrap());
            let mut warm=initial;let cached=collect_and_restore(&project,&bound,&sources,&mut warm,&options,"test");
            assert_eq!(serde_json::to_vec(&(&parallel,&new)).unwrap(),serde_json::to_vec(&(&warm,&cached)).unwrap());
        }
    }
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
        for kind in [ColumnType::Text{max:100},ColumnType::Image{max:1000,once:false}] {
            assert!(safe(&snapback4_core::Value::Null,Some(&kind)).is_null());
            assert_eq!(safe(&secret,Some(&kind)),json!("<redacted>"));
        }
        let bound=snapback4_lang::compile(&[("schema.q".into(),"query q():\n  return true\n".into())]);
        let opaque=snapback4_lang::types::Ty::Json;
        assert_eq!(observed_data(&bound,&opaque,&snapback4_core::Value::Int(987654321)),json!("<redacted>"));
        let object=snapback4_lang::types::Ty::Object(BTreeMap::from([("opaque".into(),opaque)]));
        let value=snapback4_core::Value::Row(BTreeMap::from([("opaque".into(),snapback4_core::Value::Int(987654321))]).into());
        assert_eq!(observed_data(&bound,&object,&value),json!({"opaque":"<redacted>"}));
    }
}

/// Source-consistency facts govern advice only. Omitted hypotheses get a
/// separate current finite replay, so their work cannot displace any gate or
/// question in the ordinary collector. Generated advice caches supply no part
/// of this restoration and are not overwritten by it.
// @ref LLP 3000.036.004.005#integration-tier-boundary — retain every current witnessed question before advisory omission.
pub(in crate::verbs) fn restore_questions(project:&Project,bound:&Bound,sources:&[(String,String)],report:&mut security::Report,evidence:&mut Vec<Option<serde_json::Value>>,options:&Options){
    let pending=restoration(project,bound,sources,&report.notes,options);
    let matched=pending.finish(report,evidence);debug_assert!(matched);
}
