//! Creation and transition risk questions, independent of authored invariants.
// @ref LLP 3000.036.004#162-narrow-gates-and-individual-dispositions — these gates demand review, never infer a specification.
use super::*;
use ast::{Expr, Stmt, WriteOp, ProgramKind, TypeKind};
use snapback4_core::schema::ColumnType;
mod eligibility;
fn note(out:&mut Vec<Diagnostic>,site:&Site,code:&str,message:String,repair:&str){out.push(Diagnostic::new(site,code,message,repair).guide("security"));}
fn walk(e:&Expr,mut f:impl FnMut(&Expr)){let mut e=e.clone();super::super::intent_walk::expression(&mut e,&mut |e|f(e));}
fn uses(e:&Expr,arg:&str)->bool{let mut found=false;walk(e,|e|if matches!(e,Expr::Name{name,..} if name==arg){found=true;});found}
fn conjunction(e:&Expr)->Vec<&Expr>{match e{Expr::Binary{op,left,right,..} if op=="and"=>conjunction(left).into_iter().chain(conjunction(right)).collect(),_=>vec![e]}}
fn conditions(p:&ast::ProgramDecl)->Vec<&Expr>{p.body.iter().filter_map(|s|if let Stmt::Require{condition,..}=s{Some(condition)}else{None}).collect()}
fn reads(e:&Expr)->BTreeSet<String>{let mut out=BTreeSet::new();walk(e,|e|match e{Expr::Read(r)|Expr::Exists{read:r,..}=>{out.insert(r.table.clone());},_=>{}});out}
fn nonnull(p:&ast::ProgramDecl,arg:&str)->bool{nonnull_mode(p,arg,false)}
fn nonnull_mode(p:&ast::ProgramDecl,arg:&str,branches:bool)->bool{p.body.iter().filter_map(|s|if let Stmt::Require{condition,code,..}=s&&(branches||code!="$advice"){Some(condition)}else{None}).flat_map(conjunction).any(|e|match e{
    Expr::Binary{op,left,right,..} if op=="!="=>[(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].iter().any(|(a,b)|matches!(a,Expr::Name{name,..} if name==arg)&&matches!(b,Expr::Literal{value:ast::Literal::Null,..})),_=>false,
})}
fn field_value<'a>(f:&'a ast::ObjectField)->Option<&'a Expr>{f.value.as_ref()}
struct Write<'a>{p:&'a ast::ProgramDecl,op:WriteOp,table:String,fields:Vec<ast::ObjectField>,keys:Vec<ast::KeyPart>,site:Site,context:ast::ProgramDecl,gate:RuleExpr,conditional:bool}
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
            let Expr::Write{op,table,fields,keys,site,if_absent,condition}=write else{continue;};
            let Some(info)=catalog.tables.get(&table)else{continue;};
            let mut requirements=super::operation::requirements(&catalog,info,&context);
            for condition in conditions(&context){let mut value=condition.clone();
                super::super::intent_walk::expression(&mut value,&mut |e|if let Expr::Member{base,..}=e&&reads(base).contains(&table){*base=Box::new(Expr::Focal{site:site.clone()});});
                if let Ok(rule)=super::super::schema::bind_rule(&catalog,info,&ast::RuleDecl{effect:ast::Effect::Read,bindings:Vec::new(),value,site:site.clone()}){requirements.push(rule);}
            }
            let t=&bound.schema.tables[&table];let rule=if op==WriteOp::Update{t.update_rule_judged().into_owned()}else{t.rules.insert.clone()};
            writes.push(Write{p,op,table,fields,keys,site,context,conditional:if_absent||condition.is_some(),gate:RuleExpr::And(requirements.into_iter().chain([rule]).collect())});
        }
    }
    // @ref LLP 3000.036.004#168-typed-upsert-key-binding — reuse checked type-directed selection.
    let mut write_indexes=BTreeMap::<(String,String),BTreeSet<String>>::new();
    for site in bound.programs.iter().flat_map(|p|snapback4_core::ir::read_sites(&p.program)).filter(|s|s.kind=="write target"){
        write_indexes.entry((site.table,site.site)).or_default().insert(site.index);
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
                    let parent_required=mandatory_parent_for(bound,w,&writes);
                    let omittable_attachment=nonnull_mode(&w.context,&arg.name,true)&&!parent_required;
                    if arg.type_.optional&&matches!(arg.type_.kind,TypeKind::Image{..}|TypeKind::File{..})&&kind.contains_asset()&&required_media(bound,&w.table,&f.name)&&!omittable_attachment&&!creating_contexts.iter().all(|a|nonnull(&a.context,&arg.name))&&seen.insert((w.p.name.clone(),format!("upload:{}",arg.name))){
                        note(&mut out,&w.site,"N_OPTIONAL_UPLOAD_CREATE",format!("{}: optional {} can omit media while creating {}; a required media column or explicit non-null intent requires it; can parent creation skip required evidence?",w.p.name,arg.name,w.table),"make the creating mutation's upload argument required, or require it before creating the parent; match the required column/intent at creation; review an intentional exception individually");
                    }
                    if arg.type_.optional&&matches!(arg.type_.kind,TypeKind::Image{..}|TypeKind::File{..})&&kind.contains_asset()&&omittable_attachment&&creating_contexts.iter().any(|p|p.table!=w.table)&&seen.insert((w.p.name.clone(),format!("attachment:{}",arg.name))){
                        note(&mut out,&w.site,"N_OPTIONAL_EVIDENCE",format!("{}: optional {} conditionally creates {} evidence beside a parent; is that evidence optional in the specification? A required child field does not require a child row.",w.p.name,arg.name,w.table),"keep intentional optional attachments optional; if parent evidence is mandatory, declare independent parent integrity intent and require the upload before parent creation");
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
                // The planner resolves overloaded positional keys by type. Reusing
                // that selected index avoids guessing from declared arity alone.
                let index=write_indexes.get(&(w.table.clone(),w.site.to_string())).filter(|names|names.len()==1).and_then(|names|names.first()).and_then(|name|t.index(name));
                let pins=if let Some(index)=index{
                    Some(w.keys.iter().zip(index.columns()).map(|(key,column)|(key.column.clone().unwrap_or(column),key.value.clone())).collect::<BTreeMap<_,_>>())
                }else{
                    let read=ast::ReadExpr{cursor_prefix:None,computed:Default::default(),order_keys:Vec::new(),table:w.table.clone(),keys:w.keys.clone(),index:None,range:None,matching:None,filter:None,seeks:Vec::new(),site:w.site.clone()};
                    super::super::auth_lints::pins(&catalog,&read)
                };
                if let Some(pins)=pins{for (column,value) in pins{recipient_fields.entry(column).or_insert(value);}}
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
    stale_notes(bound,&writes,&mut out);
    evidence_notes(bound,&writes,&mut out);
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

// @ref LLP 3000.036.004#169-day-two-precision-and-destructive-evidence-questions — optionality alone is not mandatory evidence.
fn conjuncts(rule:&RuleExpr)->Vec<&RuleExpr>{match rule{RuleExpr::And(xs)=>xs.iter().flat_map(conjuncts).collect(),_=>vec![rule]}}
fn required_media(bound:&Bound,table:&str,column:&str)->bool{
    fn nonnull(rule:&RuleExpr,column:&str)->bool{
        let pair=match rule{RuleExpr::Ne(a,b)=>Some((a,b)),RuleExpr::Not(r)=>if let RuleExpr::Eq(a,b)=r.as_ref(){Some((a,b))}else{None},_=>None};
        pair.is_some_and(|(a,b)|[(a,b),(b,a)].iter().any(|(a,b)|matches!(a,RuleTerm::Field(c) if c==column)&&matches!(b,RuleTerm::Literal(snapback4_core::Value::Null))))
    }
    fn mandatory(kind:&ColumnType)->bool{match kind{ColumnType::Image{..}|ColumnType::File{..}|ColumnType::Video{..}=>true,ColumnType::ListRange{of,min,..}=>*min>0&&mandatory(of),_=>false}}
    mandatory(&bound.schema.tables[table].columns[column])||bound.invariants.iter().filter(|i|i.table==table&&i.target=="always").filter_map(|i|i.policy.as_ref()).flat_map(conjuncts).any(|r|nonnull(r,column))
}
fn approves(w:&Write<'_>,bound:&Bound)->bool{
    w.fields.iter().any(|f|match field_value(f){
        Some(Expr::Literal{value:ast::Literal::Str(v),..})=>matches!(bound.schema.tables[&w.table].columns.get(&f.name).map(ColumnType::required),Some(ColumnType::Enum{..}))&&["approved","accepted","authorized","granted","issued","active","confirmed","paid","signed"].contains(&v.as_str()),
        Some(Expr::Literal{value:ast::Literal::Bool(true),..})=>["approv","authoriz"].iter().any(|part|f.name.to_lowercase().contains(part)),_=>false,
    })
}
fn stale_notes(bound:&Bound,writes:&[Write<'_>],out:&mut Vec<Diagnostic>){
    let mut groups=BTreeMap::<(String,String),(Site,BTreeSet<String>,BTreeSet<String>,BTreeSet<String>)>::new();
    for w in writes.iter().filter(|w|matches!(w.op,WriteOp::Insert|WriteOp::Upsert)){
        let dependencies=eligibility::checks(bound,w,w,writes,true);
        for (dep,checks) in dependencies{
            let columns=checks.iter().map(|(c,_)|c.clone()).collect::<BTreeSet<_>>();for later in writes.iter().filter(|o|o.p.name!=w.p.name&&approves(o,bound)&&(o.table==w.table&&o.op==WriteOp::Update||matches!(o.op,WriteOp::Insert|WriteOp::Upsert)&&bound.schema.tables[&o.table].columns.values().any(|k|matches!(k.required(),ColumnType::Ref{table} if table==&w.table)))){
            let rechecked=eligibility::checks(bound,w,later,writes,false);
            if rechecked.get(&dep).is_some_and(|current|checks.is_subset(current)){continue;}
            let g=groups.entry((w.table.clone(),dep.clone())).or_insert_with(||(later.site.clone(),BTreeSet::new(),BTreeSet::new(),BTreeSet::new()));
            if (&later.site.file,later.site.line,later.site.col)<(&g.0.file,g.0.line,g.0.col){g.0=later.site.clone();}
            g.1.insert(format!("{} at {}",w.p.name,w.site));g.2.insert(format!("{} at {}",later.p.name,later.site));g.3.extend(columns.clone());
        }}
    }
    for ((table,dep),(site,creators,decisions,columns)) in groups{note(out,&site,"N_STALE_CREATION_CHECK",format!("{table}: creation by {} checks mutable {dep}.{}, but approval/activation {} does not recheck every column for the same applicant/resource",creators.into_iter().collect::<Vec<_>>().join(", "),columns.into_iter().collect::<Vec<_>>().join(","),decisions.into_iter().collect::<Vec<_>>().join(", ")),"decide whether eligibility must remain current at this decision; recheck it or declare independent intent and test create -> eligibility change -> approval");}
}
fn evidence_notes(bound:&Bound,writes:&[Write<'_>],out:&mut Vec<Diagnostic>){
    for (child,t) in bound.schema.visible_tables(){
        let media=t.columns.iter().filter(|(c,k)|k.contains_asset()&&required_media(bound,child,c)).map(|(c,_)|c.clone()).collect::<Vec<_>>();if media.is_empty(){continue;}
        for (reference,kind) in &t.columns{let ColumnType::Ref{table:parent}=kind.required()else{continue;};
            let declared=required_child(bound,parent,child,reference);
            let created_together=writes.iter().any(|w|w.table==*child&&matches!(w.op,WriteOp::Insert|WriteOp::Upsert)&&writes.iter().any(|p|std::ptr::eq(p.p,w.p)&&p.table==*parent&&matches!(p.op,WriteOp::Insert|WriteOp::Upsert)&&w.fields.iter().find(|f|&f.name==reference).and_then(field_value).is_some_and(|e|matches!(e,Expr::Member{base,name,..} if name=="id"&&matches!(base.as_ref(),Expr::Write{table,site,..} if table==parent&&site==&p.site))))&&media.iter().any(|c|w.fields.iter().find(|f|&f.name==c).and_then(field_value).is_some_and(|e|w.p.args.iter().any(|a|!a.type_.optional&&uses(e,&a.name)))));
            if !declared&&!created_together{continue;}
            let removing=writes.iter().filter(|w|w.table==*child&&(w.op==WriteOp::Delete||matches!(w.op,WriteOp::Update|WriteOp::Upsert)&&w.fields.iter().any(|f|{
                if &f.name==reference{return !field_value(f).is_some_and(|e|matches!(e,Expr::Member{base,name,..} if name==reference&&same_target(base,w)));}
                media.contains(&f.name)&&match field_value(f){Some(Expr::Literal{value:ast::Literal::Null,..})=>true,Some(Expr::Array{items,..})=>items.is_empty(),_=>false}
            }))).collect::<Vec<_>>();
            if removing.is_empty(){continue;}
            let operations=removing.iter().map(|w|format!("{} ({})",w.p.name,if w.op==WriteOp::Delete{"delete"}else{"detach/clear"})).collect::<BTreeSet<_>>().into_iter().collect::<Vec<_>>().join(", ");
            note(out,&removing[0].site,"N_EVIDENCE_REMOVAL",format!("{child}.{reference} -> {parent}: {operations} can remove or move evidence {}; could this remove a parent's last required photo/file? Required child fields alone do not require a surviving child.",media.join(",")),"check the specification for last-child retention; guard deletion/detachment transactionally, replace evidence or retire the parent, then declare independent parent integrity intent and run test");
        }
    }
}

fn required_child(bound:&Bound,parent:&str,child:&str,reference:&str)->bool{
    bound.invariants.iter().filter(|i|i.table==parent&&i.target=="always").filter_map(|i|i.policy.as_ref()).flat_map(conjuncts).any(|r|if let RuleExpr::Exists{table,index,key,equalities,..}=r{
        table==child&&(bound.schema.tables[table].index(index).is_some_and(|idx|idx.components.iter().zip(key).any(|(c,v)|c.column().map(String::as_str)==Some(reference)&&matches!(v,RuleTerm::Field(c) if c=="id")))||equalities.iter().any(|(c,v)|c==reference&&matches!(v,RuleTerm::Field(c) if c=="id")))
    }else{false})
}

// The obligation names a relationship and any literal discriminator, not every
// attachment in the child table (e.g. required checkout vs optional return).
fn mandatory_parent_for(bound:&Bound,w:&Write<'_>,writes:&[Write<'_>])->bool{
    fn linked(w:&Write<'_>,reference:&str,parent:&Write<'_>)->bool{w.fields.iter().find(|f|f.name==reference).and_then(field_value).is_some_and(|e|matches!(e,Expr::Member{base,name,..} if name=="id"&&matches!(base.as_ref(),Expr::Write{table,site,..} if table==&parent.table&&site==&parent.site)))}
    fn literal(e:&Expr,v:&snapback4_core::Value)->bool{match(e,v){
        (Expr::Literal{value:ast::Literal::Str(a),..},snapback4_core::Value::String(b))=>a==b,
        (Expr::Literal{value:ast::Literal::Bool(a),..},snapback4_core::Value::Bool(b))=>a==b,
        (Expr::Literal{value:ast::Literal::Null,..},snapback4_core::Value::Null)=>true,
        (Expr::Literal{value:ast::Literal::Number(a),..},snapback4_core::Value::Int(b))=>a.parse::<i64>().ok()==Some(*b),_=>false,
    }}
    for (reference,kind) in &bound.schema.tables[&w.table].columns{let ColumnType::Ref{table:parent}=kind.required()else{continue;};
        for p in writes.iter().filter(|p|std::ptr::eq(p.p,w.p)&&p.table==*parent&&matches!(p.op,WriteOp::Insert|WriteOp::Upsert)&&linked(w,reference,p)){
            for policy in bound.invariants.iter().filter(|i|i.table==*parent&&i.target=="always").filter_map(|i|i.policy.as_ref()).flat_map(conjuncts){
                let RuleExpr::Exists{table,index,key,equalities,..}=policy else{continue;};if table!=&w.table{continue;}
                let pairs=super::privilege::probe_pairs(bound,table,index,key,equalities);
                if !pairs.iter().any(|(c,v)|c==reference&&matches!(v,RuleTerm::Field(c) if c=="id")){continue;}
                let matches=|candidate:&Write<'_>|linked(candidate,reference,p)&&pairs.iter().all(|(column,term)|{
                    if column==reference{return matches!(term,RuleTerm::Field(c) if c=="id");}
                    let RuleTerm::Literal(value)=term else{return false;};candidate.fields.iter().find(|f|&f.name==column).and_then(field_value).is_some_and(|e|literal(e,value))
                });
                if !matches(w){continue;}
                let already=writes.iter().any(|other|std::ptr::eq(other.p,w.p)&&other.table==w.table&&other.site!=w.site&&other.op==WriteOp::Insert&&!other.conditional&&matches(other)&&ordinary_unconditional(other.p,&other.site));
                if !already{return true;}
            }
        }
    }false
}

fn ordinary_unconditional(p:&ast::ProgramDecl,site:&Site)->bool{
    for statement in p.prelude.iter().chain(&p.body){
        match statement{
            Stmt::Expr{value,..}|Stmt::Bind{value,..}|Stmt::Return{value,..}=>{
                if matches!(value,Expr::Write{op:WriteOp::Insert,site:s,if_absent:false,condition:None,..} if s==site){return true;}
                if matches!(statement,Stmt::Return{..}){return false;}
            },
            Stmt::If{..}|Stmt::For{..}|Stmt::As{..}|Stmt::Break{..}|Stmt::Continue{..}=>return false,_=>{},
        }
    }false
}
