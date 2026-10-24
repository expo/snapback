//! Independent policy follows the complete authored current execution closure.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — no restored workflow may bypass current independent intent.
use crate::{
    ast::{self, TypeKind},
    lexer::{self, Kind},
    parser, print,
    release_bridge::Bridge,
};
use snapback4_core::ir::ArgType;
use std::collections::{BTreeMap, BTreeSet};

type Source = (String, String);

pub(super) fn prepare(target: &[Source], current: &[Source], guarded_fallback: &mut bool) -> Bridge {
    *guarded_fallback=false;
    let old = crate::compile(target);
    let next = crate::compile(current);
    if !old.diagnostics.is_empty() {
        return Bridge {
            sources: target.to_vec(),
            changes: vec![],
            diagnostics: old.diagnostics,
        };
    }
    if !next.diagnostics.is_empty() {
        return Bridge {
            sources: current.to_vec(),
            changes: vec![],
            diagnostics: next.diagnostics,
        };
    }
    if contracts(&old, &next) {
        if !destructive_delete_roots(&old,&next).is_empty(){*guarded_fallback=true;return guarded(target,current);}
        return retained(current.to_vec(), false);
    }
    match alpha(target, current) {
        Ok(Some(sources)) => {
            let bound = crate::compile(&sources);
            if !bound.diagnostics.is_empty() {
                return Bridge {
                    sources,
                    changes: vec![],
                    diagnostics: bound.diagnostics,
                };
            }
            if contracts(&old, &bound) {
                if !destructive_delete_roots(&old,&bound).is_empty(){*guarded_fallback=true;return guarded(target,current);}
                return retained(sources, true);
            }
        }
        Err(error) => {*guarded_fallback=error.unsupported;return refused(current, &error.reason)},
        Ok(None) => {}
    }
    *guarded_fallback=true;
    refused(current,"the complete current workflow does not retain every predecessor table, field, operation and accepted input")
}
fn retained(sources: Vec<Source>, alpha: bool) -> Bridge {
    Bridge {sources,diagnostics:vec![],changes:vec![format!("current independent intent: retained the complete current authored schema, defaults, programs, helpers, jobs and policy declarations{}; predecessor names and accepted inputs remain available; review current results in the old UI",if alpha {" under declared table identity renames"}else{""})]}
}
fn refused(current: &[Source], reason: &str) -> Bridge {
    let site=current.iter().find_map(|(file,text)|{
        let doc=parser::parse_document(file,text).0;
        doc.programs.first().map(|p|p.site.clone()).or_else(||doc.tables.first().map(|t|t.site.clone()))
    }).unwrap_or_else(||crate::Site::new("schema.q",1,1));
    Bridge {sources:current.to_vec(),changes:vec![],diagnostics:vec![crate::diag::type_error(&site,format!("rollback view cannot preserve current independent intent: {reason}"),"author a compatible guarded source retaining the predecessor fields and inputs, truthful migrations and the current policy; an acknowledgment does not authorize restoring an unsafe workflow").guide("deploy")]}
}

