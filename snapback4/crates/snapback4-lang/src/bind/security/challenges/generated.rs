//! Deterministic role populations validated by the ordinary seed boundary.
// @ref LLP 3000.036.004#132-generated-initial-worlds-and-password-only-test — generated initialization is explicit.
use super::*;
/// No network, credentials, development doors, durable store or scratch files.
fn proposals(bound:&Bound,out:&mut Campaign)->Result<Engine,String>{
    if !out.reserve(1){return Err("generated fixture world not reserved; remaining initialization uncovered".into());}
    let mut people=Vec::new();
    for (table,_) in bound.schema.visible_tables(){
        let role_columns=super::super::privilege::role_columns(bound,table);
        for column in role_columns{
            {
                for role in super::super::privilege::role_values(bound,table,&column) {for n in 0..2 {people.push((table.clone(),column.clone(),role.clone(),format!("account:security-{table}-{role}-{n}")));}}
            }
        }
    }
    for seat in histories::viewers(bound).into_iter().filter(|p|p.starts_with("service:")&&p!="service:security") {for n in 0..2{people.push((String::new(),String::new(),String::new(),format!("account:security-{}-{n}",seat.replace(':',"-"))));}}
    if people.is_empty(){for n in 0..2{people.push((String::new(),String::new(),String::new(),format!("account:security-owner-{n}")));}}
    if people.len()>64{people.truncate(64);out.unsupported.insert("generated roster capped at 64 principals; additional roles remain uncovered".into());}
    let mut grant_tables=BTreeSet::new();
    fn grants(rule:&RuleExpr,out:&mut BTreeSet<String>){match rule{
        RuleExpr::Exists{table,key,equalities,..} if key.iter().chain(equalities.iter().map(|(_,v)|v)).any(|v|matches!(v,RuleTerm::Viewer))=>{out.insert(table.clone());},
        RuleExpr::And(xs)|RuleExpr::Or(xs)=>for r in xs{grants(r,out)},RuleExpr::Not(r)=>grants(r,out),_=>{}
    }}
    for t in bound.schema.tables.values(){for rule in std::iter::once(&t.rules.read).chain(t.column_reads.values()){grants(rule,&mut grant_tables);}}
    let counts=bound.schema.visible_tables().filter(|(table,_)|bound.schema.maintain_for(table).is_none()).map(|(table,t)|{
        let own=people.iter().filter(|(roster,_,_,_)|roster==table).count();(table.clone(),if own>0{own}else if grant_tables.contains(table)||std::iter::once(&t.rules.read).chain(t.column_reads.values()).any(|rule|rule.any_term(&|term|matches!(term,RuleTerm::Field(c) if t.columns.get(c).is_some_and(|k|matches!(k.required(),C::Principal))))){people.len().max(1usize<<t.columns.values().filter(|k|matches!(k.required(),C::Principal)).count().min(3))}else{t.columns.values().filter_map(|k|if let C::Enum{variants}=k.required(){Some(variants.len())}else{None}).max().unwrap_or(2).max(1usize<<t.columns.values().filter(|k|matches!(k.required(),C::Principal)).count().min(3)).clamp(2,8)})
    }).collect::<BTreeMap<_,_>>();
    let mut rows=BTreeMap::new();
    for (table,t) in bound.schema.visible_tables(){
        if !counts.contains_key(table){continue;}
        let own=people.iter().filter(|(roster,_,_,_)|roster==table).collect::<Vec<_>>();
        if t.columns.values().filter(|k|matches!(k.required(),C::Principal)).count()>3 {out.unsupported.insert(format!("generated fixture {table}: full Cartesian combinations above three principal columns remain uncovered"));}
        let mut population=Vec::new();
        for n in 0..counts[table]{
            let person=if own.is_empty(){&people[n%people.len()]}else{own[n]};
            let mut fields=BTreeMap::from([("id".into(),Value::Id(format!("security-{table}-{n}")))]);
            let mut principal=0;
            for (column,kind) in &t.columns {
                if column=="id"||t.engine_field(column)||t.recorded.contains_key(column)||t.maintained.contains_key(column){continue;}
                let mut value=if kind.is_optional()&&n%2==0&&!(person.0==*table&&person.1==*column){Value::Null}else{match sample(kind.required(),4+n){Some(value)=>value,None=>{out.unsupported.insert(format!("generated fixture {table}.{column}: unsupported typed sample"));continue;}}};
                if value==Value::Null&&kind.is_optional(){fields.insert(column.clone(),value);continue;}
                match kind.required(){
                    C::Principal=>{
                        let linked=!own.is_empty()||grant_tables.contains(table)||t.constraints.iter().any(|constraint|matches!(constraint,Constraint::FinalExistsOnInsert{key,..} if key.iter().any(|term|matches!(term,RuleTerm::Field(c) if c==column))));
                        value=Value::Id(if linked{if principal==0{person.3.clone()}else{people[(n+principal)%people.len()].3.clone()}}else{if (n>>principal.min(5))&1==0{VIEWER}else{OTHER}.into()});principal+=1;
                    },
                    C::Ref{table:target}=>{value=Value::Id(format!("security-{target}-{}",n%counts.get(target).copied().unwrap_or(1)));},
                    C::Enum{..}|C::Text{..} if person.0==*table&&person.1==*column=>value=Value::String(person.2.clone()),
                    C::Text{max}=>{let minimum=t.constraints.iter().filter_map(|c|if let Constraint::Text{field,min,..}=c{(field==column).then_some(*min as usize)}else{None}).max().unwrap_or(1);let suffix=format!("sample{n}");value=Value::String(format!("{suffix}{}","x".repeat(minimum.saturating_sub(suffix.len()))).chars().take(*max as usize).collect());},
                    C::Time=>value=Value::Int(NOW+if t.expire.as_deref()==Some(column){86_400_000}else{-1000}),
                    _=>{},
                }
                fields.insert(column.clone(),value);
            }
            population.push(Value::Row(fields.into()));
        }
        rows.insert(table.clone(),population);
    }
    // Batch validation preserves final-exists, parent ordering and maintains.
    if let Ok(engine)=engine_with(bound,&rows,Vec::new()){return Ok(engine);}
    if !out.reserve(1){return Err("generated fallback world not reserved; initialization uncovered".into());}
    let mut engine=engine_with(bound,&BTreeMap::new(),Vec::new())?;
    let mut pending=rows.into_iter().flat_map(|(table,rows)|rows.into_iter().map(move|row|(table.clone(),row))).collect::<Vec<_>>();
    let mut reasons=BTreeMap::new();
    for _ in 0..=bound.schema.tables.len(){
        let before=pending.len();let mut retry=Vec::new();
        for (table,mut row) in pending {
            if !out.reserve(1){validate_fixture(bound,&mut engine)?;return Ok(engine);}
            let attempt=(||{
                for (column,kind) in &bound.schema.tables[&table].columns {if let Ok(value)=row.field(column){let value=hydrate(&mut engine,kind,value)?;if let Value::Row(fields)=&mut row{fields.insert(column.clone(),value);}}}
                engine.seed_at([(table.clone(),row.clone())],NOW).map_err(|e|e.to_string())?;Ok::<_,String>(())
            })();
            if let Err(why)=attempt{reasons.insert(table.clone(),why);retry.push((table,row));}
        }
        pending=retry;if pending.len()==before{break;}
    }
    for (table,why) in reasons{if pending.iter().any(|(name,_)|name==&table){out.unsupported.insert(format!("generated fixture {table}: some related rows declined by ordinary validation: {why}"));}}
    validate_fixture(bound,&mut engine)?;
    Ok(engine)
}

