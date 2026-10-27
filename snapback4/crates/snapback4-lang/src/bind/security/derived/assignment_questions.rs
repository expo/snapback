//! Role-wide payload observations ask for assignment intent; they confer no authority.
// @ref LLP 3000.036.004.003#assignment-questions — a missing assignment model is not an invented assignee.
use super::*;
use snapback4_core::{Value, schema::{ColumnType as C, Table}, ir::KeyProvenance};
use sha2::{Digest,Sha256};

fn role(bound:&Bound,rule:&RuleExpr)->Option<String>{
    let RuleExpr::Exists{table,index,key,equalities,..}=rule else{return None;};
    let principal=super::super::privilege::global_principal(bound,table)?;
    let pairs=super::super::privilege::probe_pairs(bound,table,index,key,equalities);
    if !pairs.iter().any(|(column,value)|*column==principal&&*value==RuleTerm::Viewer)
        ||!pairs.iter().all(|(_,value)|matches!(value,RuleTerm::Viewer|RuleTerm::Literal(_))){return None;}
    let roles=super::super::privilege::role_columns(bound,table);
    let values=pairs.into_iter().filter_map(|(column,value)|if roles.contains(&column)&&let RuleTerm::Literal(Value::String(value))=value{Some(value)}else{None}).collect::<Vec<_>>();
    let [value]=values.as_slice()else{return None;};Some(value.clone())
}
fn all_roles(bound:&Bound,rule:&RuleExpr,out:&mut BTreeSet<String>){
    if let Some(role)=role(bound,rule){out.insert(role);}
    if let RuleExpr::And(xs)|RuleExpr::Or(xs)=rule{for x in xs{all_roles(bound,x,out);}}
}
// One direct typed parent is supported. Ambiguous matches and deeper joins stay
// uncovered; a column's spelling alone never supplies an observed disclosure.
fn relations(bound:&Bound,table:&str,role:&str)->Vec<RuleExpr>{
    let t=&bound.schema.tables[table];let mut out=Vec::new();
    for (column,kind) in &t.columns{if column.eq_ignore_ascii_case(role)&&matches!(kind,C::Principal){out.push(RuleExpr::Eq(RuleTerm::Field(column.clone()),RuleTerm::Viewer));}}
    for (reference,kind) in &t.columns{if let C::Ref{table:parent}=kind{
        for (column,kind) in &bound.schema.tables[parent].columns{if column.eq_ignore_ascii_case(role)&&matches!(kind,C::Principal){
            out.push(RuleExpr::Exists{table:parent.clone(),index:"byId".into(),key:vec![RuleTerm::Field(reference.clone())],provenance:KeyProvenance::Computed,equalities:vec![(column.clone(),RuleTerm::Viewer)]});
        }}
    }}out
}
fn modeled_role(bound:&Bound,table:&str,role:&str)->bool{
    let has=|name:&str|bound.schema.tables[name].columns.iter().any(|(column,kind)|column.eq_ignore_ascii_case(role)&&matches!(kind.required(),C::Principal));
    has(table)||bound.schema.tables[table].columns.values().any(|kind|matches!(kind.required(),C::Ref{table} if has(table)))
}
fn payload(t:&Table)->Option<String>{
    t.columns.iter().filter(|(c,k)|c.as_str()!="id"&&!t.engine_field(c)&&!matches!(k.required(),C::Principal|C::Ref{..}))
        .min_by_key(|(c,k)|(!matches!(k.required(),C::Text{..}|C::Json{..}|C::Image{..}|C::File{..}|C::Bytes{..}),*c)).map(|(c,_)|c.clone())
}
pub fn questions(sources:&[(String,String)],bound:&Bound)->Vec<(Diagnostic,Invariant)>{
    let sites=sources.iter().flat_map(|(file,text)|crate::parse_document(file,text).0.tables.into_iter().map(|t|(t.name,t.site))).collect::<BTreeMap<_,_>>();
    let mut out=Vec::new();
    for (name,t) in bound.schema.visible_tables(){
        if !super::super::privilege::role_columns(bound,name).is_empty(){continue;}
        let mut groups=BTreeMap::<String,(String,RuleExpr,bool)>::new();
        for (column,rule) in &t.column_reads{groups.entry(rule.quarry()).or_insert((column.clone(),rule.clone(),true));}
        // A related table is itself a boundary: observe an actual payload cell,
        // rather than treating a returned reference/id as private disclosure.
        if t.columns.values().any(|k|matches!(k,C::Ref{..}))&&let Some(column)=payload(t){groups.entry(t.rules.read.quarry()).or_insert((column,t.rules.read.clone(),false));}
        for (_,(column,gate,explicit)) in groups{
            let effective=super::super::columns::admission(t,Some(&column));
            let branches=gate.disjuncts().into_iter().filter_map(|branch|role(bound,branch).map(|role|(role,branch.clone())))
                .filter(|(_,branch)|kernel::implies(branch,&effective)==Ok(true)).collect::<Vec<_>>();
            let mut roles=BTreeSet::new();all_roles(bound,&gate,&mut roles);
            let modeled=roles.iter().any(|role|modeled_role(bound,name,role));
            let mut missing=Vec::new();
            for (role,branch) in branches{
                let matches=relations(bound,name,&role);
                if let [relation]=matches.as_slice(){
                    let policy=RuleExpr::Or(vec![RuleExpr::Not(Box::new(branch.clone())),relation.clone()]);
                    emit(&mut out,name,&column,policy,&sites,format!("{name}.{column} read: {role} has role-wide payload access despite modeled assignment `{}`; assigned or any?",relation.quarry()));
                }else if explicit&&!modeled&&roles.len()>1{missing.push(branch);}
            }
            if !missing.is_empty(){
                // A collector, not a proposed deny policy. The CLI publishes an
                // actual read question, never this internal negated audience.
                let audience=RuleExpr::Or(missing);
                emit(&mut out,name,&column,RuleExpr::Not(Box::new(audience.clone())),&sites,format!("{name}.{column} read: `{}` admits the whole role with no modeled assignment constraint; assigned or any?",audience.quarry()));
            }
        }
    }out
}
fn emit(out:&mut Vec<(Diagnostic,Invariant)>,table:&str,column:&str,policy:RuleExpr,sites:&BTreeMap<String,Site>,message:String){
    let predicate=policy.quarry();let hash=format!("{:x}",Sha256::digest(format!("{table}/{column}/{predicate}/{message}")));
    let source=sites.get(table).cloned().unwrap_or_default();let site=Site::new(&format!("$derived/sec11-assignment/{hash}/{}",source.file),source.line,source.col);
    let note=Diagnostic::new(&site,"N_ASSIGNMENT_SCOPE",message,"scope the role branch to the declared assignment and state independent read intent, or answer this exact payload witness with the intended global audience").guide("security");
    out.push((note,Invariant{table:table.into(),column:Some(column.into()),target:"read".into(),predicate,site,policy:Some(policy),operation:None,requirements:Vec::new(),syntax:None,unsupported:Some("advisory payload collector; no authored denial or assignment intent is inferred".into())}));
}