/// A loosened current workflow may omit a predecessor's nullable, default-free
/// field rather than invent its value. All current schema and executable
/// declarations stay intact; old wire aliases are the only source additions.
pub(super) fn guarded(target:&[Source],current:&[Source])->Bridge {
    let normalized=match alpha(target,current) {
        Ok(sources)=>sources,
        Err(error)=>return refused(current,&error.reason),
    };
    let current=normalized.as_deref().unwrap_or(current);
    let old=crate::compile(target);let next=crate::compile(current);
    if !old.diagnostics.is_empty()||!next.diagnostics.is_empty(){return refused(current,"both authored sources must compile before preparing a guarded view");}
    if !table_contracts(&old,&next,true){
        let missing=old.schema.tables.iter().flat_map(|(table,t)|{let old=&old;let next=&next;t.columns.iter().filter_map(move |(column,kind)|{
            let absent=next.schema.table(table).is_none_or(|n|!n.columns.contains_key(column));
            (absent&&renamed_column(&old,&next,table,column).is_none()&&(!kind.is_optional()||t.defaults.contains_key(column))).then(||format!("{table}.{column}"))
        })}).collect::<Vec<_>>();
        return refused(current,&format!("guarded view needs a truthful reverse projection for required/defaulted columns [{}]; retain these fields in an authored bridge",missing.join(", ")));
    }
    let mut sources=current.to_vec();let mut changes=vec!["guarded loosened view: retained the complete current schema, defaults, helpers, programs, jobs, aliases and independent intent; omitted nullable default-free predecessor fields are absent results, never invented values; review current results in the old UI".into()];
    if normalized.is_some(){changes.push("declared table identities: complete current guarded workflow retained under predecessor spellings, without rewriting business strings or weakening authority".into());}
    for(file,text)in &mut sources {
        let doc=parser::parse_document(file,text).0;
        let Some((prior_file,prior_text))=target.iter().find(|(f,_)|super::release_bridge::operation_name(f,"")==super::release_bridge::operation_name(file,""))else{continue};
        let prior=parser::parse_document(prior_file,prior_text).0;
        let(tokens,_)=lexer::lex(file,text);let mut edits=Vec::new();let mut extra=String::new();let mut restored=BTreeMap::new();
        // Retain a missing old exported alias only to an authored current
        // endpoint (including an explicitly authored current alias target).
        // Existing/rebound current aliases remain exactly current-authored.
        for(name,target,_)in &prior.aliases {
            let qualified=super::release_bridge::operation_name(file,name);
            if next.programs.iter().any(|p|p.program.name==qualified){continue;}
            let endpoint=doc.programs.iter().find(|p|p.name==*target).or_else(||doc.aliases.iter().find(|(alias,_,_)|alias==target).and_then(|(_,target,_)|doc.programs.iter().find(|p|p.name==*target)));
            if let Some(endpoint)=endpoint{extra.push_str(&format!("alias {name} = {}\n",endpoint.name));restored.insert(qualified,endpoint.name.clone());}
        }
        for previous in &old.programs {
            let qualified=&previous.program.name;
            let endpoint=doc.programs.iter().find(|p|super::release_bridge::operation_name(file,&p.name)==*qualified).or_else(|| {
                let target=doc.aliases.iter().find(|(name,_,_)|super::release_bridge::operation_name(file,name)==*qualified).map(|(_,target,_)|target).or_else(||restored.get(qualified))?;
                doc.programs.iter().find(|p|p.name==*target)
            });
            let Some(endpoint)=endpoint else{continue};
            let actual=super::release_bridge::operation_name(file,&endpoint.name);
            let Some(current)=next.programs.iter().find(|p|p.program.name==*qualified||p.program.name==actual)else{continue};
            for(alias,owner)in &previous.program.arg_aliases {
                if current.program.argument(alias).is_some(){continue;}
                let Some((canonical,_))=current.program.argument(owner)else{continue};
                let Some(arg)=endpoint.args.iter().find(|arg|arg.name==canonical&&arg.alias.is_none())else{continue};
                if let Ok((_,end))=arg_type(text,&tokens,arg){edits.push((end,end,format!(" alias {alias}")));changes.push(format!("operation {qualified}: retained wire alias {alias} on {canonical}"));}
            }
        }
        edits.sort();edits.dedup();edits.sort_by_key(|edit|std::cmp::Reverse(edit.0));
        for(start,end,value)in edits{text.replace_range(start..end,&value);}
        if !extra.is_empty(){if !text.ends_with('\n'){text.push('\n');}text.push_str(&extra);}
    }
    // A view can pause an incompatible write; it cannot guess a required
    // choice or silently consume a removed data-bearing argument.
    let available=crate::compile(&sources);
    let delete_roots=destructive_delete_roots(&old,&available);
    let mut paused=BTreeSet::new();
    for (file,text) in &mut sources {
        let doc=parser::parse_document(file,text).0;
        let mut edits=Vec::new();
        for endpoint in &doc.programs {
            let actual=super::release_bridge::operation_name(file,&endpoint.name);
            let exports=std::iter::once(actual.clone()).chain(doc.aliases.iter().filter(|(_,target,_)|target==&endpoint.name).map(|(name,_,_)|super::release_bridge::operation_name(file,name))).collect::<Vec<_>>();
            let incompatible=old.programs.iter().filter(|p|exports.contains(&p.program.name)).find(|p|available.programs.iter().find(|n|n.program.name==actual).is_some_and(|n|!endpoint_contract(&p.program,&n.program)||snapback4_core::ir::write_tables(&n.program).iter().any(|(table,effect)|*effect=="delete"&&delete_roots.contains(table))));
            if let Some(previous)=incompatible {
                if matches!(previous.program.kind,snapback4_core::ir::ProgramKind::Query){continue;}
                paused.extend(exports);
                let (a,b)=declaration(text,endpoint.site.line);edits.push((a,b));
                for (_,target,site) in &doc.aliases {if target==&endpoint.name {edits.push(declaration(text,site.line));}}
                changes.push(format!("operation {}: paused (E_OP); incompatible input/delete contract (current cascade/set-null roots [{}]); arguments [{}] → [{}]; author a guarded compatibility endpoint that consumes old inputs and supplies required choices explicitly",previous.program.name,delete_roots.iter().cloned().collect::<Vec<_>>().join(", "),previous.program.args.keys().cloned().collect::<Vec<_>>().join(", "),endpoint.args.iter().map(|a|a.name.clone()).collect::<Vec<_>>().join(", ")));
            }
        }
        edits.sort();edits.dedup();for (a,b) in edits.into_iter().rev(){text.replace_range(a..b,"");}
    }
    // An assertion about a paused export is vacuous, not a table-wide guard.
    // Remove only that named-operation assertion; all data/column intent stays.
    for (file,text)in &mut sources {
        let doc=parser::parse_document(file,text).0;let mut edits=Vec::new();
        for inv in &doc.invariants {
            if inv.column.is_none()&&!matches!(inv.target.as_str(),"always"|"read"|"insert"|"update"|"delete"|"write")
                &&(paused.contains(&inv.target)||paused.contains(&super::release_bridge::operation_name(file,&inv.target))) {edits.push(declaration(text,inv.site.line));}
        }
        edits.sort();edits.dedup();for(a,b)in edits.into_iter().rev(){text.replace_range(a..b,"");}
    }
    let bound=crate::compile(&sources);
    if !bound.diagnostics.is_empty(){return Bridge{sources,changes,diagnostics:bound.diagnostics};}
    if !table_contracts(&old,&bound,true)||!endpoint_contracts(&old,&bound,true){
        let incompatible=old.programs.iter().filter(|p|bound.programs.iter().find(|n|n.program.name==p.program.name).is_none_or(|n|!endpoint_contract(&p.program,&n.program))).map(|p|format!("{} predecessor arguments [{}], current arguments [{}]",p.program.name,p.program.args.keys().cloned().collect::<Vec<_>>().join(", "),bound.programs.iter().find(|n|n.program.name==p.program.name).map(|n|n.program.args.keys().cloned().collect::<Vec<_>>().join(", ")).unwrap_or_else(||"export absent".into()))).collect::<Vec<_>>();
        return refused(current,&format!("guarded view cannot retain predecessor queries/inputs [{}]; author a compatible guarded query with the old accepted arguments",incompatible.join("; ")));
    }
    for(name,table)in &old.schema.tables {
        for column in table.columns.keys().filter(|column|!bound.schema.tables[name].columns.contains_key(*column)) {
            if let Some(current)=renamed_column(&old,&bound,name,column){changes.push(format!("{name}.{column}: declared identity is now {name}.{current}; guarded view uses the current spelling and result semantics; review the old UI"));}
            else if bound.schema.extractions.iter().any(|e|&e.parent==name&&e.fields.values().any(|source|source==column)){changes.push(format!("{name}.{column}: extracted field remains in the retained child population; no single child is invented for the old cell; review the current query result in the old UI"));}
            else{changes.push(format!("{name}.{column}: removed nullable default-free field remains absent in this guarded view; historical cells stay retained; review the old UI result"));}
        }
    }
    for previous in &old.programs {
        if !bound.programs.iter().any(|p|p.program.name==previous.program.name){changes.push(format!("operation {}: paused because no compatible current authored write endpoint exists; old calls return E_OP; author a guarded compatibility endpoint if this old workflow is still needed",previous.program.name));}
    }
    Bridge{sources,changes,diagnostics:vec![]}
}

