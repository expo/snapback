//! Source questions about moving a stored window anchor or testing booking time.
// @ref LLP 3000.036.004.001#sec13-required-evidence-and-time-anchors — typed source facts ask about intent; they confer no authority.
use super::*;
use ast::{Expr, Stmt, ProgramKind, WriteOp};
use snapback4_core::schema::{ColumnType, Constraint};

fn walk(e:&Expr,mut f:impl FnMut(&Expr)) {let mut e=e.clone();super::super::intent_walk::expression(&mut e,&mut |e|f(e));}
fn bare(mut e:&Expr)->&Expr {while let Expr::Assert{value,..}=e {e=value;}e}
fn row<'a>(e:&'a Expr,bound:&'a Bound)->Option<&'a str> {match bare(e) {
    Expr::Read(r)=>Some(&r.table),
    Expr::Member{base,name,..}=>{let table=row(base,bound)?;match bound.schema.table(table)?.columns.get(name)?.required(){ColumnType::Ref{table}=>Some(table.as_str()),_=>None}},
    _=>None,
}}
fn anchor(e:&Expr,bound:&Bound)->Option<(String,String,Expr)> {
    match bare(e) {
        Expr::Member{base,name,..} if row(base,bound).is_some_and(|t|bound.schema.table(t).and_then(|t|t.columns.get(name)).is_some_and(|k|matches!(k.required(),ColumnType::Time)))=>Some((row(base,bound)?.into(),name.clone(),*base.clone())),
        Expr::Binary{op,left,right,..} if matches!(op.as_str(),"+"|"-")&&matches!(right.as_ref(),Expr::Literal{value:ast::Literal::Number(_),..})=>anchor(left,bound),
        Expr::Binary{op,left,right,..} if op=="+"&&matches!(left.as_ref(),Expr::Literal{value:ast::Literal::Number(_),..})=>anchor(right,bound),
        _=>None,
    }
}
fn offset(e:&Expr)->bool {matches!(e,Expr::Binary{op,..} if matches!(op.as_str(),"+"|"-"))}
fn clock(e:&Expr)->bool {matches!(e,Expr::Name{name,..} if name=="now")}
fn comparisons(e:&Expr,out:&mut Vec<Expr>) {walk(e,|e|if matches!(e,Expr::Binary{op,..} if matches!(op.as_str(),"<"|"<="|">"|">="|"=")){out.push(e.clone());});}
// This survey records source comparisons, including conditions that select a
// fee. Branches have independent environments; none becomes a proof fact.
fn guards(body:&[Stmt],env:&mut BTreeMap<String,Expr>,out:&mut Vec<Expr>) {
    for stmt in body {match stmt {
        Stmt::Bind{names,value,..}=>{let value=super::authority_walk::resolve(value,env);if names.len()==1{env.insert(names[0].clone(),value);}},
        Stmt::Require{condition,..}|Stmt::Expr{value:condition,..}|Stmt::Return{value:condition,..}=>comparisons(&super::authority_walk::resolve(condition,env),out),
        Stmt::If{condition,then_body,else_body,..}=>{comparisons(&super::authority_walk::resolve(condition,env),out);guards(then_body,&mut env.clone(),out);guards(else_body,&mut env.clone(),out);},
        Stmt::For{body,..}|Stmt::As{body,..}=>guards(body,&mut env.clone(),out),_=>{},
    }}
}
fn same_value(e:&Expr,base:&Expr,column:&str)->bool {
    matches!(bare(e),Expr::Member{base:b,name,..} if name==column&&crate::print::expression(bare(b))==crate::print::expression(bare(base)))
}
fn required_parts(e:&Expr,out:&mut Vec<Expr>) {match e {
    Expr::Binary{op,left,right,..} if op=="and"=>{required_parts(left,out);required_parts(right,out);},
    _=>out.push(e.clone()),
}}
fn requirements(context:&ast::ProgramDecl)->Vec<Expr> {let mut out=Vec::new();for s in &context.body {if let Stmt::Require{condition,..}=s {required_parts(condition,&mut out);}}out}
fn no_dependents(context:&ast::ProgramDecl,dependent:&str,parent:&str,keys:&[ast::KeyPart],bound:&Bound)->bool {
    requirements(context).iter().any(|e|{
        let Expr::Unary{op,value,..}=e else{return false;};if op!="not"{return false;}
        let Expr::Exists{read,..}=value.as_ref() else{return false;};
        read.table==dependent&&read.keys.len()==1&&read.filter.is_none()&&read.range.is_none()&&read.matching.is_none()&&read.seeks.is_empty()&&read.computed.is_empty()&&read.keys.iter().any(|key|bound.schema.table(dependent).is_some_and(|t|t.columns.iter().any(|(column,kind)|matches!(kind.required(),ColumnType::Ref{table} if table==parent)&&(key.column.as_ref()==Some(column)||key.column.is_none()&&t.indexes.values().any(|i|i.unique&&i.columns()==vec![column.clone()]))))&&keys.len()==1&&crate::print::expression(&key.value)==crate::print::expression(&keys[0].value))
    })
}