// @ref LLP 3000.036.004#137-wave-19-correction-admissible-starts-and-persistent-refutations — creator guards/copies are part of generated initialization.
pub fn fixture(bound:&Bound,out:&mut Campaign)->Result<Engine,String>{
    let proposed=proposals(bound,out)?;
    let rows=readback(&proposed)?;
    let actors=histories::actors(bound,&rows);
    // A principal key and a field named role are insufficient: payload tables
    // must execute their creators even when they happen to have that shape.
    fn authority_roster(bound:&Bound,name:&str)->bool{
        let columns=super::super::privilege::role_columns(bound,name);
        fn used(bound:&Bound,rule:&RuleExpr,name:&str,columns:&BTreeSet<String>)->bool{match rule{
            RuleExpr::Exists{table,index,key,equalities,..} if table==name&&key.iter().chain(equalities.iter().map(|(_,v)|v)).any(|v|matches!(v,RuleTerm::Viewer))=>super::super::privilege::probe_pairs(bound,table,index,key,equalities).iter().any(|(c,v)|columns.contains(c)&&matches!(v,RuleTerm::Literal(Value::String(_)))),
            RuleExpr::And(xs)|RuleExpr::Or(xs)=>xs.iter().any(|r|used(bound,r,name,columns)),RuleExpr::Not(r)=>used(bound,r,name,columns),_=>false,
        }}
        !columns.is_empty()&&bound.schema.tables.values().any(|t|[&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete].into_iter().chain(t.column_reads.values()).any(|r|used(bound,r,name,&columns)))
    }
    let rosters=bound.schema.visible_tables().filter(|(name,_)|authority_roster(bound,name)).map(|(name,_)|name.clone()).collect::<BTreeSet<_>>();
    let mut creators=bound.programs.iter().filter(|p|p.program.kind==ProgramKind::Mutation&&!p.program.native&&!bound.schema.operations.get(&p.program.name).is_some_and(|f|f.ephemeral)&&ir::write_tables(&p.program).iter().any(|(_,kind)|matches!(*kind,"insert"|"upsert"))).collect::<Vec<_>>();
    creators.sort_by_key(|p|ir::write_tables(&p.program).iter().any(|(_,kind)|matches!(*kind,"update"|"upsert"|"delete")));
    let created=creators.iter().flat_map(|p|ir::write_tables(&p.program)).filter(|(_,kind)|matches!(*kind,"insert"|"upsert")).map(|(t,_)|t).collect::<BTreeSet<_>>();
    let mut engine=engine_on_store(bound,&BTreeMap::new(),Vec::new(),proposed.store().empty_with_asset_ledger().map_err(|e|e.to_string())?)?;
    let mut pending=rows.iter().filter(|(t,_)|rosters.contains(*t)||!created.contains(*t)).flat_map(|(t,rs)|rs.iter().map(move|r|(t.clone(),r.clone()))).collect::<Vec<_>>();
    // Bootstrap proposals require an actor admitted by the insert rule in the
    // previous world. Never let a proposed role authorize its own insertion.
    for _ in 0..=bound.schema.tables.len(){
        let before=pending.len();let mut retry=Vec::new();
        for (table,row) in pending{
            if !out.reserve(1){out.unsupported.insert("generated initialization work exhausted; remaining populations uncovered".into());validate_fixture(bound,&mut engine)?;return Ok(engine);}
            let seeded=clean_row(bound,&table,&row);
            let mut accepted=None;
            for actor in &actors{
                if !out.reserve(1){break;}
                // This only orders ordinary replay work: a definitely denied
                // pre-insert gate cannot be rescued by copying the entire
                // ledger. Unknown and defaults still go through the engine.
                if matches!(engine.fixture_policy(&bound.schema.tables[&table].rules.insert,actor,None,&seeded,NOW),Ok(rules::Verdict::Denied)){continue;}
                let mut candidate=engine.fork_fixture().map_err(|e|e.to_string())?;
                if matches!(candidate.insert_fixture(&table,seeded.clone(),actor,NOW),Ok(r) if matches!(r.state,snapback4_core::WriteState::Sent{..})){accepted=Some(candidate);break;}
            }
            if let Some(candidate)=accepted{engine=candidate;}else{retry.push((table,row));}
        }
        pending=retry;if pending.len()==before{break;}
    }
    for (table,_) in pending{out.unsupported.insert(format!("generated fixture {table}: no admitted insert/bootstrap; population uncovered"));}
    // Try principals in the admitted authority rosters before outsider probes.
    // This only orders candidates: every creator and recipient guard still
    // executes normally, and outsider actors remain in the finite campaign.
    // Avoid spending the short check budget hydrating media for absent roles.
    let mut creator_actors=actors.clone();
    let admitted=readback(&engine)?;
    let roster_principals=rosters.iter().flat_map(|name|admitted.get(name).into_iter().flatten().flat_map(|row|{
        bound.schema.tables[name].columns.iter().filter_map(move |(column,kind)|{
            if matches!(kind.required(),C::Principal){match row.field(column){Ok(Value::Id(p))=>Some(p.clone()),_=>None}}else{None}
        })
    })).collect::<BTreeSet<_>>();
    creator_actors.sort_by_key(|actor|!roster_principals.contains(actor));
    // Authored insertion bodies preserve requires, immutable copies, defaults,
    // role checks on principal arguments and multi-table creation invariants.
    // @ref LLP 3000.036.004#1710-concrete-intent-child-dependencies — syntax reads order exploration without claiming evaluator support.
    let mut dependent_children=BTreeMap::<String,BTreeSet<String>>::new();
    for inv in &bound.invariants{
        let children=dependent_children.entry(inv.table.clone()).or_default();
        if let Some(policy)=&inv.policy{children.extend(kernel::dependencies(policy));}
        if let Some(mut syntax)=inv.syntax.clone(){crate::bind::intent_walk::expression(&mut syntax,&mut |expr|match expr{
            ast::Expr::Read(read)|ast::Expr::Exists{read,..}|ast::Expr::Created{read,..}=>{children.insert(read.table.clone());},_=>{}
        });}
    }
    let mutable_authority=bound.invariants.iter().flat_map(|i|i.policy.iter().flat_map(kernel::dependencies)).filter(|t|super::super::privilege::role_columns(bound,t).is_empty()).collect::<BTreeSet<_>>();
    let mut attempts=0usize;let mut root_observed=false;let mut stricter_observed=false;let mut creator_decisions=BTreeMap::<String,BTreeSet<String>>::new();let mut postponed=BTreeSet::new();
    for _ in 0..=bound.schema.tables.len().min(12){
        let before=readback(&engine)?;
        for bp in &creators{
            let p=&bp.program;let writes=ir::write_tables(p);
            // Give pending child creators one pass over an admitted parent
            // before another creator consumes that parent's lifecycle state.
            let current=readback(&engine)?;
            let consumes_pending_parent=writes.iter().any(|(parent,kind)|matches!(*kind,"update"|"upsert"|"delete")&&current.get(parent).is_some_and(|rs|!rs.is_empty())&&creators.iter().any(|other|other.program.name!=p.name&&other.program.args.values().any(|k|matches!(k,ir::ArgType::Ref{table} if table==parent))&&ir::write_tables(&other.program).iter().any(|(child,kind)|child!=parent&&matches!(*kind,"insert"|"upsert")&&current.get(child).is_none_or(|rs|rs.is_empty()))));
            if consumes_pending_parent&&postponed.insert(p.name.clone()){continue;}

            // Preserve a pre-transition root population. Later derived creators
            // can otherwise consume every pending lifecycle row during setup.
            // @ref LLP 3000.036.004#179-preserve-the-pre-transition-root-when-observing-dependent-children — unrelated reference arguments must not spend the one root observation.
            let related_creator=p.args.values().any(|kind|matches!(kind,ir::ArgType::Ref{table} if created.contains(table)&&engine.store().rows(table).is_ok_and(|rows|!rows.is_empty())&&dependent_children.get(table).is_some_and(|children|writes.iter().any(|(child,kind)|matches!(*kind,"insert"|"upsert")&&children.contains(child)))));
            if !root_observed&&(related_creator||writes.iter().any(|(_,kind)|matches!(*kind,"update"|"upsert"|"delete"))){
                root_observed=true;
                if out.generated_fixture&&out.work_remaining.is_none_or(|work|work>=4096)&&validate_fixture(bound,&mut engine).is_ok(){
                    let first=out.violations.len();histories::lifecycle_observers_to(bound,&engine,out,1024);
                    for witness in &mut out.violations[first..]{if witness.reachability==Reachability::AuthoredFixtureTrace{witness.reachability=Reachability::GeneratedFixtureTrace;witness.scope="actual authored observation from a validated generated early setup checkpoint; initialization is not claimed application-reachable".into();}}
                }
            }
            let watched_transition=related_creator||writes.iter().any(|(t,kind)|matches!(*kind,"update"|"upsert"|"delete")&&mutable_authority.contains(t));
            let implicit=stability::implicit(bound,p);
            if writes.iter().all(|(t,_)|rosters.contains(t)){continue;}
            let current=readback(&engine)?;
            let targets=writes.iter().filter(|(_,kind)|matches!(*kind,"insert"|"upsert")).map(|(t,_)|t).collect::<Vec<_>>();
            if targets.iter().all(|t|current.get(*t).map_or(0,Vec::len)>=2){
                if p.args.values().any(|kind|matches!(kind,ir::ArgType::Bool)){out.unsupported.insert(format!("{}: two-row target population cap skips creator boolean alternatives; combinations remain uncovered",p.name));}
                continue;
            }
            let mut cases=histories::fixture_cases(bound,p,&current,&creator_actors,out);
            let clock_intent=bound.invariants.iter().filter_map(|i|i.syntax.as_ref()).any(|e|{let mut e=e.clone();let mut now=false;crate::bind::intent_walk::expression(&mut e,&mut |e|if matches!(e,ast::Expr::Name{name,..} if name=="now"){now=true;});now});
            if clock_intent {if let Some(index)=cases.iter().position(|args|p.args.iter().any(|(name,kind)|matches!(kind,ir::ArgType::Time)&&matches!(args.get(name),Some(Value::Int(n)) if *n<NOW-183*86_400_000))){let old=cases.remove(index);cases.insert(0,old);}}
            // Do not let two actors on the first tuple consume both root
            // slots before the opposite gating boolean is tried.
            if let Some(first)=cases.first().cloned(){
                if let Some(index)=cases.iter().position(|case|p.args.iter().any(|(name,kind)|matches!(kind,ir::ArgType::Bool)&&case.get(name)!=first.get(name))){
                    let alternate=cases.remove(index);cases.insert(1,alternate);
                    if p.args.values().filter(|kind|matches!(kind,ir::ArgType::Bool)).count()>1{out.unsupported.insert(format!("{}: generated roots keep two boolean tuples; additional correlated boolean combinations remain uncovered",p.name));}
                }
            }
            let boolean_names=p.args.iter().filter(|(_,kind)|matches!(kind,ir::ArgType::Bool)).map(|(name,_)|name.clone()).collect::<Vec<_>>();
            let projection=|args:&BTreeMap<String,Value>|boolean_names.iter().filter_map(|name|args.get(name).map(|value|(name.clone(),value.clone()))).collect::<BTreeMap<_,_>>();
            let possible=cases.iter().map(|args|serde_json::to_string(&projection(args)).unwrap()).collect::<BTreeSet<_>>();
            let mut attempted_booleans=BTreeSet::new();let admitted_booleans=creator_decisions.entry(p.name.clone()).or_default();
            let mut pending_cases=cases;let mut tuple_attempts=0;
            // An opposite Boolean on an already-consumed parent can refuse.
            // Try that decision on other parents before filling the second
            // root slot with an already admitted decision.
            'cases:while !pending_cases.is_empty()&&tuple_attempts<16 {
                pending_cases.sort_by_key(|args|admitted_booleans.contains(&serde_json::to_string(&projection(args)).unwrap()));
                let args=pending_cases.remove(0);tuple_attempts+=1;
                for actor in &creator_actors{
                attempted_booleans.insert(serde_json::to_string(&projection(&args)).unwrap());
                if attempts>=2048||!out.reserve(1){out.unsupported.insert("generated authored initialization capped at 2048 calls; remaining creators uncovered".into());validate_fixture(bound,&mut engine)?;return Ok(engine);}
                attempts+=1;
                if targets.len()==1{
                    let gate=&bound.schema.tables[targets[0]].rules.insert;
                    let stable=!gate.any_term(&|term|!matches!(term,RuleTerm::Viewer|RuleTerm::Literal(_)))
                        &&kernel::dependencies(gate).iter().all(|dep|!implicit.contains(dep)&&!writes.iter().any(|(t,_)|t==dep));
                    if stable&&matches!(engine.fixture_policy(gate,actor,None,&Value::Null,NOW),Ok(rules::Verdict::Denied)){continue;}
                }
                let mut candidate=engine.fork_fixture().map_err(|e|e.to_string())?;
                let args=match materialize_arguments(&mut candidate,&p.args,&args,actor){Ok(a)=>a,Err(_)=>continue};
                let result=candidate.mutate(&p.name,None,Context::new(actor,args.clone()).at(NOW));
                if matches!(result,Ok(r) if matches!(r.state,snapback4_core::WriteState::Sent{..})) {
                    let after=readback(&candidate)?;
                    let loosens=if !stricter_observed&&watched_transition&&out.generated_fixture&&out.work_remaining.is_none_or(|work|work>=4096){
                        let before=readback(&engine)?;
                        bound.invariants.iter().any(|inv|before.get(&inv.table).into_iter().flatten().any(|row|{
                            let Some(next)=after.get(&inv.table).into_iter().flatten().find(|next|next.field("id").ok()==row.field("id").ok())else{return false;};
                            creator_actors.iter().any(|viewer|policy_at(bound,inv,&before,viewer,None,row,NOW)==Ok(false)&&policy_at(bound,inv,&after,viewer,None,next,NOW)==Ok(true))
                        }))
                    }else{false};
                    if !stricter_observed&&loosens {
                        stricter_observed=true;
                        if validate_fixture(bound,&mut engine).is_ok(){
                            let first=out.violations.len();let limit=out.directed_attempts.saturating_add(1024).min(2048);histories::lifecycle_observers_to(bound,&engine,out,limit);
                            for witness in &mut out.violations[first..]{if witness.reachability==Reachability::AuthoredFixtureTrace{witness.reachability=Reachability::GeneratedFixtureTrace;witness.scope="actual authored observation from a validated generated root before an admitted dependency-changing creator; initialization is not claimed application-reachable".into();}}
                        }
                    }
                    if targets.iter().any(|table|after.get(*table).map_or(0,Vec::len)>2){
                        out.unsupported.insert(format!("{}: creator result exceeds two-row per-target population cap; this admitted candidate and its alternatives remain uncovered",p.name));
                        continue;
                    }
                    if targets.iter().any(|t|after.get(*t).map_or(0,Vec::len)>current.get(*t).map_or(0,Vec::len)) {admitted_booleans.insert(serde_json::to_string(&projection(&args)).unwrap());engine=candidate;}
                    let after=readback(&engine)?;
                    if targets.iter().all(|t|after.get(*t).map_or(0,Vec::len)>=2){break 'cases;}
                    if targets.iter().any(|t|after.get(*t).map_or(0,Vec::len)>current.get(*t).map_or(0,Vec::len)){continue 'cases;}
                }
            }}
            if !boolean_names.is_empty()&&possible.difference(&attempted_booleans).next().is_some(){out.unsupported.insert(format!("{}: creator tuple/population cap omits {} generated boolean projections; remaining combinations uncovered",p.name,possible.difference(&attempted_booleans).count()));}
        }
        if readback(&engine)?==before{break;}
    }
    for table in created.difference(&rosters){if engine.store().rows(table).map_err(|e|e.to_string())?.is_empty(){out.unsupported.insert(format!("generated fixture {table}: authored creator did not populate this table"));}}
    validate_fixture(bound,&mut engine)?;Ok(engine)
}
fn clean_row(bound:&Bound,table:&str,row:&Value)->Value{
    let t=&bound.schema.tables[table];
    match row{Value::Row(fields)=>Value::Row(fields.iter().filter(|(c,_)|!t.engine_field(c)&&!t.recorded.contains_key(*c)&&!t.maintained.contains_key(*c)).map(|(c,v)|(c.clone(),v.clone())).collect()),_=>row.clone()}
}

#[cfg(test)]mod tests{
use super::*;
#[test]fn a_multi_insert_creator_cannot_exceed_the_per_target_population_cap(){
 let bound=crate::compile(&[("schema.q".into(),"table docs:\n  n:int\n  read <- allow\n  insert <- allow\n  online only\nmutation add():\n  insert docs {n:1}\n  insert docs {n:2}\n  return insert docs {n:3}\n".into())]);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
 let mut out=Campaign::default();let e=fixture(&bound,&mut out).unwrap();assert!(e.store().rows("docs").unwrap().len()<=2);assert!(out.unsupported.iter().any(|s|s.contains("two-row per-target")),"{:?}",out.unsupported);
}
}

