//! Query result paths and nullable reads of private side tables.
use super::*;
use std::collections::BTreeSet;

pub(super) const VIEWER_KEY: &str = "$lookupViewerKey";
const TARGET_ROW: &str = "$lookupTargetRow";

// @ref LLP 3000.036.002#151-evidence-and-decision — compatibility keeps
// fallthrough null; check must name a concrete uncovered source path.
pub(super) fn fallthrough(decl: &ast::ProgramDecl) -> Diagnostic {
    fn path(body: &[S], implicit: bool) -> Option<Vec<String>> {
        let mut route = Vec::new();
        for (at, stmt) in body.iter().enumerate() {
            match stmt {
                S::Return { .. } => return None,
                S::Expr { .. } if implicit && at + 1 == body.len() => return None,
                S::Require { condition: A::Literal { value: Literal::Bool(false), .. }, .. } => return None,
                S::If { then_body, else_body, site, .. } => {
                    let completes = implicit && at + 1 == body.len();
                    let (arm, rest) = if let Some(rest) = path(then_body, completes) { ("true", rest) }
                        else if let Some(rest) = path(else_body, completes) { ("false", rest) }
                        else { return None };
                    route.push(format!("if at {site} is {arm}")); route.extend(rest);
                }
                S::For { site, .. } => route.push(format!("loop at {site} has zero iterations")),
                _ => {}
            }
        }
        Some(route)
    }
    let route = path(&decl.body, true).unwrap_or_default();
    let route = if route.is_empty() { "entry → end".into() } else { format!("{} → end", route.join(" → ")) };
    Diagnostic::new(&decl.site, "N_QUERY_FALLTHROUGH",
        format!("query {} can finish without a result ({route}); that path returns null", decl.name),
        "return a value on this path: add `return []` for an intentionally empty list, or `return null` for intentional absence; a return inside a possibly empty loop does not cover its zero-iteration path").guide("programs")
}