pub struct Question {pub note:Diagnostic,pub invariant:String,pub column:String}
pub fn candidates(sources:&[(String,String)],bound:&Bound)->Vec<Question> {
    let docs=sources.iter().map(|(f,s)|crate::parse_document(f,s).0).collect::<Vec<_>>();
    let catalog=Catalog::build(docs.clone(),&mut Vec::new());analyze(&docs,&catalog,bound)
}
pub(super) fn notes(documents:&[ast::Document],catalog:&Catalog,bound:&Bound)->Vec<Diagnostic> {analyze(documents,catalog,bound).into_iter().map(|q|q.note).collect()}
fn analyze(documents:&[ast::Document],catalog:&Catalog,bound:&Bound)->Vec<Question> {
    let programs=documents.iter().flat_map(|d|&d.programs).filter(|p|p.kind==ProgramKind::Mutation).collect::<Vec<_>>();
    let comparisons=programs.iter().map(|p|{let mut out=Vec::new();let mut env=BTreeMap::new();guards(&p.prelude,&mut env,&mut out);guards(&p.body,&mut env,&mut out);out}).collect::<Vec<_>>();
    let writes=programs.iter().map(|p|super::authority_walk::writes(catalog,p)).collect::<Vec<_>>();
    let mut out=Vec::new();let mut seen=BTreeSet::new();
    for (index,p) in programs.iter().enumerate() {for comparison in &comparisons[index] {
        let Expr::Binary{left,right,..}=comparison else{continue;};
        for (event,edge) in [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())] {
            if !offset(edge){continue;}
            let Some((table,column,base))=anchor(edge,bound)else{continue;};
            let Some(t)=bound.schema.table(&table)else{continue;};
            let dependent=writes[index].iter().filter_map(|(e,_)|if let Expr::Write{table,..}=e{Some(table.as_str())}else{None}).collect::<BTreeSet<_>>();
            if !t.constraints.iter().any(|c|matches!(c,Constraint::Immutable{fields} if fields.contains(&column))) {
                for (editor,sites) in programs.iter().zip(&writes) {for (write,context) in sites {
                    let Expr::Write{table:target,op:WriteOp::Update|WriteOp::Upsert,fields,keys,site,..}=write else{continue;};
                    if target!=&table{continue;}
                    let Some(field)=fields.iter().find(|f|f.name==column)else{continue;};
                    let value=field.value.clone().unwrap_or(Expr::Name{name:column.clone(),site:field.site.clone()});
                    if same_value(&value,&base,&column)&&super::derived::same_resource(&base,&table,keys,context){continue;}
                    if !dependent.is_empty()&&dependent.iter().all(|d|*d!=table&&no_dependents(context,d,&table,keys,bound)){continue;}
                    if seen.insert(("mutable",editor.name.clone(),table.clone(),column.clone(),String::new())) {
                        out.push(Question{invariant:format!("invariant {table}.{} only deny",editor.name),column:column.clone(),note:Diagnostic::new(site,"N_MOVABLE_TIME_ANCHOR",format!("{}: the window in {} is measured from {table}.{column}, which {} can move; should edits re-check the window or preserve an immutable original anchor? Observed guard: {}",editor.name,p.name,editor.name,crate::print::expression(comparison)),"preserve the original date in an immutable field, prevent anchor edits after dependent records exist, or validate affected windows against the edited date; record deliberate rolling-window intent with check --ack-security ID --reason '<spec rationale>'").guide("security")});
                    }
                }}
            }
            if !clock(event){continue;}
            for (write,_) in &writes[index] {let Expr::Write{table:target,fields,site,..}=write else{continue;};
                for field in fields {
                    if !bound.schema.table(target).and_then(|t|t.columns.get(&field.name)).is_some_and(|k|matches!(k.required(),ColumnType::Time)){continue;}
                    let Some(value)=&field.value else{continue;};
                    let Expr::Name{name,..}=value else{continue;};
                    if !p.args.iter().any(|a|a.name==*name&&matches!(a.type_.kind,ast::TypeKind::Time)){continue;}
                    let mut expected=comparison.clone();super::super::intent_walk::expression(&mut expected,&mut |e|if clock(e){*e=value.clone();});
                    if seen.insert(("event",p.name.clone(),target.clone(),field.name.clone(),crate::print::expression(comparison))) {
                        // Re-express the observed branch predicate over the inserted row.
                        // Only directly stored arguments can replace caller variables.
                        let mut predicate=Expr::Binary{op:"or".into(),left:Box::new(Expr::Unary{op:"not".into(),value:Box::new(comparison.clone()),site:site.clone()}),right:Box::new(expected.clone()),site:site.clone()};
                        super::super::intent_walk::expression(&mut predicate,&mut |e|if let Expr::Assert{value,..}=e{*e=*value.clone();});
                        super::super::intent_walk::expression(&mut predicate,&mut |e|if let Expr::Name{name,site}=e&&let Some(f)=fields.iter().find(|f|matches!(&f.value,Some(Expr::Name{name:n,..}) if n==name)) { *e=Expr::Member{base:Box::new(Expr::Focal{site:site.clone()}),name:f.name.clone(),site:site.clone()}; });
                        name_point_keys(&mut predicate,&bound.schema,target);
                        out.push(Question{invariant:format!("invariant {target}.{} only {}",p.name,crate::print::expression(&predicate)),column:field.name.clone(),note:Diagnostic::new(site,"N_EVENT_TIME_ANCHOR",format!("{}: the guard uses now against {table}.{column}, while {target}.{} stores caller event time {name}; should that event time satisfy the window instead? Observed guard: {}",p.name,field.name,crate::print::expression(comparison)),"check the event time against the stored anchor at the boundary that selects this effect; keep now when the specification deliberately measures booking time; record the intended anchor with check --ack-security ID --reason '<spec rationale>'").guide("security")});
                    }
                }
            }
        }
    }}out
}

