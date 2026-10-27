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
                if clock(time, period) && let Some((table, field, name)) = member(shifted(value).0, aliases) {
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
                    if matches!(value,Literal::Number(value) if value=="$nonnull")&&!matches!(other,Literal::Null){return None;}
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
// Affine duration shifts keep the boundary and equality polarity explicit.
// now <= row.createdAt + 14d and row.createdAt < periodEnd - 14d
// compare the same cutoff, even with operands reversed.
fn shifted(expr:&Expr)->(&Expr,i64){
    if let Expr::Binary{op,left,right,..}=expr&&matches!(op.as_str(),"+"|"-")&&let Expr::Literal{value:Literal::Number(amount),..}=right.as_ref(){
        for (suffix,scale) in [("ms",1i64),("s",1000),("m",60_000),("h",3_600_000),("d",86_400_000)]{
            if let Some(value)=amount.strip_suffix(suffix).and_then(|n|n.parse::<i64>().ok()).and_then(|n|n.checked_mul(scale)){
                let (base,offset)=shifted(left);if let Some(offset)=if op=="+"{offset.checked_add(value)}else{offset.checked_sub(value)}{return (base,offset);}
            }
        }
    }
    if let Expr::Binary{op,left,right,..}=expr&&matches!(op.as_str(),"+"|"-")&&let Expr::Literal{value:Literal::Number(amount),..}=right.as_ref()&&let Ok(value)=amount.parse::<i64>(){
        let (base,offset)=shifted(left);if let Some(offset)=if op=="+"{offset.checked_add(value)}else{offset.checked_sub(value)}{return (base,offset);}
    }
    (expr,0)
}
fn time_comparison(expr:&Expr,table:&str,column:&str,alias:&str,bindings:&BTreeMap<String,String>,period:bool)->Option<(i64,u8)>{
    let Expr::Binary{op,left,right,..}=expr else{return None;};
    for (elapsed,amount,reverse) in [(left.as_ref(),right.as_ref(),false),(right.as_ref(),left.as_ref(),true)]{
        if let (Expr::Binary{op:subtract,left:a,right:b,site},Expr::Literal{value:Literal::Number(duration),..})=(elapsed,amount)&&subtract=="-"&&duration.parse::<i64>().is_ok(){
            let swap=|op:&str|match op{"<"=>">",">"=>"<","<="=>">=",">="=>"<=",x=>x}.to_string();
            let op=if reverse{swap(op)}else{op.clone()};
            let (field,clock,op,offset)=if matches!(a.as_ref(),Expr::Name{name,..} if name=="now"||period&&name=="periodEnd"){(b,a,swap(&op),"-")}else if matches!(b.as_ref(),Expr::Name{name,..} if name=="now"||period&&name=="periodEnd"){(a,b,op,"+")}else{continue;};
            return time_comparison(&Expr::Binary{op,left:field.clone(),right:Box::new(Expr::Binary{op:offset.into(),left:clock.clone(),right:Box::new(amount.clone()),site:site.clone()}),site:site.clone()},table,column,alias,bindings,period);
        }
    }

    for (field,time,reverse) in [(left.as_ref(),right.as_ref(),false),(right.as_ref(),left.as_ref(),true)]{
        let (field,field_shift)=shifted(field);let (time,time_shift)=shifted(time);
        if !matches!(time,Expr::Name{name,..} if name=="now"||period&&name=="periodEnd"){continue;}
        if !member(field,bindings).is_some_and(|(t,c,a)|t==table&&c==column&&a==alias){continue;}
        let mask=match op.as_str(){"<"=>1,"<="=>3,"="=>2,"!="=>5,">="=>6,">"=>4,_=>return None};
        return Some((time_shift.checked_sub(field_shift)?,if reverse{(mask&1)<<2 | mask&2 | (mask&4)>>2}else{mask}));
    }None
}
fn time_mask(expr:&Expr,table:&str,column:&str,alias:&str,bindings:&BTreeMap<String,String>,period:bool,offset:i64,state:Option<(&str,&Literal)>)->Option<u8>{
    if let Some((column,value))=state&&let Some(admitted)=allows(expr,table,column,value,alias,bindings){return Some(if admitted{7}else{0});}
    match expr{
        Expr::Unary{op,value,..} if op=="not"=>{
            // Negate atoms exactly; unknown conjunctions must not become a
            // restrictive mask by complementing an overapproximation.
            match value.as_ref(){
                Expr::Binary{op,left,right,site} if op=="and"||op=="or"=>{
                    let negate=|value:&Expr|Expr::Unary{op:"not".into(),value:Box::new(value.clone()),site:site.clone()};
                    time_mask(&Expr::Binary{op:if op=="and"{"or"}else{"and"}.into(),left:Box::new(negate(left)),right:Box::new(negate(right)),site:site.clone()},table,column,alias,bindings,period,offset,state)
                },
                Expr::Unary{op,value,..} if op=="not"=>time_mask(value,table,column,alias,bindings,period,offset,state),
                _=>time_comparison(value,table,column,alias,bindings,period).and_then(|(shift,mask)|(shift==offset).then_some(7^mask)),
            }
        },
        Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>{
            let a=time_mask(left,table,column,alias,bindings,period,offset,state);let b=time_mask(right,table,column,alias,bindings,period,offset,state);
            if op=="and" {if a.is_some()||b.is_some(){Some(a.unwrap_or(7)&b.unwrap_or(7))}else{None}}else{Some(a? | b?)}
        },
        _=>time_comparison(expr,table,column,alias,bindings,period).and_then(|(shift,mask)|(shift==offset).then_some(mask)),
    }
}
fn path_time(body:&[Stmt],table:&str,column:&str,alias:&str,bindings:&BTreeMap<String,String>,period:bool,offset:i64,state:Option<(&str,&Literal)>)->u8{
    body.iter().filter_map(|s|if let Stmt::Require{condition,..}=s{time_mask(condition,table,column,alias,bindings,period,offset,state)}else{None}).fold(7,|a,b|a&b)
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
                for (mutation_write,path) in super::security::authority_walk::writes(catalog,mutation){
                    let mut conditions=BTreeSet::new();condition_fields(&path.body,&mutation_aliases,&mut conditions);
                    let mutation_writes=literal_updates(&mutation.body);
                    for (deadline_table,deadline,job_alias,comparison) in &deadlines {
                        if deadline_table!=&table||!catalog.tables.get(&table).and_then(|t|t.columns.get(deadline)).is_some_and(|c|matches!(c.kind,TypeKind::Time)){continue;}
                        for (target,status,alias) in &conditions {
                            let direct=fields.iter().any(|f|&f.name==status&&matches!(f.value,Some(Expr::Literal{..})));
                            let coupled=job_writes.iter().any(|(t,_)|t==&table)&&job_conditions.iter().any(|(t,c,_)|t==&table&&c==status)&&mutation_writes.contains(&(table.clone(),status.clone()));
                            if target!=&table||(!direct&&!coupled){continue;}
                            let destination=fields.iter().find(|f|&f.name==status).and_then(|f|f.value.as_ref());
                            if let Some(Expr::Literal{value:after,..})=destination{
                                let accepts_after=path.body.iter().filter_map(|s|if let Stmt::Require{condition,..}=s{Some(condition)}else{None}).filter(|condition|{let mut found=false;super::intent_walk::expression(&mut (*condition).clone(),&mut |e|if member(e,&mutation_aliases).is_some_and(|(t,c,a)|t==table&&c==*status&&a==*alias){found=true;});found}).all(|condition|allows(condition,&table,status,after,alias,&mutation_aliases)==Some(true));
                                if accepts_after&&matches!(catalog.tables[&table].columns.get(status).map(|kind|&kind.kind),Some(TypeKind::Enum{..})){continue;}
                                if let Expr::Write{table:target,fields,keys,..}=&mutation_write&&target==&table&&fields.iter().any(|f|f.name==*status&&matches!(f.value.as_ref(),Some(Expr::Literal{value,..}) if value==after)){
                                    let mut read=ReadExpr{cursor_prefix:None,computed:Default::default(),order_keys:Vec::new(),table:table.clone(),index:None,keys:keys.clone(),range:None,filter:None,matching:None,seeks:Vec::new(),site:mutation_write.site().clone()};
                                    for key in &mut read.keys{super::intent_walk::expression(&mut key.value,&mut |e|{if let Expr::Assert{value,..}=e{*e=*value.clone();}if let Expr::Member{base,name,..}=e&&name=="id"&&let Expr::Read(read)=base.as_ref()&&read.keys.len()==1&&read.keys[0].column.as_deref().is_none_or(|c|c=="id"){*e=read.keys[0].value.clone();}});}
                                    if crate::print::read_expr(&read).replace("[id = ","[")==alias.replace("[id = ","["){continue;}
                                }
                            }
                            let columns=&catalog.tables[&table].columns;
                            let finite=|column:&str|match columns.get(column){
                                Some(ScalarType{kind:TypeKind::Bool,optional})=>{let mut xs=vec![Literal::Bool(false),Literal::Bool(true)];if *optional{xs.push(Literal::Null);}xs},
                                Some(ScalarType{kind:TypeKind::Enum{variants},optional})=>{let mut xs=variants.iter().cloned().map(Literal::Str).collect::<Vec<_>>();if *optional{xs.push(Literal::Null);}xs},
                                Some(ScalarType{kind:TypeKind::Time,optional:true})=>vec![Literal::Null,Literal::Number("$nonnull".into())],_=>Vec::new(),
                            };
                            if columns.keys().any(|column|{
                                let values=finite(column);!values.is_empty()&&!values.iter().any(|value|admitted(&job_path.body,&table,column,value,job_alias,&job_aliases)&&admitted(&path.body,&table,column,value,alias,&mutation_aliases))
                            }){continue;}
                            let states=finite(status).into_iter().filter(|state|admitted(&job_path.body,&table,status,state,job_alias,&job_aliases)&&admitted(&path.body,&table,status,state,alias,&mutation_aliases)).collect::<Vec<_>>();
                            if !states.is_empty()&&columns.iter().any(|(stamp,kind)|kind.optional&&matches!(kind.kind,TypeKind::Time)&&!admitted(&path.body,&table,stamp,&Literal::Null,alias,&mutation_aliases)&&states.iter().all(|state|super::advisory_model::nonnull_excludes(catalog,&table,stamp,status,state))){continue;}
                            let offset=time_comparison(comparison,&table,deadline,job_alias,&job_aliases,true).map(|(offset,_)|offset);
                            if let Some(offset)=offset{
                                let bounded=|state:Option<(&str,&Literal)>|{
                                    let due=path_time(&job_path.body,&table,deadline,job_alias,&job_aliases,true,offset,state);
                                    let allowed=path_time(&path.body,&table,deadline,alias,&mutation_aliases,false,offset,state);
                                    due!=7&&due&allowed==0
                                };
                                if if states.is_empty(){bounded(None)}else{states.iter().all(|value|bounded(Some((status.as_str(),value))))}{continue;}
                            }
                            let offset=offset.map(|n|n.to_string()).unwrap_or_else(||"unknown".into());
                            if !emitted.insert((mutation_name.clone(),table.clone(),deadline.clone(),status.clone())){continue;}
                            let relation=if direct{format!("tests {alias}.{status} (column {table}.{status}); scheduled job {job_name} has a literal update of that column")}
                                else{format!("tests {alias}.{status} and writes column {table}.{status}; scheduled job {job_name} also tests that column")};
                            notes.push(Diagnostic::new(&mutation.site,"N_SWEEP_DEADLINE",format!("mutation {mutation_name}: saw {relation} and `{}`; not proved: guards at {} exclude the sweep window for {alias}.{deadline} (column {table}.{deadline}, clock offset {offset}ms); sweep may lag; this is not a proof of safety",path.body.iter().filter_map(|s|if let Stmt::Require{condition,..}=s{Some(crate::print::expression(condition))}else{None}).collect::<BTreeSet<_>>().into_iter().collect::<Vec<_>>().join("; "),mutation.site),format!("if this is an operation deadline, enforce the intended time boundary on {alias}.{deadline} against now inside this mutation, choosing the opening/closing direction and equality boundary explicitly; keep the sweep for notifications/cleanup. Notification-only sweeps need no extra deadline guard")).guide("time"));
                        }
                    }
                }
            }
        }
    }
    notes
}