#[cfg(test)]mod tests{
    use super::*;
    const HOME:&str=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec10-shipping/w30-004.q"));
    const BALLOONS:&str=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec10-shipping/w30-014.q"));
    fn compiled(source:&str)->(Bound,Vec<(Diagnostic,Invariant)>){let sources=vec![("schema.q".into(),source.into())];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let q=questions(&sources,&b);(b,q)}
    #[test]fn another_coordinator_actually_reads_the_assigned_private_payload(){
        let (mut b,q)=compiled(HOME);let q=q.into_iter().filter(|(_,i)|i.table=="jobPrivate").collect::<Vec<_>>();assert_eq!(q.len(),1);
        b.invariants=q.iter().map(|(_,i)|i.clone()).collect();let mut c=challenges::Campaign::work_bounded(8192);challenges::generated_campaign(&b,&mut c,false);
        let v=c.violations.iter().find(|v|v.invariant_site==q[0].1.site.to_string()&&v.operation=="privateDetail"&&v.reachability.is_reachable()).expect("actual privateDetail payload");
        let job=v.supporting_rows["jobs"].iter().find(|r|r.field("id").ok()==v.row.field("job").ok()).unwrap();assert_ne!(job.field("coordinator").unwrap(),&Value::Id(v.viewer.clone()));
        assert!(v.supporting_rows["roles"].iter().any(|r|r.field("principal").ok()==Some(&Value::Id(v.viewer.clone()))&&r.field("role").ok()==Some(&Value::String("coordinator".into()))));
        assert!(v.history.last().unwrap().observed_data.is_some());assert!(!super::super::super::gated_note(&q[0].0.code));
    }
    #[test]fn an_unmodeled_lead_assignment_has_an_actual_private_column_read(){
        let (mut b,q)=compiled(BALLOONS);let q=q.into_iter().filter(|(_,i)|i.table=="projects"&&i.column.as_deref()==Some("clientPhone")).collect::<Vec<_>>();assert_eq!(q.len(),1);assert!(q[0].0.message.contains("no modeled assignment constraint"));
        b.invariants=q.iter().map(|(_,i)|i.clone()).collect();let mut c=challenges::Campaign::work_bounded(8192);challenges::generated_campaign(&b,&mut c,false);
        assert!(c.violations.iter().any(|v|v.invariant_site==q[0].1.site.to_string()&&v.reachability.is_reachable()&&v.history.last().is_some_and(|s|s.observed_data.is_some())&&v.supporting_rows.get("roles").into_iter().flatten().any(|r|r.field("principal").ok()==Some(&Value::Id(v.viewer.clone()))&&r.field("role").ok()==Some(&Value::String("lead".into())))),"lead payload missing; attempts {}, gaps {:?}",c.attempted,c.unsupported);
    }
    #[test]fn scoped_role_repairs_do_not_reappear_as_global_owner_questions(){
        let fixed=HOME.replace("  read <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']\n","  read <- exists roles[viewer, role = 'owner'] or (exists roles[viewer, role = 'coordinator'] and exists jobs[id = .job, coordinator = viewer])\n");
        assert!(!compiled(&fixed).1.iter().any(|(_,i)|i.table=="jobPrivate"));
        let fixed=BALLOONS.replace("  client: principal\n","  client: principal\n  lead: principal\n").replace("return insert projects { client,", "return insert projects { lead: viewer, client,").replace("read (clientPhone, venueContract, fee) <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead']", "read (clientPhone, venueContract, fee) <- exists roles[viewer, role = 'owner'] or (.lead = viewer and exists roles[viewer, role = 'lead'])");
        assert!(!compiled(&fixed).1.iter().any(|(_,i)|i.table=="projects"&&i.column.as_deref()==Some("clientPhone")));
    }
}