/// Source-literal inputs for event-window questions, within the caller's existing
/// work reservation. No program, rule, fixture row or validation is rewritten.
pub fn configure_campaign(bound:&Bound,questions:&[Question],campaign:&mut challenges::Campaign) {
    use snapback4_core::{Value,ir::ArgType};
    let operations=questions.iter().filter(|q|q.note.code=="N_EVENT_TIME_ANCHOR").filter_map(|q|q.invariant.split_whitespace().nth(1).and_then(|s|s.split_once('.')).map(|(_,op)|op)).collect::<BTreeSet<_>>();
    if operations.is_empty(){return;}
    let mut clocks=vec![Value::Int(challenges::NOW),Value::Int(challenges::NOW+1)];
    fn literals(value:&serde_json::Value,out:&mut BTreeSet<i64>){
        if let Some(n)=value.get("Literal").and_then(|v|v.get("Int")).and_then(|v|v.as_i64()){out.insert(n);}
        match value{serde_json::Value::Object(v)=>for x in v.values(){literals(x,out)},serde_json::Value::Array(v)=>for x in v{literals(x,out)},_=>{}}
    }
    for p in bound.programs.iter().filter(|p|operations.contains(p.program.name.as_str())) {
        let mut numbers=BTreeSet::new();literals(&serde_json::to_value(&p.program).unwrap(),&mut numbers);
        for (name,kind) in &p.program.args {
            let values=numbers.iter().rev().filter(|n|match kind{ArgType::Int=>true,ArgType::IntRange{min,max}=>*min<=**n&&**n<=*max,_=>false}).take(16).map(|n|Value::Int(*n)).collect::<Vec<_>>();
            if !values.is_empty(){campaign.question_arguments.insert((p.program.name.clone(),name.clone()),values);}
        }
        for n in numbers.into_iter().filter(|n|*n>=86_400_000).take(6) {for delta in [1,0] {if let Some(time)=challenges::NOW.checked_add(n).and_then(|t|t.checked_add(delta)){let value=Value::Int(time);if !clocks.contains(&value){clocks.push(value);}}}}
    }
    clocks.truncate(16);
    for p in bound.programs.iter().filter(|p|operations.contains(p.program.name.as_str())) {for (name,kind) in &p.program.args {if matches!(kind,ArgType::Time){campaign.question_arguments.insert((p.program.name.clone(),name.clone()),clocks.clone());}}}
}

