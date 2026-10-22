//! Creation and transition risk questions, independent of authored invariants.
// @ref LLP 3000.036.004#162-narrow-gates-and-individual-dispositions — these gates demand review, never infer a specification.
use super::*;
use ast::{Expr, Stmt, WriteOp, ProgramKind, TypeKind};
use snapback4_core::schema::ColumnType;
fn note(out:&mut Vec<Diagnostic>,site:&Site,code:&str,message:String,repair:&str){out.push(Diagnostic::new(site,code,message,repair).guide("security"));}
fn walk(e:&Expr,mut f:impl FnMut(&Expr)){let mut e=e.clone();super::super::intent_walk::expression(&mut e,&mut |e|f(e));}
fn uses(e:&Expr,arg:&str)->bool{let mut found=false;walk(e,|e|if matches!(e,Expr::Name{name,..} if name==arg){found=true;});found}
fn conjunction(e:&Expr)->Vec<&Expr>{match e{Expr::Binary{op,left,right,..} if op=="and"=>conjunction(left).into_iter().chain(conjunction(right)).collect(),_=>vec![e]}}
fn conditions(p:&ast::ProgramDecl)->Vec<&Expr>{p.body.iter().filter_map(|s|if let Stmt::Require{condition,..}=s{Some(condition)}else{None}).collect()}
fn reads(e:&Expr)->BTreeSet<String>{let mut out=BTreeSet::new();walk(e,|e|match e{Expr::Read(r)|Expr::Exists{read:r,..}=>{out.insert(r.table.clone());},_=>{}});out}
fn nonnull(p:&ast::ProgramDecl,arg:&str)->bool{p.body.iter().filter_map(|s|if let Stmt::Require{condition,code,..}=s&&code!="$advice"{Some(condition)}else{None}).flat_map(conjunction).any(|e|match e{
    Expr::Binary{op,left,right,..} if op=="!="=>[(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].iter().any(|(a,b)|matches!(a,Expr::Name{name,..} if name==arg)&&matches!(b,Expr::Literal{value:ast::Literal::Null,..})),_=>false,
})}
fn field_value<'a>(f:&'a ast::ObjectField)->Option<&'a Expr>{f.value.as_ref()}
struct Write<'a>{p:&'a ast::ProgramDecl,op:WriteOp,table:String,fields:Vec<ast::ObjectField>,keys:Vec<ast::KeyPart>,site:Site,context:ast::ProgramDecl,gate:RuleExpr}
fn bound_role(bound:&Bound,catalog:&Catalog,info:&super::super::catalog::TableInfo,expr:&Expr,recipient:&str)->Option<RuleExpr>{
    let Expr::Exists{read,..}=expr else{return None;};
    // Bind a positive recipient probe after substituting only its principal.
    if !read.keys.iter().any(|k|matches!(&k.value,Expr::Name{name,..} if name==recipient)){return None;}
    let mut value=expr.clone();super::super::intent_walk::expression(&mut value,&mut |e|if let Expr::Name{name,site}=e{
        if name=="viewer"{*e=Expr::Literal{value:ast::Literal::Str("service:security-assigner-marker".into()),site:site.clone()};}
        else if name==recipient{*name="viewer".into();}
    });
    let rule=super::super::schema::bind_rule(catalog,info,&ast::RuleDecl{effect:ast::Effect::Read,bindings:Vec::new(),site:expr.site().clone(),value}).ok()?;
    let RuleExpr::Exists{table,index,key,equalities,..}=&rule else{return None;};
    let principal=super::privilege::global_principal(bound,table)?;
    let pairs=super::privilege::probe_pairs(bound,table,index,key,equalities);
    if !pairs.iter().any(|(c,v)|c==&principal&&*v==RuleTerm::Viewer){return None;}
    let roles=super::privilege::role_columns(bound,table);
    let equalities=pairs.into_iter().filter(|(c,v)|roles.contains(c)&&matches!(v,RuleTerm::Literal(snapback4_core::Value::String(_)))).collect::<Vec<_>>();
    if equalities.is_empty(){return None;}
    let index=bound.schema.tables[table].indexes.iter().find(|(_,i)|i.unique&&i.columns()==vec![principal.clone()])?.0.clone();
    Some(RuleExpr::Exists{table:table.clone(),index,key:vec![RuleTerm::Viewer],equalities,provenance:snapback4_core::ir::KeyProvenance::Computed})

}
pub(super) fn notes(sources:&[(String,String)],bound:&Bound)->Vec<Diagnostic>{
    let docs=sources.iter().map(|(file,text)|crate::parse_document(file,text).0).collect::<Vec<_>>();
    let catalog=Catalog::build(docs.clone(),&mut Vec::new());let mut writes=Vec::new();
    for p in docs.iter().flat_map(|d|&d.programs).filter(|p|p.kind==ProgramKind::Mutation){
        for (write,context) in super::authority_walk::writes(&catalog,p){
            let Expr::Write{op,table,fields,keys,site,..}=write else{continue;};
            let Some(info)=catalog.tables.get(&table)else{continue;};
            let mut requirements=super::operation::requirements(&catalog,info,&context);
            for condition in conditions(&context){let mut value=condition.clone();
                super::super::intent_walk::expression(&mut value,&mut |e|if let Expr::Member{base,..}=e&&reads(base).contains(&table){*base=Box::new(Expr::Focal{site:site.clone()});});
                if let Ok(rule)=super::super::schema::bind_rule(&catalog,info,&ast::RuleDecl{effect:ast::Effect::Read,bindings:Vec::new(),value,site:site.clone()}){requirements.push(rule);}
            }
            let t=&bound.schema.tables[&table];let rule=if op==WriteOp::Update{t.update_rule_judged().into_owned()}else{t.rules.insert.clone()};
            writes.push(Write{p,op,table,fields,keys,site,context,gate:RuleExpr::And(requirements.into_iter().chain([rule]).collect())});
        }
    }
    let mut out=Vec::new();let mut seen=BTreeSet::new();
    for w in &writes{
        let t=&bound.schema.tables[&w.table];let creating=matches!(w.op,WriteOp::Insert|WriteOp::Upsert);
        if creating{
            // Only unconditional requirements before the FIRST creating write
            // establish mandatory parent evidence; a conditional child's guard cannot.
            let creating_contexts=writes.iter().filter(|a|std::ptr::eq(a.p,w.p)&&matches!(a.op,WriteOp::Insert|WriteOp::Upsert)).collect::<Vec<_>>();
            for f in &w.fields{let Some(value)=field_value(f)else{continue;};let Some(kind)=t.columns.get(&f.name)else{continue;};
                for arg in &w.p.args{if !uses(value,&arg.name){continue;}
                    if arg.type_.optional&&matches!(arg.type_.kind,TypeKind::Image{..}|TypeKind::File{..})&&kind.contains_asset()&&!creating_contexts.iter().all(|a|nonnull(&a.context,&arg.name))&&seen.insert((w.p.name.clone(),format!("upload:{}",arg.name))){
                        note(&mut out,&w.site,"N_OPTIONAL_UPLOAD_CREATE",format!("{}: optional {} can omit media while creating {}; including conditional child evidence, does the spec require this upload?",w.p.name,arg.name,w.table),"make the creating mutation's upload argument required, or require it before creating the parent; intentional optionality needs an individual security disposition");
                    }
                    if f.name.to_lowercase().contains("reason")&&matches!(arg.type_.kind,TypeKind::Text{min:None|Some(0),..})&&seen.insert((w.p.name.clone(),format!("reason:{}",f.name))){
                        note(&mut out,&w.site,"N_CREATION_REASON",format!("{}: {}.{} accepts an empty/whitespace reason at creation",w.p.name,w.table,f.name),"if the workflow requires justification, use text 1..N (non-whitespace minimum), including on optional reasons when supplied");
                    }
                    let money=matches!(kind.required(),ColumnType::Money{..})||["price","charge","fee","amount"].iter().any(|word|f.name.to_lowercase().contains(word))&&matches!(kind.required(),ColumnType::Int|ColumnType::IntRange{..}|ColumnType::Decimal{..});
                    if money&&arg.type_.optional&&kind.is_optional()&&seen.insert((w.p.name.clone(),format!("money:{}",f.name))){note(&mut out,&w.site,"N_CREATION_MONEY",format!("{}: {}.{} permits omitted money at creation; is the required amount recorded?",w.p.name,w.table,f.name),"model the amount and require it at the workflow boundary when the spec requires payment or a price");}
                }
                if matches!(value,Expr::Literal{value:ast::Literal::Bool(true),..})&&["paid","approv","payment"].iter().any(|s|f.name.to_lowercase().contains(s)){
                    note(&mut out,&w.site,"N_CONSTANT_APPROVAL",format!("{}: {}.{} is stored as constant true; what verifies the payment/approval and its amount? (name-based question)",w.p.name,w.table,f.name),"record the required money/evidence and independently authorized decision; confirm constant flags against the spec");
                }
            }
        }
        // A global role plus viewer attribution does not model ownership of this resource.
        if w.op==WriteOp::Update&&w.fields.iter().any(|f|matches!(field_value(f),Some(Expr::Name{name,..}) if name=="viewer")&&matches!(t.columns.get(&f.name).map(ColumnType::required),Some(ColumnType::Principal))){
            let safe=RuleExpr::And(conditions(&w.context).into_iter().filter_map(|e|super::super::schema::bind_rule(&catalog,&catalog.tables[&w.table],&ast::RuleDecl{effect:ast::Effect::Read,bindings:Vec::new(),value:e.clone(),site:e.site().clone()}).ok()).filter(super::operation::safe).collect());
            let has_role=kernel::dependencies(&safe).iter().any(|dep|!super::privilege::role_columns(bound,dep).is_empty());
            let relationship=conditions(&w.context).iter().any(|e|conjunction(e).iter().any(|e|if let Expr::Binary{op,left,right,..}=e&&op=="="{
                [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].iter().any(|(a,b)|matches!(a,Expr::Name{name,..} if name=="viewer")&&matches!(b,Expr::Member{base,..} if same_target(base,w)))
            }else{false}));
            if has_role&&!relationship&&seen.insert((w.p.name.clone(),"wide-write".into())){note(&mut out,&w.site,"N_ROLE_WIDE_WRITE",format!("{}: may any admitted role write any {} row and record themselves? Does the spec mean owner of THIS resource?",w.p.name,w.table),"model the resource-to-owner principal/reference relationship and require it for this row; a global owner role is not ownership of every resource");}
        }
        // A grant's stored recipient, not its assigner, must have the role.
        if creating||w.op==WriteOp::Update{
            let mut recipient_fields=w.fields.iter().filter_map(|f|field_value(f).map(|v|(f.name.clone(),v.clone()))).collect::<BTreeMap<_,_>>();
            if w.op==WriteOp::Upsert{
                let read=ast::ReadExpr{cursor_prefix:None,computed:Default::default(),order_keys:Vec::new(),table:w.table.clone(),keys:w.keys.clone(),index:None,range:None,matching:None,filter:None,seeks:Vec::new(),site:w.site.clone()};
                if let Some(pins)=super::super::auth_lints::pins(&catalog,&read){for (column,value) in pins{recipient_fields.entry(column).or_insert(value);}}
            }
            for (column,value) in &recipient_fields{if !matches!(t.columns.get(column).map(ColumnType::required),Some(ColumnType::Principal)){continue;}
                let Expr::Name{name:recipient,..}=value else{continue;};
                if recipient=="viewer"||!w.p.args.iter().any(|a|a.name==*recipient&&matches!(a.type_.kind,TypeKind::Principal)){continue;}
                for condition in conditions(&w.context).into_iter().flat_map(conjunction){
                    let Some(role)=bound_role(bound,&catalog,&catalog.tables[&w.table],condition,recipient)else{continue;};
                    let RuleExpr::Exists{table:roster,index,key,equalities,..}=&role else{continue;};
                    let role_columns=super::privilege::role_columns(bound,roster);
                    if !super::lints::mutable_role(bound,roster)||!super::privilege::probe_pairs(bound,roster,index,key,equalities).iter().any(|(c,v)|role_columns.contains(c)&&matches!(v,RuleTerm::Literal(snapback4_core::Value::String(_)))){continue;}
                    for (name,target) in bound.schema.visible_tables(){
                        let mut audiences=target.rules.read.disjuncts().into_iter().map(|b|("read".to_string(),b.clone())).collect::<Vec<_>>();
                        for (column,rule) in &target.column_reads{for row in target.rules.read.disjuncts(){for cell in rule.disjuncts(){
                            let mut gates=vec![row.clone(),cell.clone()];
                            if let Some(owner)=target.written_by.get(column).filter(|o|!o.audience){gates.push(RuleExpr::Eq(RuleTerm::Field(owner.owner.clone()),RuleTerm::Viewer));}
                            audiences.push((format!("{column} read"),RuleExpr::And(gates)));
                        }}}
                        for (effect,branch) in &audiences{
                        let trusts=positive_probes(branch).iter().any(|probe|if let RuleExpr::Exists{table,index,key,..}=probe{table==&w.table&&bound.schema.tables[table].index(index).is_some_and(|idx|idx.components.iter().zip(key).any(|(component,v)|component.column()==Some(column)&&*v==RuleTerm::Viewer))}else{false});
                        if trusts&&kernel::implies(branch,&role)!=Ok(true)&&seen.insert((name.clone(),format!("grant:{}:{}",w.table,role.quarry()))){note(&mut out,&Site::default(),"N_RETAINED_ROLE_GRANT",format!("{name}.{effect}: retained {} grants are written by {} requiring recipient `{}`, but read branch `{}` does not recheck that mutable current role",w.table,w.p.name,role.quarry(),branch.quarry()),"conjoin the current recipient role at read time, or revoke derived grants on every role change; individually acknowledge intentional retained authority");}
                    }}
                }
            }
        }
    }
    transition_notes(bound,&catalog,&writes,&mut out);
    duration_notes(&writes,&mut out);
    let mut dedup=BTreeSet::new();out.retain(|n|dedup.insert((n.code.clone(),n.message.clone())));out
}
fn same_target(base:&Expr,w:&Write<'_>)->bool{match base{
    Expr::Assert{value,..}=>same_target(value,w),
    Expr::Read(read)=>read.table==w.table&&read.keys.len()==w.keys.len()&&read.keys.iter().zip(&w.keys).all(|(a,b)|a.column==b.column&&crate::print::expression(&a.value)==crate::print::expression(&b.value)),
    _=>false,
}}
fn positive_probes(rule:&RuleExpr)->Vec<&RuleExpr>{match rule{RuleExpr::And(xs)=>xs.iter().flat_map(positive_probes).collect(),RuleExpr::Exists{..}=>vec![rule],_=>vec![]}}
fn transition_notes(bound:&Bound,_catalog:&Catalog,writes:&[Write<'_>],out:&mut Vec<Diagnostic>){
    for w in writes{let t=&bound.schema.tables[&w.table];
        if w.op==WriteOp::Update{for f in &w.fields{
            let Some(ColumnType::Enum{..})=t.columns.get(&f.name).map(ColumnType::required)else{continue;};
            let Some(Expr::Name{name,..})=field_value(f)else{continue;};
            let Some(arg)=w.p.args.iter().find(|a|a.name==*name)else{continue;};let TypeKind::Enum{variants}=&arg.type_.kind else{continue;};
            for other in writes.iter().filter(|o|o.op==WriteOp::Update&&o.table==w.table&&o.p.name!=w.p.name){
                let mut targets=BTreeSet::new();for g in other.fields.iter().filter(|g|g.name==f.name){if let Some(value)=field_value(g){walk(value,|e|if let Expr::Literal{value:ast::Literal::Str(v),..}=e{targets.insert(v.clone());});}}
                for target in &targets{
                    if variants.contains(target)&&!conditions(&w.context).iter().any(|e|super::lints::argument_guard(e,name,target)==Some(false))&&kernel::implies(&w.gate,&other.gate)==Ok(false){note(out,&w.site,"N_TRANSITION_BYPASS",format!("{}: generic {}.{} setter includes '{target}', also set by stricter {} ({})",w.p.name,w.table,f.name,other.p.name,other.gate.quarry()),"enforce the decision's authority on every path reaching this status; declare independent transition/column update intent and run test");}
                }
            }
        }}
        if !matches!(w.op,WriteOp::Insert|WriteOp::Upsert){continue;}
        let deps=conditions(&w.context).iter().flat_map(|e|reads(e)).filter(|dep|dep!=&w.table&&super::privilege::role_columns(bound,dep).is_empty()&&writes.iter().any(|o|&o.table==dep&&o.op!=WriteOp::Insert)).collect::<BTreeSet<_>>();
        for dep in deps{for later in writes.iter().filter(|o|o.p.name!=w.p.name&&(o.table==w.table&&o.op==WriteOp::Update||bound.schema.tables[&o.table].columns.values().any(|k|matches!(k.required(),ColumnType::Ref{table} if table==&w.table)))){
            if conditions(&later.context).iter().any(|e|reads(e).contains(&dep)){continue;}
            note(out,&later.site,"N_STALE_CREATION_CHECK",format!("{}: {} creation by {} checks mutable {dep}, but this later {} write does not recheck it",later.p.name,w.table,w.p.name,later.table),"if eligibility must remain current at approval/transition, recheck it there; declare independent intent and test a create -> eligibility change -> approval history");
        }}
    }
}

fn duration_number(e:&Expr)->Option<i64>{
    let Expr::Literal{value:ast::Literal::Number(s),..}=e else{return None;};
    for (suffix,scale) in [("ms",1),("s",1000),("m",60_000),("h",3_600_000),("d",86_400_000)]{
        if let Some(n)=s.strip_suffix(suffix){return n.parse::<i64>().ok()?.checked_mul(scale);}
    }s.parse().ok()
}
fn duration_notes(writes:&[Write<'_>],out:&mut Vec<Diagnostic>){
    let mut bounds=BTreeMap::<(String,String,String),BTreeMap<i64,BTreeSet<String>>>::new();
    let mut sites=BTreeMap::new();
    for w in writes{for condition in conditions(&w.context){walk(condition,|e|{
        let Expr::Binary{op,left,right,..}=e else{return;};if !matches!(op.as_str(),">"|">="|"<"|"<="){return;}
        for (field,clock,cmp) in [(left.as_ref(),right.as_ref(),op.as_str()),(right.as_ref(),left.as_ref(),match op.as_str(){">"=>"<",">="=>"<=","<"=>">",_=>">="})]{
            let Expr::Binary{op:offset,left:now,right:amount,..}=clock else{continue;};
            if !matches!(now.as_ref(),Expr::Name{name,..} if name=="now")||!matches!(offset.as_str(),"-"|"+"){continue;}
            let Some(mut duration)=duration_number(amount)else{continue;};if offset=="-"{duration=-duration;}
            let target=match field{
                Expr::Member{base,name,..}=>reads(base).into_iter().next().map(|table|(table,name.clone())),
                Expr::Name{name,..}=>writes.iter().filter(|a|a.p.name==w.p.name).find_map(|a|a.fields.iter().find(|f|field_value(f).is_some_and(|e|matches!(e,Expr::Name{name:n,..} if n==name))).map(|f|(a.table.clone(),f.name.clone()))),_=>None,
            };
            if let Some((table,column))=target{let key=(table,column,cmp.to_string());sites.entry(key.clone()).or_insert_with(||w.site.clone());bounds.entry(key).or_default().entry(duration).or_default().insert(w.p.name.clone());}
        }
    });}}
    for ((table,column,cmp),values) in bounds{if values.len()<2{continue;}
        let entries=values.iter().map(|(ms,ops)|format!("now {ms:+}ms in {}",ops.iter().cloned().collect::<Vec<_>>().join(", "))).collect::<Vec<_>>().join("; ");
        note(out,&sites[&(table.clone(),column.clone(),cmp.clone())],"N_DURATION_BOUNDS",format!("{table}.{column}: inconsistent `{cmp}` duration bounds across operations: {entries}; are these different windows intentional?"),"use the specification's duration consistently at creation, renewal and approval, or document the deliberate workflow difference");
    }
}