impl Binder<'_> {
    fn advice_snapshot(&self,name:&str)->Option<ReadExpr>{
        let binding=self.binding(name)?;
        if binding.ty.is_optional()||binding.origins.len()!=1||!binding.fields.contains_key(&vec!["$advisorySnapshot".into()]){return None;}
        let mut origin=&binding.origins[0].1;if let A::Assert{value,..}=origin{origin=value;}
        let A::Read(read)=origin else{return None;};
        let info=self.catalog.tables.get(&read.table)?;
        if info.through.is_some()||info.maintained.is_some()||read.range.is_some()||read.filter.is_some()||read.matching.is_some()||!read.seeks.is_empty(){return None;}
        let mut read=read.clone();
        if read.keys.len()==1&&read.keys[0].column.is_none()&&matches!(&read.keys[0].value,A::Name{name,..} if self.binding(name).is_some_and(|b|b.ty.required()==Ty::Ref(read.table.clone()))){read.keys[0].column=Some("id".into());}
        let pins=super::super::auth_lints::pins(self.catalog,&read)?;
        info.indexes.iter().any(|index|info.total_unique(index)&&index.columns.iter().all(|c|pins.contains_key(c))).then(||read.clone())
    }
    fn advice_snapshot_condition(&self,value:&A)->A{
        let mut value=value.clone();
        super::super::intent_walk::expression(&mut value,&mut |node|{
            let original=node.clone();
            let A::Binary{op,left,right,site}=&original else{return;};if !matches!(op.as_str(),"="|"!="){return;}
            for (field,literal) in [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())]{
                let A::Member{base,name,..}=field else{continue;};
                if !matches!(literal,A::Literal{..})&&!matches!(literal,A::Name{name,..} if name=="viewer"){continue;}
                let A::Name{name:binding,..}=base.as_ref()else{continue;};let Some(mut read)=self.advice_snapshot(binding)else{continue;};
                let table=&self.schema.tables[&read.table];
                if table.columns.get(name).is_none_or(|kind|kind.is_optional())||table.column_reads.contains_key(name)||table.written_by.get(name).is_some_and(|owner|!owner.audience){continue;}
                read.keys.push(ast::KeyPart{column:Some(name.clone()),value:literal.clone(),site:site.clone()});
                let probe=A::Exists{read,site:site.clone()};
                *node=if op=="="{probe}else{A::Unary{op:"not".into(),value:Box::new(probe),site:site.clone()}};break;
            }
        });value
    }
    // Preserve only transaction facts whose raw rows cannot change through
    // this direct write. Unsupported implicit/lifetime dependencies stay cut.
    pub(super) fn stable_advice_after(&self,value:&A)->BTreeMap<String,Vec<(Vec<String>,Ty)>>{
        let A::Write{table,op,..}=value else{return BTreeMap::new();};
        if !self.schema.tables.contains_key(table)||*op==WriteOp::Delete||!self.schema.maintains.is_empty()||self.schema.tables.values().any(|t|!t.maintained.is_empty()||!t.sequences.is_empty()){return BTreeMap::new();}
        let plain=|name:&str|name!=table&&self.schema.table(name).is_some_and(|t|t.through.is_none()&&t.ephemeral.is_none());
        let mut saved=BTreeMap::new();
        for binding in self.scopes.iter().flat_map(|scope|scope.values()){
            for (key,ty) in &binding.fields{
                let stable=match key.first().map(String::as_str){
                    Some("$advisoryRead")=>key.last().and_then(|identity|self.advisory_predicates.get(identity)).is_some_and(|(condition,_)|{
                        let mut condition=self.advice_snapshot_condition(condition);let mut stable=true;
                        super::super::intent_walk::expression(&mut condition,&mut |node|match node{
                            A::Read(read)|A::Exists{read,..}=>stable&=plain(&read.table),
                            A::Call{..}|A::Member{..}=>stable=false,_=>{},
                        });stable
                    }),
                    Some("$advisorySnapshot")=>binding.origins.len()==1&&{
                        let mut origin=&binding.origins[0].1;if let A::Assert{value,..}=origin{origin=value;}
                        matches!(origin,A::Read(read) if plain(&read.table))
                    },_=>false,
                };
                if stable{saved.entry(binding.runtime.clone()).or_insert_with(Vec::new).push((key.clone(),ty.clone()));}
            }
        }saved
    }
    // Advisory-only helper implication. Existing lexical facts retain their
    // rebinding/write invalidation; expanded values never enter runtime proofs.
    // @ref LLP 3000.036.004.003#2-read-guards — pure role helpers are transparent to advice.
    fn lookup_advice_proved(&self, table: &str, value: &A) -> bool {
        let Some(expanded) = super::super::advisory_guards::expand(self.catalog,value)else{return false;};
        if self.lookup_rule_proved(&expanded) { return true; }
        let Some(info) = self.catalog.tables.get(table) else { return false; };
        let mut context=info.clone();
        for scope in &self.scopes{for (name,_binding) in scope{
            if let Some(read)=self.advice_snapshot(name){for (field,kind) in &self.catalog.tables[&read.table].columns{context.columns.insert(format!("$advisoryField:{name}:{field}"),kind.clone());}}
        }}
        // Argument identities and captured fields occupy synthetic columns only
        // in this diagnostic binder. No fact enters runtime authority.
        for doc in &self.catalog.documents{for program in &doc.programs{if program.name==self.name{for arg in &program.args{context.columns.insert(format!("$advisoryCaller:{}",arg.name),arg.type_.clone());}}}}
        let bind = |mut value: A| {
            super::super::intent_walk::expression(&mut value,&mut |node|{
                if let A::Member{base,name,site}=node&&let A::Name{name:alias,..}=base.as_ref()&&context.columns.contains_key(&format!("$advisoryField:{alias}:{name}")){*node=A::Member{base:Box::new(A::Focal{site:site.clone()}),name:format!("$advisoryField:{alias}:{name}"),site:site.clone()};}
                if let A::Name{name,site}=node&&context.columns.contains_key(&format!("$advisoryCaller:{name}")){*node=A::Member{base:Box::new(A::Focal{site:site.clone()}),name:format!("$advisoryCaller:{name}"),site:site.clone()};}
            });
            super::super::intent_walk::expression(&mut value,&mut |node|if let A::Name{name,site}=node&&name=="$advisoryFieldRoot"{*node=A::Focal{site:site.clone()};});
            super::super::schema::bind_rule(self.catalog,&context,&ast::RuleDecl{effect:ast::Effect::Read,bindings:Vec::new(),site:value.site().clone(),value}).ok()
        };
        fn caller_goal(value:&A,bind:&impl Fn(A)->Option<snapback4_core::schema::RuleExpr>)->A{
            if let A::Binary{op,left,right,site}=value&&matches!(op.as_str(),"and"|"or"){
                return A::Binary{op:op.clone(),left:Box::new(caller_goal(left,bind)),right:Box::new(caller_goal(right,bind)),site:site.clone()};
            }
            let mut copy=value.clone();let mut target=false;
            super::super::intent_walk::expression(&mut copy,&mut |node|if matches!(node,A::Name{name,..} if name==TARGET_ROW){target=true;});
            if target||bind(value.clone()).is_none(){A::Literal{value:Literal::Bool(false),site:value.site().clone()}}else{value.clone()}
        }
        let Some(need) = bind(caller_goal(&expanded,&bind)) else { return false; };
        let bind_fact=|mut value:A|{
            super::super::intent_walk::expression(&mut value,&mut |node|if let A::Member{base,name,site}=node&&let A::Name{name:alias,..}=base.as_ref()&&context.columns.contains_key(&format!("$advisoryField:{alias}:{name}")){*node=A::Member{base:Box::new(A::Name{name:"$advisoryFieldRoot".into(),site:site.clone()}),name:format!("$advisoryField:{alias}:{name}"),site:site.clone()};});
            // Caller locals/constants and an enclosing projection's focal row
            // never inhabit the target rule's namespace.
            super::super::intent_walk::expression(&mut value,&mut |node|match node{
                A::Name{name,site} if name!="viewer"&&self.binding(name).is_some()&&!context.columns.contains_key(&format!("$advisoryCaller:{name}"))=>*node=A::Name{name:format!("$advisoryCaller:{name}"),site:site.clone()},
                A::Focal{site}=>*node=A::Name{name:"$advisoryCallerFocal".into(),site:site.clone()},_=>{},
            });bind(value)
        };
        let facts=self.advice_authorizations().into_iter().map(|(value,truth)|{
            let value=self.advice_snapshot_condition(&value);
            if truth{value}else{A::Unary{op:"not".into(),site:value.site().clone(),value:Box::new(value)}}
        });
        fn lower(value:&A,bind:&impl Fn(A)->Option<snapback4_core::schema::RuleExpr>,catalog:&super::super::catalog::Catalog,schema:&snapback4_core::schema::Schema)->snapback4_core::schema::RuleExpr{
            if super::super::advisory_guards::raw_monotone(catalog,schema,value,true)&&let Some(rule)=bind(value.clone()){return rule;}
            match value{A::Binary{op,left,right,..} if op=="and"=>snapback4_core::schema::RuleExpr::And(vec![lower(left,bind,catalog,schema),lower(right,bind,catalog,schema)]),A::Binary{op,left,right,..} if op=="or"=>snapback4_core::schema::RuleExpr::Or(vec![lower(left,bind,catalog,schema),lower(right,bind,catalog,schema)]),_=>snapback4_core::schema::RuleExpr::Allow}
        }
        let mut have=facts.map(|value|lower(&value,&bind_fact,self.catalog,self.schema)).collect::<Vec<_>>();
        for name in self.scopes.iter().flat_map(|scope|scope.keys()){
            if let Some(read)=self.advice_snapshot(name)&&let Some(probe)=bind_fact(A::Exists{site:read.site.clone(),read}){have.push(probe);}
        }
        have.extend(super::super::query_branches::finite_rosters(self.schema,&have));
        super::super::query_branches::implies(&snapback4_core::schema::RuleExpr::And(have),&need)

    }
    fn lookup_rule_proved(&self, value: &A) -> bool {
        let mut copy = value.clone();
        let mut target = false;
        super::super::intent_walk::expression(&mut copy, &mut |node| {
            if matches!(node, A::Name { name, .. } if name == TARGET_ROW) { target = true; }
        });
        if !target { return self.point_guard_safe(value) && self.authorization_proved(value, true); }
        match value {
            A::Binary { op, left, right, .. } if op == "or" => self.lookup_rule_proved(left) || self.lookup_rule_proved(right),
            A::Binary { op, left, right, .. } if op == "and" => self.lookup_rule_proved(left) && self.lookup_rule_proved(right),
            _ => false,
        }
    }
    // @ref LLP 3000.036.002#152-lookup-contract-and-diagnostics — transport
    // only source advice facts across the helper's captured argument boundary.
    pub(super) fn helper_lookup_points(&self, function: &ast::FunctionDecl, args: &[A]) -> Vec<ReadExpr> {
        fn closed(value: &A, parameters: &[ast::ArgDecl]) -> bool {
            let mut value = value.clone();
            let mut safe = true;
            super::super::intent_walk::expression(&mut value, &mut |node| match node {
                A::Name { name, .. } if name != "viewer" && name != "now" && !parameters.iter().any(|p| p.name == *name) => safe = false,
                A::Focal { .. } | A::Write { .. } | A::Call { .. } => safe = false,
                _ => {}
            });
            safe
        }
        fn substitute(value: &mut A, parameters: &[ast::ArgDecl], args: &[A]) {
            super::super::intent_walk::expression(value, &mut |node| {
                if let A::Name { name, .. } = node && let Some(at) = parameters.iter().position(|p| p.name == *name)
                    && let Some(argument) = args.get(at) { *node = argument.clone(); }
            });
        }
        fn collect(catalog: &Catalog, function: &ast::FunctionDecl, args: &[A], stack: &mut Vec<String>, fuel: &mut usize, reads: &mut Vec<ReadExpr>) {
            if stack.len() >= 32 || stack.contains(&function.name) { return; }
            stack.push(function.name.clone());
            let mut body = match &function.body { ast::FunctionBody::Block(body) => body.clone(), ast::FunctionBody::Expression(value) => vec![S::Return { value: value.clone(), site: value.site().clone() }] };
            super::super::intent_walk::statements(&mut body, &mut |node| {
                if *fuel == 0 { return; } *fuel -= 1;
                match node {
                    A::Read(read) if read.keys.iter().all(|key| closed(&key.value, &function.args)) => {
                        let mut value = A::Read(read.clone()); substitute(&mut value, &function.args, args);
                        if let A::Read(read) = value { reads.push(read); }
                    }
                    A::Call { name, args: arguments, .. } if arguments.iter().all(|value| closed(value, &function.args)) => {
                        if let Some(callee) = catalog.functions.get(name) {
                            let mut arguments = arguments.clone();
                            for value in &mut arguments { substitute(value, &function.args, args); }
                            collect(catalog, callee, &arguments, stack, fuel, reads);
                        }
                    }
                    _ => {}
                }
            });
            stack.pop();
        }
        if self.caller_kind != ProgramKind::Mutation { return Vec::new(); }
        let identity: Vec<_> = function.args.iter().map(|p| A::Name { name: p.name.clone(), site: p.site.clone() }).collect();
        let mut reads = Vec::new();
        collect(self.catalog, function, &identity, &mut Vec::new(), &mut 512, &mut reads);
        reads.into_iter().filter(|read| read.keys.iter().all(|key| closed(&key.value, &function.args))).filter(|read| {
            let mut value = A::Read(read.clone()); substitute(&mut value, &function.args, args);
            let A::Read(actual) = value else { return false };
            self.point_guard_safe(&A::Read(actual.clone())) && (self.point_present(&actual) || self.lookup_point_present(&actual) || self.row_independent_read_proved(&actual.table))
        }).collect()
    }
    // This marker suppresses advice only; it cannot authorize a runtime read
    // or enter the binder's authority/presence proof domains.
    pub(super) fn lookup_viewer_key(&self, value: &A) -> bool {
        if matches!(value, A::Name { name, .. } if name == "viewer" || self.binding(name)
            .is_some_and(|binding| binding.fields.contains_key(&vec![VIEWER_KEY.into()]))) { return true; }
        let equal = A::Binary { op: "=".into(), left: Box::new(value.clone()), right: Box::new(A::Name { name: "viewer".into(), site: value.site().clone() }), site: value.site().clone() };
        self.point_guard_safe(value) && self.authorization_proved(&equal, true)
    }
    // @ref LLP 3000.000.000.001#10-wave-20-loop-repairs-dx5 — asserted and same-table reads still need reader authority; blind writes do not pass here.
    pub(super) fn optional_lookup_note(&mut self, read: &ReadExpr, point: &Read) {
        if self.caller_kind != ProgramKind::Mutation || self.point_present(read) || self.lookup_point_present(read)
            || self.row_independent_read_proved(&read.table) { return; }
        let table = &self.schema.tables[&read.table];
        if table.ephemeral.is_some() || self.schema.maintain_for(&read.table).is_some() { return; }
        let index = &table.indexes[&point.index];
        let pinned = index.components.iter().zip(&point.key).filter_map(|(part, value)| part.column().map(|name| (name, value))).collect();
        if snapback4_core::engine::rules::prefix_visibility(&read.table, table, &table.rules.read, &pinned).decided_true { return; }
        if let Some(through)=&table.through&&let Some(parent)=self.catalog.tables.get(&through.parent)&&let Some(rule)=parent.decl.rules.iter().find(|rule|rule.effect==ast::Effect::Read){
            let mut value=rule.value.clone();maintain_types::normalize_rule_constants(&mut value);
            super::super::intent_walk::expression(&mut value,&mut |e|if let A::Member{base,..}=e&&let A::Focal{site}=base.as_ref(){**base=A::Name{name:TARGET_ROW.into(),site:site.clone()};});
            if self.lookup_advice_proved(&through.parent,&value){return;}
        }
        if let Some(rule) = self.catalog.tables[&read.table].decl.rules.iter().find(|rule| rule.effect == ast::Effect::Read) {
            let named = read.keys.iter().all(|key| key.column.is_some());
            let keys: BTreeMap<_, _> = read.keys.iter().enumerate().filter_map(|(at, key)|
                Some((if named { key.column.clone()? } else { index.components.get(at)?.column()?.clone() },
                    if self.lookup_viewer_key(&key.value) { A::Name { name: "viewer".into(), site: key.site.clone() } } else { key.value.clone() }))).collect();
            let mut condition = rule.value.clone();
            // Rule constants and target fields occupy their own namespaces.
            // Freeze/seal them before injecting lexical caller key expressions.
            maintain_types::normalize_rule_constants(&mut condition);
            condition=super::super::advisory_model::child_policy(self.catalog,&read.table,&condition,&keys);
            super::super::intent_walk::expression(&mut condition,&mut |node|{
                if let A::Member{base,name,..}=node&&matches!(base.as_ref(),A::Focal{..})&&let Some(id)=keys.get("id")&&let A::Member{base:child,name:reference,..}=id&&let A::Name{name:alias,..}=child.as_ref()&&let Some(child_read)=self.advice_snapshot(alias)&&let Some(link)=self.catalog.advisory.links.iter().find(|link|link.parent==read.table&&link.parent_field==*name&&link.child==child_read.table&&link.reference==*reference){*node=A::Member{base:child.clone(),name:link.field.clone(),site:node.site().clone()};}
            });
            super::super::intent_walk::expression(&mut condition, &mut |value| {
                if let A::Member { base, .. } = value && let A::Focal { site } = base.as_ref() {
                    **base = A::Name { name: TARGET_ROW.into(), site: site.clone() };
                }
            });
            super::super::intent_walk::expression(&mut condition, &mut |value| {
                if let A::Member { base, name, .. } = value && matches!(base.as_ref(), A::Name { name, .. } if name == TARGET_ROW)
                    && let Some(key) = keys.get(name) { *value = key.clone(); }
            });
            if self.lookup_advice_proved(&read.table, &condition) { return; }
        }
        let rule = table.through.as_ref().map_or_else(|| format!("read <- {}", table.rules.read.quarry()), |through| format!("read through .{}", through.reference));
        let location = self.catalog.tables[&read.table].decl.rules.iter().find(|rule| rule.effect == ast::Effect::Read)
            .map(|rule| rule.site.to_string()).unwrap_or_else(|| self.catalog.tables[&read.table].decl.site.to_string());
        if self.notes.iter().any(|note| note.code == "N_LOOKUP_FILTERED" && note.site == read.site) { return; }
        let saw=self.advice_authorizations().into_iter().map(|(value,truth)|format!("{}{}",if truth{""}else{"not "},crate::print::expression(&value))).collect::<BTreeSet<_>>().into_iter().collect::<Vec<_>>().join("; ");
        let saw=if saw.is_empty(){"no current dominating guard".to_owned()}else{saw};
        self.notes.push(Diagnostic::new(&read.site, "N_LOOKUP_FILTERED",
            format!("mutation {}: saw lookup of {} `{}` and guards `{saw}`; not proved: read authority `{rule}` ({location}) at {}; hidden, expired or missing row returns null (`! else CODE` refuses with its authored code)", self.name, read.table, crate::print::read_expr(read), read.site),
            "review whether these callers should read this data; use a deliberately readable projection containing only the needed fields, or keep null as intentional absence. An id and a later write rule do not grant read authority; do not widen private rows just to read one field").guide("rules"));
    }
}
