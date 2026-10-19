//! Advice identifies a risk shape; it never supplies a proof assumption.
// @ref LLP 3000.036.004#123-actionable-authority-advice — current roles, grant writers, required evidence and refusal oracles.
use super::*;
use crate::ast::{Expr,Stmt,ProgramKind};
const NOW_FOR_DEFAULTS:i64=1_800_000_000_000;
fn rule_parts(rule:&RuleExpr)->Vec<&RuleExpr>{match rule{RuleExpr::And(xs)|RuleExpr::Or(xs)=>xs.iter().flat_map(rule_parts).collect(),RuleExpr::Not(x)=>rule_parts(x),r=>vec![r]}}
fn role_test(bound:&Bound,rule:&RuleExpr)->bool {rule_parts(rule).iter().any(|r|match r{
    RuleExpr::Exists{table,index,key,equalities,..} if key.iter().chain(equalities.iter().map(|(_,v)|v)).any(|t|matches!(t,RuleTerm::Viewer))=>{
        let columns=super::privilege::role_columns(bound,table);
        super::privilege::probe_pairs(bound,table,index,key,equalities).iter().any(|(c,t)|columns.contains(c)&&matches!(t,RuleTerm::Literal(_)))
    },_=>false,
})}
fn reader_columns(rule:&RuleExpr)->BTreeSet<String>{rule_parts(rule).into_iter().filter_map(|r|match r{RuleExpr::Eq(RuleTerm::Field(f),RuleTerm::Viewer)|RuleExpr::Eq(RuleTerm::Viewer,RuleTerm::Field(f))=>Some(f.clone()),_=>None}).collect()}
fn note(notes:&mut Vec<Diagnostic>,site:&Site,code:&str,message:String,rewrite:&str){notes.push(Diagnostic::new(site,code,message,rewrite).guide("security"));}
fn mutable_role(bound:&Bound,name:&str)->bool {
    let Some(t)=bound.schema.table(name)else{return false;};
    let roles=super::privilege::role_columns(bound,name);
    if roles.is_empty(){return false;}
    let mutable=roles.iter().any(|c|!t.constraints.iter().any(|k|matches!(k,snapback4_core::schema::Constraint::Immutable{fields} if fields.contains(c))));
    fn supplied(value:&serde_json::Value,roles:&BTreeSet<String>)->bool{
        if let Some(fields)=value.get("Object").and_then(serde_json::Value::as_object){return fields.keys().any(|c|roles.contains(c));}
        if let Some(fields)=value.get("Literal").and_then(|v|v.get("Map").or_else(||v.get("Row"))).and_then(serde_json::Value::as_object){return fields.keys().any(|c|roles.contains(c));}
        true // Dynamic patches cannot establish that role fields are untouched.
    }
    fn writes(value:&serde_json::Value,name:&str,roles:&BTreeSet<String>,update:bool,delete:bool)->bool{
        match value{
            serde_json::Value::Object(xs)=>{
                for tag in ["Update","Upsert","WriteTarget"]{if let Some(body)=xs.get(tag){
                    let target=if tag=="WriteTarget"{body.get("target").and_then(|v|v.get("table"))}else{body.get("table")};
                    if update&&target.and_then(serde_json::Value::as_str)==Some(name)&&body.get(if tag=="Upsert"{"row"}else{"patch"}).is_some_and(|v|supplied(v,roles)){return true;}
                }}
                for tag in ["Delete","DeleteTarget"]{if let Some(body)=xs.get(tag){
                    let target=if tag=="DeleteTarget"{body.get("target").and_then(|v|v.get("table"))}else{body.get("table")};
                    if delete&&target.and_then(serde_json::Value::as_str)==Some(name){return true;}
                }}
                xs.values().any(|v|writes(v,name,roles,update,delete))
            },serde_json::Value::Array(xs)=>xs.iter().any(|v|writes(v,name,roles,update,delete)),_=>false,
        }
    }
    bound.programs.iter().any(|p|{
        let system=p.program.kind==snapback4_core::ir::ProgramKind::Job;
        let update=mutable&&(system||!matches!(t.rules.update,RuleExpr::Deny)||roles.iter().any(|c|t.written_by.contains_key(c)));
        let delete=system||!matches!(t.rules.delete,RuleExpr::Deny);
        writes(&serde_json::to_value(&p.program).unwrap(),name,&roles,update,delete)
    })
}
fn recipient_role(bound:&Bound,name:&str,branch:&RuleExpr,grant:Option<&str>,roster:&str,effect:&str)->bool{
    if bound.invariants.iter().any(|i|i.table==*name&&(i.target==effect||i.target=="write"&&matches!(effect,"insert"|"update"))&&i.policy.as_ref().is_some_and(|p|kernel::dependencies(p).contains(roster)&&role_test(bound,p)&&kernel::implies(branch,p)!=Ok(true))){return true;}
    let _=(branch,grant,roster);
    // Field names cannot establish a current-role contract. The missing-intent
    // note asks for that independent specification before lifetime advice.
    false
}
pub(super) fn notes(bound:&Bound,exposures:&[Exposure])->Vec<Diagnostic>{
    let mut notes=Vec::new();
    for (name,t) in bound.schema.visible_tables(){
        if t.rules.read.is_uniformly_readable(){note(&mut notes,&Site::default(),"N_BROAD_READ",format!("{name} is readable by every signed-in user: {}",t.rules.read.quarry()),"confirm the spec permits these columns and declare read intent; snapback4 audit lists inherited grants and their writers");}
        if let RuleExpr::Exists{table:roster,key,equalities,..}=&t.rules.read
            && equalities.is_empty()&&key.iter().any(|k|matches!(k,RuleTerm::Viewer)) {
            note(&mut notes,&Site::default(),"N_BROAD_READ",format!("{name} is readable by any signed-in user with a matching {roster} row; no particular role or row ownership is required"),"confirm that every roster member should see all these columns; declare intent from the privacy spec and inspect audit");
        }
        for (column,kind) in &t.columns {
            use snapback4_core::schema::ColumnType as C;
            if kind.contains_asset() && (kind.is_optional() || matches!(kind.required(),C::List{..}|C::ListRange{min:0,..})) {
                note(&mut notes,&Site::default(),"N_OPTIONAL_EVIDENCE",format!("{name}.{column} permits omitted or empty media evidence"),"if the spec requires evidence, declare a required image/file or [image] 1..N; otherwise retain optionality deliberately (guide security)");
            }
        }
        for leaf in rule_parts(&t.rules.insert) {
            if let RuleExpr::Created {table:parent,..}=leaf
                && bound.schema.table(parent).is_some_and(|p| p.rules.insert.disjuncts().iter().any(|r| matches!(r,RuleExpr::Allow|RuleExpr::Eq(RuleTerm::Field(_),RuleTerm::Viewer)|RuleExpr::Eq(RuleTerm::Viewer,RuleTerm::Field(_)))))
                && bound.schema.tables.values().any(|other| [&other.rules.read,&other.rules.insert,&other.rules.update,&other.rules.delete].iter().any(|r| rule_parts(r).iter().any(|r|matches!(r,RuleExpr::Exists{table,key,equalities,..} if table==name&&matches!(key.as_slice(),[RuleTerm::Viewer])&&equalities.is_empty())))) {
                note(&mut notes,&Site::default(),"N_VACUOUS_RULE",format!("{name}: `created {parent}` can bootstrap authority trusted globally by a viewer-only probe; a caller may create their own global administrator grant"),"provision global authority only through an operator/service seat or existing authorized admin; group creation must scope every later grant to that group (guide deploy, first-admin setup)");
            }
        }
        for (effect,rule) in [("read",&t.rules.read),("insert",&t.rules.insert),("update",&t.rules.update),("delete",&t.rules.delete)] {
          for branch in rule.disjuncts(){
            if role_test(bound,branch){continue;}
            for dep in kernel::dependencies(branch){if let Some(g)=bound.schema.table(&dep) {
                let rosters=[&g.rules.insert,&g.rules.update].into_iter().flat_map(kernel::dependencies).filter(|r|mutable_role(bound,r)).collect::<BTreeSet<_>>();
                if rosters.iter().any(|r|recipient_role(bound,name,branch,Some(&dep),r,effect))&&(role_test(bound,&g.rules.insert)||role_test(bound,&g.rules.update)){
                    note(&mut notes,&Site::default(),"N_GRANT_OUTLIVES_ROLE",format!("{name}.{effect}: `{}` trusts retained {dep} grants while current role in {} can change",branch.quarry(),rosters.into_iter().collect::<Vec<_>>().join(", ")),"recheck the current role in this branch or revoke every derived grant transactionally on role changes; guide security");
                }
            }}
            let declared=bound.invariants.iter().filter(|i|i.table==*name&&(i.target==effect||i.target=="write"&&matches!(effect,"insert"|"update"))).filter_map(|i|i.policy.as_ref()).flat_map(kernel::dependencies).filter(|r|mutable_role(bound,r)).collect::<BTreeSet<_>>();
            if !reader_columns(branch).is_empty()&&declared.iter().any(|r|recipient_role(bound,name,branch,None,r,effect)) {
                note(&mut notes,&Site::default(),"N_GRANT_OUTLIVES_ROLE",format!("{name}.{effect}: principal branch `{}` does not recheck the declared mutable current role",branch.quarry()),"recheck the current role as well as principal attribution; guide security");
            }
          }
        }
    }
    // Inspect original syntax for argument flow and distinct authored codes.
    // Keeping lints outside Bound.notes preserves the compiler's existing
    // diagnostic contract; check/audit expose this security advice separately.
    let _=exposures;
    notes
}
pub(super) fn source_notes(sources:&[(String,String)],bound:&Bound)->Vec<Diagnostic>{
    let mut out=Vec::new();
    let documents=sources.iter().map(|(file,source)|crate::parse_document(file,source).0).collect::<Vec<_>>();
    let catalog=super::super::catalog::Catalog::build(documents.clone(),&mut Vec::new());
    for doc in documents{
        for p in &doc.programs {
            let mut body=p.prelude.clone();body.extend(p.body.clone());
            let mut seen=BTreeSet::new();
            let mut guarded=BTreeSet::new();
            for statement in p.prelude.iter().chain(&p.body) {
                if let Stmt::Require{condition,..}=statement {
                    let mut condition=condition.clone();
                    super::super::intent_walk::expression(&mut condition,&mut |e|if let Expr::Exists{read,..}=e {
                        for key in &read.keys {if let Expr::Name{name,..}=&key.value {guarded.insert(name.clone());}}
                    });
                }
            }
            for (write,context) in super::authority_walk::writes(&catalog,p){
                let Expr::Write{op,table,fields,site,..}=&write else{continue;};
                let Some(t)=bound.schema.table(table)else{continue;};
                let role_columns=super::privilege::role_columns(bound,table);
                for column in &role_columns {if p.kind==ProgramKind::Mutation&&(fields.iter().any(|f|&f.name==column)||matches!(op,ast::WriteOp::Insert|ast::WriteOp::Upsert)&&t.defaults.contains_key(column))&&bound.schema.tables.values().any(|other|[&other.rules.read,&other.rules.insert,&other.rules.update,&other.rules.delete].iter().any(|r|kernel::dependencies(r).contains(table))) {
                    let mut targets=fields.iter().filter(|f|&f.name==column).filter_map(|f|match &f.value{Some(Expr::Literal{value:ast::Literal::Str(s),..})=>Some(s.clone()),_=>None}).collect::<Vec<_>>();
                    if !fields.iter().any(|f|&f.name==column)&&let Some(snapback4_core::Value::String(role))=t.defaults.get(column).map(|d|d.value(NOW_FOR_DEFAULTS,"$advisory")){targets.push(role);}
                    let chosen=fields.iter().find(|f|&f.name==column);
                    let dynamic=chosen.map_or(targets.is_empty(),|f|!matches!(f.value,Some(Expr::Literal{..})));
                    if let Some(field)=chosen {
                        if let Some(Expr::Name{name:argument,..})=&field.value&&let Some(arg)=p.args.iter().find(|a|a.name==*argument)&&let ast::TypeKind::Enum{variants}= &arg.type_.kind {targets=variants.clone();}
                    }
                    let requirements=catalog.tables.get(table).map(|info|super::operation::requirements(&catalog,info,&context)).unwrap_or_default();
                    let effective_op=if chosen.is_none()&&*op==ast::WriteOp::Upsert{ast::WriteOp::Insert}else{*op};
                    if let Some(risk)=super::privilege::risk(bound,table,column,&super::super::operation_name(std::path::Path::new(&doc.file).file_stem().unwrap().to_string_lossy().as_ref(),&p.name),&targets,effective_op,&requirements,dynamic)&&seen.insert((table.clone(),format!("$privilege:{column}"))) {
                        note(&mut out,site,"N_PRIVILEGE_ESCALATION",format!("{}: {risk}; review the grant's delegation policy",p.name),"restrict role assignment to authorized delegation or an operator seat; use guide staging's first-admin recipe (intentional open enrollment may permit this)");
                    }
                }}
            }
            super::super::intent_walk::statements(&mut body,&mut |e|{
                let Expr::Write{table,fields,site,..}=e else{return};
                let Some(t)=bound.schema.table(table)else{return};
                let readers=reader_columns(&t.rules.read);
                for f in fields.iter(){
                    let arg=f.value.as_ref().and_then(|e|if let Expr::Name{name,..}=e{Some(name.as_str())}else{None}).unwrap_or(f.name.as_str());
                    if !guarded.contains(arg)&&readers.contains(&f.name)&&p.args.iter().any(|a|a.name==arg)&&seen.insert((table.clone(),f.name.clone())){
                        note(&mut out,site,"N_ARGUMENT_GRANT",format!("{} writes argument {arg} straight into reader-grant column {table}.{}",p.name,f.name),"require the chosen principal's current role and relationship before granting access; caller authority alone does not validate the recipient");
                    }

                }
            });
            // Distinct absent and denial codes disclose logical existence to
            // callers admitted by a broader table rule, even without payload.
            fn refusals(body:&[Stmt],bound:&Bound,absent:&mut Option<String>,codes:&mut Vec<(Site,String)>){for s in body{match s{
                Stmt::Bind{value:Expr::Assert{value,code,..},..}=>{
                    *absent=None;
                    if let Expr::Read(read)=value.as_ref()&&let Some(t)=bound.schema.table(&read.table){
                        let own=read.keys.iter().any(|k|matches!(&k.value,Expr::Name{name,..} if name=="viewer"));
                        if !t.rules.read.is_uniformly_readable()&&!own {
                            // A table read gate already conflates hidden and absent.
                            // Only broader program-level privacy intent can make
                            // its later refusal distinguish private existence.
                            if bound.invariants.iter().any(|i|i.table==read.table&&i.target=="read"&&i.column.is_none()&&i.policy.as_ref().is_some_and(|policy|kernel::implies(&t.rules.read,policy)==Ok(false))){*absent=Some(code.clone());}
                        }
                    }
                },
                Stmt::Require{site,code,..}=>if let Some(a)=absent.as_ref()&&a!=code{codes.push((site.clone(),format!("lookup absence {a}, later denial {code}")));},
                Stmt::If{then_body,else_body,..}=>{refusals(then_body,bound,&mut absent.clone(),codes);refusals(else_body,bound,&mut absent.clone(),codes);},
                Stmt::For{body,..}|Stmt::As{body,..}=>refusals(body,bound,&mut absent.clone(),codes),_=>{}}}}
            let mut codes=Vec::new();refusals(&p.body,bound,&mut None,&mut codes);
            for (site,why) in codes.into_iter().take(1){note(&mut out,&site,"N_EXISTENCE_ORACLE",format!("{}: {why}; row readership is broader than declared private-existence intent",p.name),"use the same absence/denial code and message for private existence, or tighten the row audience");}
            if p.kind==ProgramKind::Job {
                fn guards(body:&[Stmt],out:&mut Vec<Expr>){for s in body {match s{
                    Stmt::Require{condition,..}=>out.push(condition.clone()),
                    Stmt::If{condition,then_body,else_body,..}=>{out.push(condition.clone());guards(then_body,out);guards(else_body,out);},
                    Stmt::For{body,..}|Stmt::As{body,..}=>guards(body,out),_=>{}
                }}}
                let mut job_guards=Vec::new();guards(&p.body,&mut job_guards);
                let clock=job_guards.iter().any(|g|{let mut g=g.clone();let mut found=false;super::super::intent_walk::expression(&mut g,&mut |e|if matches!(e,Expr::Name{name,..} if name=="now"){found=true;});found});
                if !clock{continue;}
                let mut writes=BTreeSet::new();let mut b=p.body.clone();
                super::super::intent_walk::statements(&mut b,&mut |e|if let Expr::Write{table,fields,..}=e&&fields.iter().any(|f|f.name=="status"){writes.insert(table.clone());});
                for table in writes {for m in doc.programs.iter().filter(|m|m.kind==ProgramKind::Mutation){
                    let mut aliases=BTreeSet::new();
                    for s in &m.body{if let Stmt::Bind{names,value,..}=s{
                        let v=if let Expr::Assert{value,..}=value{value.as_ref()}else{value};
                        if matches!(v,Expr::Read(r) if r.table==table){aliases.extend(names.clone());}
                    }}
                    let mut checks=Vec::new();guards(&m.body,&mut checks);let(mut status,mut now)=(false,false);
                    for mut c in checks{super::super::intent_walk::expression(&mut c,&mut |e|match e{
                        Expr::Name{name,..} if name=="now"=>now=true,
                        Expr::Member{base,name,..} if name=="status"&&matches!(base.as_ref(),Expr::Name{name,..} if aliases.contains(name))=>status=true,_=>{}
                    });}
                    let module = std::path::Path::new(&doc.file).file_stem().and_then(|s| s.to_str()).unwrap_or("schema");
                    let job_name = if module == "schema" { p.name.clone() } else { format!("{module}.{}", p.name) };
                    let already_named = bound.notes.iter().any(|n| n.code == "N_SWEEP_DEADLINE" && n.site == m.site
                        && n.message.contains(&format!("column {table}.status)"))
                        && n.message.contains(&format!("scheduled job {job_name} ")));
                    if status&&!now&&!already_named{note(&mut out,&m.site,"N_SWEEP_ONLY_DEADLINE",format!("{} gates on {table}.status while clock job {} changes that status; writes can run between the deadline and sweep",m.name,p.name),"enforce the deadline against server now in the mutation too; a sweep cleans up state but does not enforce an exact deadline");}
                }}
            }
        }
    }
    out
}