#[cfg(test)]mod sec9_reach_tests {use super::*;
#[test]fn wave25_role_checked_creator_has_a_resource_root(){
 let sources=vec![("schema.q".into(),format!("{}\ninvariant inspections.status update only .authorization != null or exists roles[viewer, role = 'scheduler']\n",include_str!("../../../../tests/security/wave25/043.q")))];
 let b=super::super::derived::augmented(&sources,&crate::compile(&sources));
 assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let mut out=Campaign::bounded(15000);out.work_remaining=Some(8192);
 let proposed=proposals(&b,&mut out).unwrap();let rows=readback(&proposed).unwrap();let actors=histories::actors(&b,&rows);let p=&b.programs.iter().find(|bp|bp.program.name=="book").unwrap().program;
 let cases=histories::fixture_cases(&b,p,&rows,&actors,&mut out);let prefs=histories::principal_preferences(&b,p,&rows);
 assert!(cases.iter().take(16).any(|a|["client","inspector"].iter().all(|n|prefs.get(*n).is_some_and(|vs|vs.contains(&a[*n])))),"preferences {prefs:?}; first {:?}",cases.iter().take(16).collect::<Vec<_>>());
 let mut e=fixture(&b,&mut out).unwrap();let inspections=e.store().rows("inspections").unwrap();assert!(!inspections.is_empty(),"{:?}",out.unsupported);
 let row=inspections.iter().find(|r|r.field("authorization").map_or(true,|v|*v==Value::Null)).expect("generated roots retain missing evidence");
 let actor=row.field("inspector").unwrap().as_str().unwrap();let clock=match row.field("scheduledAt").unwrap(){Value::Int(n)=>(*n).max(NOW),_=>panic!("typed time")};
 let p=&b.programs.iter().find(|p|p.program.name=="markInspected").unwrap().program;let trace=super::executed::trace(&b,p);
 let result=e.mutate("markInspected",None,Context::new(actor,BTreeMap::from([("inspection".into(),row.field("id").unwrap().clone())])).at(clock).with_fixture_trace(trace.clone())).unwrap();
 assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}),"{result:?}");assert!(trace.take().iter().any(|o|o.allowed==Some(false)));

}
}

