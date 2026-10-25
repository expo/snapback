//! Advisory only: direct scheduled status transitions and their mutation readers.
// @ref LLP 3000.013.002#5 — a sweep is not an exact deadline; this lint is not a safety proof.
use super::catalog::Catalog;
use crate::{ast::*, diag::Diagnostic};
use std::collections::{BTreeMap, BTreeSet};

fn read_table(expr: &Expr) -> Option<&str> {
    match expr { Expr::Name { name, .. } => Some(name), Expr::Read(read) => Some(&read.table), Expr::Assert { value, .. } => read_table(value), _ => None }
}
fn aliases(body: &[Stmt], out: &mut BTreeMap<String, String>) {
    for stmt in body {
        match stmt {
            Stmt::Bind { names, value, .. } if names.len() == 1 => {
                if let Some(table) = read_table(value) { out.insert(names[0].clone(), table.into()); }
            }
            Stmt::For { name, domain, body, .. } => {
                if let Some(table) = read_table(domain) { out.insert(name.clone(), table.into()); }
                aliases(body, out);
            }
            Stmt::If { then_body, else_body, .. } => { aliases(then_body, out); aliases(else_body, out); }
            Stmt::As { body, .. } => aliases(body, out),
            _ => {}
        }
    }
}
fn member(expr: &Expr, aliases: &BTreeMap<String, String>) -> Option<(String, String, String)> {
    let Expr::Member { base, name: field, .. } = expr else { return None };
    match base.as_ref() {
        Expr::Name { name, .. } => Some((aliases.get(name)?.clone(),field.clone(),name.clone())),
        Expr::Read(read) => Some((read.table.clone(),field.clone(),crate::print::read_expr(read))),
        Expr::Assert{value,..} => read_table(value).map(|table|(table.to_owned(),field.clone(),crate::print::expression(value))),
        _ => None,
    }
}
fn clock(expr: &Expr, period: bool) -> bool {
    let mut found = false;
    super::intent_walk::expression(&mut expr.clone(), &mut |e| {
        if matches!(e, Expr::Name { name, .. } if name == "now" || (period && name == "periodEnd")) { found = true; }
    }); found
}
fn comparisons(body: &[Stmt], aliases: &BTreeMap<String, String>, period: bool) -> Vec<(String, String, String, Expr)> {
    let mut out = Vec::new();
    super::intent_walk::statements(&mut body.to_vec(), &mut |expr| {
        if let Expr::Binary { op, left, right, .. } = &*expr && ["<", "<=", ">", ">="].contains(&op.as_str()) {
            for (value, time) in [(left.as_ref(), right.as_ref()), (right.as_ref(), left.as_ref())] {
                if clock(time, period) && let Some((table, field, name)) = member(value, aliases) {
                    out.push((table, field, name, expr.clone()));
                }
            }
        }
    }); out
}
fn condition_fields(body: &[Stmt], aliases: &BTreeMap<String, String>, out: &mut BTreeSet<(String, String, String)>) {
    for stmt in body {
        let condition = match stmt {
            Stmt::Require { condition, .. } | Stmt::If { condition, .. } => Some(condition),
            _ => None,
        };
        if let Some(condition) = condition {
            super::intent_walk::expression(&mut condition.clone(), &mut |expr| {
                if let Some(field) = member(expr, aliases) { out.insert(field); }
            });
        }
        match stmt {
            Stmt::For { body, .. } | Stmt::As { body, .. } => condition_fields(body, aliases, out),
            Stmt::If { then_body, else_body, .. } => { condition_fields(then_body, aliases, out); condition_fields(else_body, aliases, out); }
            _ => {}
        }
    }
}
fn literal_updates(body: &[Stmt]) -> BTreeSet<(String, String)> {
    let mut writes = BTreeSet::new();
    super::intent_walk::statements(&mut body.to_vec(), &mut |expr| {
        if let Expr::Write { op: WriteOp::Update, table, fields, .. } = expr {
            for field in fields {
                if matches!(field.value, Some(Expr::Literal { value: Literal::Str(_) | Literal::Bool(_), .. })) {
                    writes.insert((table.clone(), field.name.clone()));
                }
            }
        }
    });
    writes
}
// @ref LLP 3000.036.004#18-wave-26-security-decisions-dx9 — compare literal states and dominating guards of the actual write paths.
fn allows(expr:&Expr, table:&str, column:&str, value:&Literal, alias:&str, aliases:&BTreeMap<String,String>)->Option<bool>{
    match expr {
        Expr::Literal{value:Literal::Bool(b),..}=>Some(*b),
        Expr::Unary{op,value:inner,..} if op=="not"=>allows(inner,table,column,value,alias,aliases).map(|b|!b),
        Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>{
            let a=allows(left,table,column,value,alias,aliases);let b=allows(right,table,column,value,alias,aliases);
            if op=="and" {if a==Some(false)||b==Some(false){Some(false)}else if a==Some(true)&&b==Some(true){Some(true)}else{None}}
            else {if a==Some(true)||b==Some(true){Some(true)}else if a==Some(false)&&b==Some(false){Some(false)}else{None}}
        },
        Expr::Binary{op,left,right,..} if op=="="||op=="!="=>{
            for (field,literal) in [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())] {
                if member(field,aliases).is_some_and(|(t,c,a)|t==table&&c==column&&a==alias)
                    && let Expr::Literal{value:other,..}=literal {
                    return Some((other==value)==(op=="="));
                }
            }None
        },
        field if member(field,aliases).is_some_and(|(t,c,a)|t==table&&c==column&&a==alias)=>if let Literal::Bool(b)=value{Some(*b)}else{None},
        _=>None,
    }
}
fn admitted(body:&[Stmt],table:&str,column:&str,value:&Literal,alias:&str,aliases:&BTreeMap<String,String>)->bool{
    body.iter().filter_map(|s|if let Stmt::Require{condition,..}=s{Some(condition)}else{None})
        .all(|guard|allows(guard,table,column,value,alias,aliases)!=Some(false))
}
fn time_mask(expr:&Expr,table:&str,column:&str,alias:&str,bindings:&BTreeMap<String,String>,period:bool)->Option<u8>{
    match expr {
        Expr::Unary{op,value,..} if op=="not"=>time_mask(value,table,column,alias,bindings,period).map(|mask|7^mask),
        Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>{
            let a=time_mask(left,table,column,alias,bindings,period);let b=time_mask(right,table,column,alias,bindings,period);
            if op=="and" {if a.is_some()||b.is_some(){Some(a.unwrap_or(7)&b.unwrap_or(7))}else{None}}
            else {Some(a? | b?)}
        },
        Expr::Binary{op,left,right,..}=>{
            for (field,time,reverse) in [(left.as_ref(),right.as_ref(),false),(right.as_ref(),left.as_ref(),true)] {
                if !matches!(time,Expr::Name{name,..} if name=="now"||period&&name=="periodEnd"){continue;}
                if !member(field,bindings).is_some_and(|(t,c,a)|t==table&&c==column&&a==alias){continue;}
                let mask=match op.as_str(){"<"=>1,"<="=>3,"="=>2,"!="=>5,">="=>6,">"=>4,_=>return None};
                return Some(if reverse{(mask&1)<<2 | mask&2 | (mask&4)>>2}else{mask});
            }None
        },_=>None,
    }
}
fn path_time(body:&[Stmt],table:&str,column:&str,alias:&str,bindings:&BTreeMap<String,String>,period:bool)->u8{
    body.iter().filter_map(|s|if let Stmt::Require{condition,..}=s{time_mask(condition,table,column,alias,bindings,period)}else{None}).fold(7,|a,b|a&b)
}
pub(super) fn notes(catalog: &Catalog) -> Vec<Diagnostic> {
    let programs: Vec<_> = catalog.documents.iter().flat_map(|doc| {
        let module = std::path::Path::new(&doc.file).file_stem().and_then(|s| s.to_str()).unwrap_or("schema");
        doc.programs.iter().map(move |program| (if module == "schema" { program.name.clone() } else { format!("{module}.{}", program.name) }, program))
    }).collect();
    let scheduled: BTreeSet<_> = catalog.documents.iter().flat_map(|doc| &doc.schedules).map(|s| s.target.as_str()).collect();
    let mut notes=Vec::new();let mut emitted=BTreeSet::new();
    for (job_name,job) in programs.iter().filter(|(name,p)|p.kind==ProgramKind::Job&&!p.native&&scheduled.contains(name.as_str())) {
        let mut job_aliases=BTreeMap::new();aliases(&job.body,&mut job_aliases);
        for (write,job_path) in super::security::authority_walk::writes(catalog,job) {
            let Expr::Write{op:WriteOp::Update,table,fields,..}=write else{continue;};
            let deadlines=comparisons(&job_path.body,&job_aliases,true);
            let job_writes=literal_updates(&job.body);
            let mut job_conditions=BTreeSet::new();condition_fields(&job_path.body,&job_aliases,&mut job_conditions);
            for (mutation_name,mutation) in programs.iter().filter(|(_,p)|p.kind==ProgramKind::Mutation&&!p.native){
                let mut mutation_aliases=BTreeMap::new();aliases(&mutation.body,&mut mutation_aliases);
                for (_,path) in super::security::authority_walk::writes(catalog,mutation){
                    let mut conditions=BTreeSet::new();condition_fields(&path.body,&mutation_aliases,&mut conditions);
                    let mutation_writes=literal_updates(&mutation.body);
                    for (deadline_table,deadline,job_alias,_) in &deadlines {
                        if deadline_table!=&table||!catalog.tables.get(&table).and_then(|t|t.columns.get(deadline)).is_some_and(|c|matches!(c.kind,TypeKind::Time)){continue;}
                        for (target,status,alias) in &conditions {
                            let direct=fields.iter().any(|f|&f.name==status&&matches!(f.value,Some(Expr::Literal{..})));
                            let coupled=job_writes.iter().any(|(t,_)|t==&table)&&job_conditions.iter().any(|(t,c,_)|t==&table&&c==status)&&mutation_writes.contains(&(table.clone(),status.clone()));
                            if target!=&table||(!direct&&!coupled){continue;}
                            let due=path_time(&job_path.body,&table,deadline,job_alias,&job_aliases,true);
                            let admitted_time=path_time(&path.body,&table,deadline,alias,&mutation_aliases,false);
                            if due!=7&&due&admitted_time==0{continue;}
                            let states=match catalog.tables.get(&table).and_then(|t|t.columns.get(status)).map(|c|&c.kind){
                                Some(TypeKind::Bool)=>vec![Literal::Bool(false),Literal::Bool(true)],
                                Some(TypeKind::Enum{variants})=>variants.iter().cloned().map(Literal::Str).collect(),
                                _=>Vec::new(),
                            };
                            if !states.is_empty()&&!states.iter().any(|state|admitted(&job_path.body,&table,status,state,job_alias,&job_aliases)&&admitted(&path.body,&table,status,state,alias,&mutation_aliases)){continue;}
                            if !emitted.insert((mutation_name.clone(),table.clone(),deadline.clone(),status.clone())){continue;}
                            let relation=if direct{format!("tests {alias}.{status} (column {table}.{status}); scheduled job {job_name} has a literal update of that column")}
                                else{format!("tests {alias}.{status} and writes column {table}.{status}; scheduled job {job_name} also tests that column")};
                            notes.push(Diagnostic::new(&mutation.site,"N_SWEEP_DEADLINE",format!("mutation {mutation_name} {relation}; its write path can admit a state changed by the job at {table}.{deadline}; no dominating comparison of {alias}.{deadline} with now was found. This is not a proof of control flow, row identity or safety"),format!("if this is an operation deadline, enforce the intended time boundary on {alias}.{deadline} against now inside this mutation, choosing the opening/closing direction and equality boundary explicitly; keep the sweep for notifications/cleanup. Notification-only sweeps need no extra deadline guard")).guide("time"));
                        }
                    }
                }
            }
        }
    }
    notes
}