fn name_point_keys(expression:&mut Expr,schema:&Schema,focal:&str) {
    fn owner<'a>(e:&'a Expr,schema:&'a Schema,focal:&'a str)->Option<&'a str>{match e {
        Expr::Focal{..}=>Some(focal),Expr::Read(r)=>Some(&r.table),
        Expr::Member{base,name,..}=>{let t=schema.table(owner(base,schema,focal)?)?;match t.columns.get(name)?.required(){ColumnType::Ref{table}=>Some(table),_=>None}},_=>None,
    }}
    super::super::intent_walk::expression(expression,&mut |e|if let Expr::Read(read)=e&&read.keys.iter().any(|k|k.column.is_none())&&let Some(t)=schema.table(&read.table){
        let choices=t.indexes.values().filter(|i|i.unique&&i.is_plain()&&i.columns().len()==read.keys.len()).filter_map(|i|{
            let columns=i.columns();
            read.keys.iter().zip(&columns).all(|(key,column)|{
                if let Some(named)=&key.column{return named==column;}
                let Expr::Member{base,name,..}=&key.value else{return false;};
                let Some(actual)=owner(base,schema,focal).and_then(|o|schema.table(o)).and_then(|t|t.columns.get(name))else{return false;};
                match (t.columns[column].required(),actual.required()) {
                    (ColumnType::Id,ColumnType::Ref{table})=>table==&read.table,
                    (a,b)=>a==b,
                }
            }).then_some(columns)
        }).collect::<BTreeSet<_>>();
        if choices.len()==1{for (key,column) in read.keys.iter_mut().zip(choices.into_iter().next().unwrap()){key.column=Some(column);}}
    });
}

/// The directed eight-tuple frontier otherwise correlates an interior fee with
/// only an early event date. Prioritize source-literal/event pairs and retain
/// the first already role-prioritized identity/asset tuple for each pair.
pub(super) fn prioritize_cases(program:&snapback4_core::ir::Program,cases:&mut Vec<BTreeMap<String,snapback4_core::Value>>,campaign:&mut challenges::Campaign)->bool {
    use snapback4_core::{Value,ir::ArgType};
    let mut priorities=BTreeMap::<String,Vec<Value>>::new();
    for ((operation,name),values) in &campaign.question_arguments {if operation==&program.name {
        let mut values=values.clone();
        match program.args.get(name) {
            Some(ArgType::Time)=>values.sort_by(|a,b|b.as_int().ok().cmp(&a.as_int().ok())),
            Some(ArgType::IntRange{min,max})=>values.sort_by_key(|v|match v{Value::Int(n)=>(*n==*min||*n==*max,std::cmp::Reverse(*n)),_=>(true,std::cmp::Reverse(0))}),
            _=>{},
        }
        priorities.insert(name.clone(),values);
    }}
    if !priorities.keys().any(|name|matches!(program.args.get(name),Some(ArgType::Time))){return false;}
    cases.sort_by_cached_key(|args|priorities.iter().map(|(name,values)|values.iter().position(|v|args.get(name)==Some(v)).unwrap_or(values.len())).collect::<Vec<_>>());
    let mut seen=BTreeSet::new();cases.retain(|args|seen.insert(priorities.keys().map(|name|args.get(name).map(|v|serde_json::to_string(v).unwrap())).collect::<Vec<_>>()));
    campaign.unsupported.insert(format!("{}: event-window directed proposals retain one role-prioritized identity/asset tuple per source numeric/time pair; other combinations remain uncovered",program.name));true
}