fn destructive_delete_roots(old:&crate::Bound,next:&crate::Bound)->BTreeSet<String>{
    use snapback4_core::schema::{ColumnType,references::OnDelete};
    let mut roots=BTreeSet::new();
    for (name,before) in &old.schema.tables {if let Some(after)=next.schema.table(name){
        for column in before.columns.keys() {
            let new=renamed_column(old,next,name,column).unwrap_or(column);
            let Some(ColumnType::Ref{table:parent})=after.columns.get(new).map(ColumnType::required)else{continue};
            let action=after.on_delete.get(new);
            if action!=before.on_delete.get(column)&&matches!(action,Some(OnDelete::Cascade|OnDelete::SetNull)){roots.insert(parent.clone());}
        }
    }}
    loop {
        let prior=roots.len();
        for child in roots.clone() {if let Some(table)=next.schema.table(&child) {for(column,kind)in &table.columns {
            if table.on_delete.get(column)==Some(&OnDelete::Cascade) {if let ColumnType::Ref{table}=kind.required(){roots.insert(table.clone());}}
        }}}
        if roots.len()==prior{break;}
    }
    roots
}

pub(super) fn contracts(old:&crate::Bound,new:&crate::Bound)->bool {
    table_contracts(old,new,false)&&endpoint_contracts(old,new,false)
}
fn table_contracts(old:&crate::Bound,new:&crate::Bound,nullable_gaps:bool)->bool {
    old.schema.tables.iter().all(|(name,table)|new.schema.tables.get(name).is_some_and(|next| {
        table.columns.iter().all(|(column,kind)|next.columns.contains_key(column)
            || (nullable_gaps&&renamed_column(old,new,name,column).is_some())
            || (nullable_gaps&&new.schema.extractions.iter().any(|e|&e.parent==name&&e.fields.values().any(|source|source==column)))
            || (nullable_gaps&&kind.is_optional()&&!table.defaults.contains_key(column)&&!table.engine_field(column)&&!table.maintained.contains_key(column)))
    }))
}
fn endpoint_contracts(old:&crate::Bound,new:&crate::Bound,pause_removed_writes:bool)->bool {
    old.programs.iter().all(|p|new.programs.iter().find(|n|n.program.name==p.program.name)
        .map_or_else(||pause_removed_writes&&matches!(p.program.kind,snapback4_core::ir::ProgramKind::Mutation|snapback4_core::ir::ProgramKind::Job|snapback4_core::ir::ProgramKind::Action),|n|endpoint_contract(&p.program,&n.program)))
}
pub(super) fn endpoint_contract(old:&snapback4_core::Program,new:&snapback4_core::Program)->bool {
    if old.kind!=new.kind{return false;}
    let mut positions=BTreeSet::new();
    for(name,kind)in &old.args {
        let Some((target,next))=new.argument(name)else{return false};
        if !accepts(kind,next)||!positions.insert(target){return false;}
        if !old.arg_aliases.iter().filter(|(_,owner)|*owner==name).all(|(alias,_)|new.argument(alias).is_some_and(|(canonical,next)|canonical==target&&accepts(kind,next))){return false;}
    }
    new.args.iter().all(|(name,kind)|positions.contains(name.as_str())||matches!(kind,ArgType::Optional(_)))
}
fn renamed_column<'a>(old:&crate::Bound,new:&'a crate::Bound,table:&str,column:&str)->Option<&'a str> {
    let next=new.schema.table(table)?;
    if let Some((name,_))=new.schema.asset_renames.get(table).into_iter().flatten().find(|(name,prior)|prior.as_str()==column&&next.columns.contains_key(*name)){return Some(name.as_str());}
    if let Some(prior)=old.schema.asset_renames.get(table).and_then(|m|m.get(column)) {
        if let Some((name,_))=next.columns.get_key_value(prior){return Some(name.as_str());}
    }
    for transform in &new.schema.backfills {
        if transform.table==table&&transform.inputs.len()==1&&transform.inputs.contains_key(column)&&transform.outputs.len()==1 {
            let name=transform.outputs.iter().next()?;
            if transform.name==format!("$rename:up:{column}:{name}")&&next.columns.contains_key(name){return Some(name.as_str());}
        }
    }
    for transform in &old.schema.backfills {
        if transform.table==table&&transform.outputs.len()==1&&transform.outputs.contains(column)&&transform.inputs.len()==1 {
            let prior=transform.inputs.keys().next()?;
            if transform.name==format!("$rename:up:{prior}:{column}") {
                if let Some((name,_))=next.columns.get_key_value(prior){return Some(name.as_str());}
            }
        }
    }
    None
}
// This is inclusion of wire domains for an unchanged authored current body,
// not synthesis of a conversion or permission to reinterpret old arguments.
fn accepts(old: &ArgType, new: &ArgType) -> bool {
    if old == new {
        return true;
    }
    match (old, new) {
        (ArgType::Optional(a), ArgType::Optional(b)) => accepts(a, b),
        (_, ArgType::Optional(b)) => accepts(old, b),
        (ArgType::Optional(_), _) => false,
        (
            ArgType::Text {
                min: a,
                max: b,
                format: f,
            },
            ArgType::Text {
                min: x,
                max: y,
                format: g,
            },
        ) => f == g && x <= a && b <= y,
        (ArgType::Enum { variants: a }, ArgType::Enum { variants: b }) => {
            a.iter().all(|v| b.contains(v))
        }
        (
            ArgType::List { .. } | ArgType::ListRange { .. },
            ArgType::List { .. } | ArgType::ListRange { .. },
        ) => {
            let parts = |kind: &ArgType| match kind {
                ArgType::List { of, max } => (0, *max, of.clone()),
                ArgType::ListRange { of, min, max } => (*min, *max, of.clone()),
                _ => unreachable!(),
            };
            let (a, b, element) = parts(old);
            let (x, y, next) = parts(new);
            x <= a
                && b <= y
                && match (element, next) {
                    (None, None) => true,
                    (Some(a), Some(b)) => accepts(&a, &b),
                    _ => false,
                }
        }
        (ArgType::IntRange { .. }, ArgType::Int) => true,
        (ArgType::IntRange { min: a, max: b }, ArgType::IntRange { min: x, max: y }) => {
            x <= a && b <= y
        }
        _ => false,
    }
}
fn word(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}
fn offset(text: &str, line: u32, col: u32) -> usize {
    let start = text
        .split_inclusive('\n')
        .take(line.saturating_sub(1) as usize)
        .map(str::len)
        .sum::<usize>();
    start
        + text[start..]
            .chars()
            .take(col.saturating_sub(1) as usize)
            .map(char::len_utf8)
            .sum::<usize>()
}
fn declaration(text: &str, line: u32) -> (usize, usize) {
    let start = offset(text, line, 1);
    let end = text
        .split_inclusive('\n')
        .enumerate()
        .skip(line as usize)
        .find(|(_, s)| {
            !s.trim().is_empty() && !s.starts_with(char::is_whitespace) && !s.starts_with("--")
        })
        .map(|(i, _)| offset(text, i as u32 + 1, 1))
        .unwrap_or(text.len());
    (start, end)
}
fn remap_type(kind: &mut ast::ScalarType, names: &BTreeMap<String, String>) {
    match &mut kind.kind {
        TypeKind::Ref { table } => {
            if let Some(name) = names.get(table) {
                *table = name.clone()
            }
        }
        TypeKind::List { item, .. } => remap_type(item, names),
        _ => (),
    }
}
// Closed, capture-avoiding alpha conversion of a single source module. Complex
// declaration families require an explicitly authored compatible source.
struct MappingError {reason:String,unsupported:bool}
impl From<String> for MappingError {
    fn from(reason:String)->Self{Self{reason,unsupported:false}}
}
impl From<&str> for MappingError {
    fn from(reason:&str)->Self{reason.to_owned().into()}
}
fn alpha(target: &[Source], current: &[Source]) -> Result<Option<Vec<Source>>, MappingError> {
    if target.len() != 1 || current.len() != 1 {
        return Ok(None);
    }
    let old = parser::parse_document(&target[0].0, &target[0].1).0;
    let (file, text) = &current[0];
    let doc = parser::parse_document(file, text).0;
    if old.tables.iter().chain(&doc.tables).any(|t| !word(&t.name)) {
        return Ok(None);
    }
    let mut names = BTreeMap::new();
    for next in &doc.tables {
        if old.tables.iter().any(|t| t.name == next.name) {
            continue;
        }
        if let Some(prior) = old.tables.iter().find(|t| {
            next.renamed_from.as_ref() == Some(&t.name)
                || t.renamed_from.as_ref() == Some(&next.name)
        }) {
            names.insert(next.name.clone(), prior.name.clone());
        }
    }
    if names.is_empty() {
        return Ok(None);
    }
    // A legal table name may also spell a primitive type. Reprinting that
    // identity in an argument/column must never turn a nominal Ref into Int,
    // Principal, etc. Validate the parser's actual type interpretation.
    for name in names.values() {
        let probe = format!("table __rollback_type_probe:\n  value: {name}\n");
        let (parsed, diagnostics) = parser::parse_document("rollback-type-probe.q", &probe);
        if !diagnostics.is_empty()
            || !matches!(parsed.tables.first().and_then(|t|t.columns.first()).map(|c|&c.type_.kind),Some(TypeKind::Ref{table}) if table==name)
        {
            return Err(
                "a table identity spelling reparses as a scalar or unsupported reference type"
                    .into(),
            );
        }
    }
    let outputs = doc
        .tables
        .iter()
        .map(|t| names.get(&t.name).unwrap_or(&t.name))
        .collect::<BTreeSet<_>>();
    if outputs.len() != doc.tables.len() || names.keys().any(|name| outputs.contains(name)) {
        return Err(
            "the declared table mapping is ambiguous or captures a current table name".into(),
        );
    }
    let mut inspect = doc.clone();
    let mut unsupported = false;
    let mut check = |e: &mut ast::Expr| match e {
        ast::Expr::Walk { .. } | ast::Expr::Merge(_) => unsupported = true,
        _ => (),
    };
    crate::bind::intent_walk::document(&mut inspect, &mut check);
    for inv in &mut inspect.invariants {
        crate::bind::intent_walk::expression(&mut inv.value, &mut check);
    }
    for table in &mut inspect.tables {
        for rule in table
            .rules
            .iter_mut()
            .chain(table.column_reads.iter_mut().map(|(_, r)| r))
        {
            crate::bind::intent_walk::expression(&mut rule.value, &mut check);
        }
        for column in &mut table.columns {
            for value in [&mut column.read, &mut column.write, &mut column.default]
                .into_iter()
                .flatten()
            {
                crate::bind::intent_walk::expression(value, &mut check);
            }
        }
        for (_,value,_) in &mut table.immutable_when {crate::bind::intent_walk::expression(value,&mut check);}
        for (value, _) in &mut table.final_exists {
            crate::bind::intent_walk::expression(value, &mut check);
        }
    }
    if unsupported {
        return Err(
            "a recursive or merge expression needs an authored compatible table mapping".into(),
        );
    }
    if !doc.actions.is_empty()
        || !doc.effects.is_empty()
        || !doc.maintains.is_empty()
        || !doc.timelines.is_empty()
        || !doc.views.is_empty()
        || !doc.feed_views.is_empty()
        || !doc.backfills.is_empty()
        || !doc.downfills.is_empty()
        || !doc.extractions.is_empty()
        || doc.programs.iter().any(|p| p.delivery.is_some())
        || doc
            .tables
            .iter()
            .any(|t| t.receipts.is_some() || t.columns.iter().any(|c| c.maintained.is_some()))
    {
        return Err(MappingError{reason:"this table identity mapping includes a derived, receipt or migration declaration outside the closed current-source adapter".into(),unsupported:true});
    }
    let (tokens, _) = lexer::lex(file, text);
    let mut edits = Vec::<(usize, usize, String)>::new();
    for table in &doc.tables {
        let mut source = super::release_bridge::retained_declaration(file, text, table, &names)?;
        if let Some(name) = names.get(&table.name) {
            let prior = old
                .tables
                .iter()
                .find(|t| &t.name == name)
                .ok_or("missing predecessor identity")?;
            source = header(
                file,
                &source,
                &table.name,
                name,
                prior.renamed_from.as_deref(),
            )?;
        }
        let (a, b) = declaration(text, table.site.line);
        edits.push((a, b, source));
    }
    for inv in &doc.invariants {
        let table = names.get(&inv.table).unwrap_or(&inv.table);
        let mut value = inv.value.clone();
        crate::bind::intent_walk::expression(&mut value, &mut |e| match e {
            ast::Expr::Read(r)
            | ast::Expr::Exists { read: r, .. }
            | ast::Expr::Created { read: r, .. } => {
                if let Some(name) = names.get(&r.table) {
                    r.table = name.clone()
                }
            }
            ast::Expr::Write { table, .. } => {
                if let Some(name) = names.get(table) {
                    *table = name.clone()
                }
            }
            _ => (),
        });
        let target = if let Some(column) = &inv.column {
            format!("{table}.{column} {} only", inv.target)
        } else if inv.target == "always" {
            format!("{table} always")
        } else {
            format!("{table}.{} only", inv.target)
        };
        let (a, b) = declaration(text, inv.site.line);
        edits.push((
            a,
            b,
            format!("invariant {target} {}\n", print::expression(&value)),
        ));
    }
    fn loop_domains(body:&[ast::Stmt],bound:&mut BTreeSet<String>,names:&BTreeMap<String,String>,text:&str,edits:&mut Vec<(usize,usize,String)>){
        for stmt in body {match stmt {
            ast::Stmt::Bind{names,..}=>bound.extend(names.iter().cloned()),
            ast::Stmt::For{name,domain,body,..}=>{
                if let ast::Expr::Name{name:table,site}=domain {if !bound.contains(table) {if let Some(prior)=names.get(table){let a=offset(text,site.line,site.col);edits.push((a,a+table.len(),prior.clone()));}}}
                let mut inner=bound.clone();inner.insert(name.clone());loop_domains(body,&mut inner,names,text,edits);
            },
            ast::Stmt::If{then_body,else_body,..}=>{loop_domains(then_body,&mut bound.clone(),names,text,edits);loop_domains(else_body,&mut bound.clone(),names,text,edits);},
            ast::Stmt::As{body,..}=>loop_domains(body,&mut bound.clone(),names,text,edits),
            _=>(),
        }}
    }
    for p in &doc.programs {let mut bound=p.args.iter().map(|a|a.name.clone()).collect();loop_domains(&p.prelude,&mut bound,&names,text,&mut edits);loop_domains(&p.body,&mut bound,&names,text,&mut edits);}
    for f in &doc.functions {if let ast::FunctionBody::Block(body)=&f.body {loop_domains(body,&mut f.args.iter().map(|a|a.name.clone()).collect(),&names,text,&mut edits);}}
    let mut other = doc.clone();
    other.tables.clear();
    other.invariants.clear();
    let mut reference_error = None;
    crate::bind::intent_walk::document(&mut other, &mut |e| {
        let (table, site) = match e {
            ast::Expr::Read(r)
            | ast::Expr::Exists { read: r, .. }
            | ast::Expr::Created { read: r, .. } => (&r.table, &r.site),
            ast::Expr::Write { table, site, .. } => (&*table, &*site),
            _ => return,
        };
        let Some(name) = names.get(table) else { return };
        if let Some(token) = tokens.iter().find(|t| {
            t.site.line == site.line
                && t.site.col >= site.col
                && t.kind == Kind::Word
                && t.value == *table
        }) {
            let a = offset(text, token.site.line, token.site.col);
            edits.push((a, a + token.value.len(), name.clone()));
        } else {
            reference_error = Some("a table reference has no unambiguous source span".to_owned());
        }
    });
    if let Some(error) = reference_error {
        return Err(error.into());
    }
    for arg in doc
        .programs
        .iter()
        .flat_map(|p| &p.args)
        .chain(doc.functions.iter().flat_map(|p| &p.args))
        .chain(doc.actions.iter().flat_map(|p| &p.args))
        .chain(doc.actions.iter().flat_map(|p| p.returns.iter().flatten()))
    {
        let mut kind = arg.type_.clone();
        remap_type(&mut kind, &names);
        if kind != arg.type_ {
            let (a, b) = arg_type(text, &tokens, arg)?;
            edits.push((a, b, print::scalar_type(&kind)));
        }
    }
    edits.sort_by_key(|(a, b, _)| (*a, *b));
    edits.dedup();
    if edits.iter().any(|(a, b, _)| {
        a > b || *b > text.len() || !text.is_char_boundary(*a) || !text.is_char_boundary(*b)
    }) {
        return Err("an unsupported source span needs an authored compatible mapping".into());
    }
    if edits.windows(2).any(|p| p[0].1 > p[1].0) {
        return Err("overlapping source spans in table identity mapping".into());
    }
    let mut result = text.clone();
    for (a, b, value) in edits.into_iter().rev() {
        result.replace_range(a..b, &value);
    }
    Ok(Some(vec![(file.clone(), result)]))
}
fn header(
    file: &str,
    source: &str,
    from: &str,
    to: &str,
    prior: Option<&str>,
) -> Result<String, String> {
    if prior.is_some_and(|p| !word(p)) {
        return Err("qualified predecessor table origin needs an authored source".into());
    }
    let line = source.lines().next().ok_or("missing table header")?;
    let (tokens, _) = lexer::lex(file, line);
    let name = tokens
        .get(1)
        .filter(|t| t.kind == Kind::Word && t.value == from)
        .ok_or("missing table name span")?;
    let mut edits = vec![(
        offset(line, name.site.line, name.site.col),
        offset(line, name.site.line, name.site.col) + from.len(),
        to.to_owned(),
    )];
    if let Some(at) = tokens.iter().enumerate().skip(2).find_map(|(i,t)| (t.value=="renamed").then_some(i)) {
        let last = tokens
            .get(at + 2)
            .filter(|_| tokens.get(at + 1).is_some_and(|t| t.value == "from"))
            .ok_or("invalid table origin span")?;
        edits.push((
            offset(line, tokens[at].site.line, tokens[at].site.col),
            offset(line, last.site.line, last.site.col) + last.value.len(),
            prior
                .map(|p| format!("renamed from {p}"))
                .unwrap_or_default(),
        ));
    } else if let Some(prior) = prior {
        let colon = tokens
            .iter()
            .find(|t| t.value == ":")
            .ok_or("missing table header colon")?;
        let a = offset(line, colon.site.line, colon.site.col);
        edits.push((a, a, format!(" renamed from {prior}")));
    }
    let mut out = source.to_owned();
    edits.sort_by_key(|(a, _, _)| std::cmp::Reverse(*a));
    for (a, b, value) in edits {
        out.replace_range(a..b, &value);
    }
    Ok(out)
}
pub(super) fn arg_type(
    text: &str,
    tokens: &[lexer::Token],
    arg: &ast::ArgDecl,
) -> Result<(usize, usize), String> {
    let at = tokens
        .iter()
        .position(|t| t.site == arg.site)
        .ok_or("missing argument source span")?;
    let colon = (at..tokens.len())
        .find(|i| tokens[*i].value == ":")
        .ok_or("missing argument type colon")?;
    let start = tokens.get(colon + 1).ok_or("missing argument type")?;
    let mut depth = 0_i32;
    for (ordinal, t) in tokens.iter().skip(colon + 1).enumerate() {
        // `alias` and `default` are legal first nominal type tokens too.
        if ordinal > 0
            && depth == 0
            && (matches!(
                t.value.as_str(),
                "," | ")" | "=" | "default" | "alias" | "renamed" | "deprecated"
            ) || t.kind == Kind::Newline)
        {
            return Ok((
                offset(text, start.site.line, start.site.col),
                text[..offset(text, t.site.line, t.site.col)]
                    .trim_end()
                    .len(),
            ));
        }
        match t.value.as_str() {
            "(" | "[" | "<" => depth += 1,
            ")" | "]" | ">" => depth -= 1,
            _ => (),
        }
    }
    Err("unterminated argument type source span".into())
}