#[cfg(test)]mod sec9_clock_reach_tests {use super::*;
#[test]fn future_payment_can_be_replayed_against_clock_intent(){
 let b=crate::compile(&[("schema.q".into(),format!("{}\ninvariant payments.markMissed only .dueAt < now\n",include_str!("../../../../tests/security/wave24/015.q")))]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let mut out=Campaign::bounded(15000);out.work_remaining=Some(8192);let mut e=fixture(&b,&mut out).unwrap();let rows=readback(&e).unwrap();
 assert!(!rows["payments"].is_empty(),"{:?}",out.unsupported);
 let row=rows["payments"].iter().find(|r|matches!(r.field("dueAt"),Ok(Value::Int(n)) if *n>=NOW)).expect("one generated payment is due in the future");
 let actor=rows["roles"].iter().find(|r|r.field("role").ok()==Some(&Value::String("desk".into()))).unwrap().field("principal").unwrap().as_str().unwrap();
 let p=&b.programs.iter().find(|bp|bp.program.name=="markMissed").unwrap().program;let trace=super::executed::trace(&b,p);
 let result=e.mutate("markMissed",None,Context::new(actor,BTreeMap::from([("payment".into(),row.field("id").unwrap().clone())])).at(NOW).with_fixture_trace(trace.clone())).unwrap();
 assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}),"{result:?}");assert!(trace.take().iter().any(|o|o.allowed==Some(false)));
}
}

#[cfg(test)]mod sec9_boolean_roots {use super::*;
#[test]fn opposite_admitted_decisions_use_fresh_parent_rows(){
 let source="table parents:\n  done: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable decisions:\n  parent: parents\n  passed: bool\n  unique parent\n  read <- allow\n  insert <- allow\n  online only\nmutation open():\n  return insert parents {}\nmutation inspect(parent: parents,passed: bool):\n  row = parents[parent] ! else MISSING\n  require not row.done else DONE\n  update parents[parent] {done:true}\n  return insert decisions {parent,passed}\n";
 let b=crate::compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let mut c=Campaign::bounded(15000);c.work_remaining=Some(8192);let e=fixture(&b,&mut c).unwrap();
 let decisions=e.store().rows("decisions").unwrap();assert_eq!(decisions.len(),2,"{:?}",c.unsupported);
 for passed in [false,true]{assert!(decisions.iter().any(|r|r.field("passed").ok()==Some(&Value::Bool(passed))),"{decisions:?}");}
}
}
