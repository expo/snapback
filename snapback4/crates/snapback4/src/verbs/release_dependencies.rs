//! Schema inputs actually consulted by guards, independent of unrelated writes.
// @ref LLP 3000.000.000#13-wave-13-preview-decisions — dependency changes are grouped, never inferred from whole-schema inequality.
use snapback4_core::{Schema, ir, schema::{RuleExpr, RuleTerm}};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(super) struct Dependencies(BTreeMap<String, Value>);
impl Dependencies {
    pub fn changed(&self, next: &Self) -> BTreeSet<String> {
        self.0.keys().chain(next.0.keys()).filter(|key| {
            let (a,b)=(self.0.get(*key),next.0.get(*key));
            if key.ends_with(".domains") {
                match (a.and_then(Value::as_object),b.and_then(Value::as_object)) {
                    (Some(a),Some(b)) => a.iter().any(|(column,kind)| b.get(column) != Some(kind)),
                    _ => a!=b,
                }
            } else {a!=b}
        })
            .map(|key| key.split('.').next().unwrap().to_owned()).collect()
    }
    fn column(&mut self, schema: &Schema, table: &str, column: &str) {
        let t = schema.table(table);
        self.0.insert(format!("{table}.column.{column}"), json!([
            t.and_then(|t| t.columns.get(column)), t.and_then(|t| t.defaults.get(column)),
            t.and_then(|t| t.written_by.get(column)), t.and_then(|t| t.maintained.get(column)),
            t.and_then(|t| t.recorded.get(column))]));
        for maintain in schema.maintains.iter().filter(|m|m.private.as_ref().is_some_and(|owner|owner.table==table && owner.column==column)) {self.maintain(schema,maintain);}
    }
    fn maintain(&mut self, schema: &Schema, maintain: &snapback4_core::schema::Maintain) {
        let key=format!("{}.maintain",maintain.target);
        if self.0.insert(key,json!(maintain)).is_some() {return;}
        self.population(schema,&maintain.source);
        for column in maintain.dependencies() {self.column(schema,&maintain.source,&column);}
    }
    fn index(&mut self, schema: &Schema, table: &str, index: &str) {
        let key = format!("{table}.index.{index}");
        let value = schema.table(table).and_then(|t| t.index(index));
        self.0.insert(key, json!(value));
        if let Some(index) = value {
            for column in schema.table(table).unwrap().columns.keys().filter(|c| index.uses_column(c)) {
                self.column(schema, table, column);
            }
        }
    }
    fn population(&mut self, schema: &Schema, name: &str) {
        let key = format!("{name}.population");
        if self.0.contains_key(&key) { return; }
        let Some(table) = schema.table(name) else { self.0.insert(key, Value::Null); return; };
        self.0.insert(key, json!([table.through, table.not_before, table.expire, table.ephemeral, table.on_delete]));
        let timelines:Vec<_>=schema.timelines.iter().filter(|t|t.owned.contains(name)||t.mapped.contains(name)||[&t.authors[0],&t.posts[0],&t.reposts[0],&t.edges[0]].into_iter().any(|table|table.as_str()==name)).collect();
        let families:Vec<_>=schema.receipts.iter().filter(|f|[&f.scope,&f.messages,&f.members,&f.runs].into_iter().any(|table|table.as_str()==name)).collect();
        self.0.insert(format!("{name}.metadata"),json!([timelines,families,schema.delivery.iter().filter(|d|d.table==name).collect::<Vec<_>>(),schema.receipt_dependencies.get(name)]));
        for t in timelines {for source in [&t.authors[0],&t.posts[0],&t.reposts[0],&t.edges[0]] {if schema.table(source).is_some() {self.population(schema,source);}}}
        for f in families {for source in [&f.scope,&f.messages,&f.members,&f.runs] {if schema.table(source).is_some() {self.population(schema,source);}}}
        self.0.insert(format!("{name}.domains"), json!(table.columns));
        self.0.insert(format!("{name}.textConstraints"), json!(table.constraints.iter().filter(|c|matches!(c,snapback4_core::schema::Constraint::Text {..})).collect::<Vec<_>>()));
        // Any typed reference can join the reference-closed dormant population,
        // even when it is not a read-through authority declaration.
        fn referenced(kind: &snapback4_core::schema::ColumnType, out: &mut BTreeSet<String>) {
            use snapback4_core::schema::ColumnType;
            match kind {
                ColumnType::Ref {table} => {out.insert(table.clone());},
                ColumnType::Optional(inner) | ColumnType::List {of:inner,..} | ColumnType::ListRange {of:inner,..} => referenced(inner,out),
                _ => (),
            }
        }
        let mut parents=BTreeSet::new();for kind in table.columns.values() {referenced(kind,&mut parents);}
        for parent in parents {self.population(schema,&parent);}
        self.0.insert(format!("{name}.read"), json!(table.rules.read));
        self.rule(schema, name, &table.rules.read);
        for column in [&table.not_before, &table.expire].into_iter().flatten() { self.column(schema, name, column); }
        if let Some(parent) = &table.through {
            self.population(schema, &parent.parent);
            // Captured lifetime/visibility identity is already in `through`.
        }
        // A maintained row's population/value depends on its source and derivation.
        if let Some(maintain) = schema.maintain_for(name) {
            self.maintain(schema,maintain);
        }
    }
    fn term(&mut self, schema: &Schema, owner: &str, term: &RuleTerm) {
        match term {
            RuleTerm::Field(c) | RuleTerm::OldField(c) | RuleTerm::NextField(c) => self.column(schema, owner, c),
            RuleTerm::Reference { column, .. } | RuleTerm::ReferenceChain { column, .. } => {
                self.column(schema, owner, column);
                for (table, field) in term.references() {
                    self.population(schema, table); self.index(schema, table, "byId"); self.column(schema, table, field);
                }
            },
            _ => (),
        }
    }
    fn rule(&mut self, schema: &Schema, owner: &str, rule: &RuleExpr) {
        match rule {
            RuleExpr::Eq(a,b) | RuleExpr::Ne(a,b) | RuleExpr::Compare(_,a,b) => { self.term(schema, owner, a); self.term(schema, owner, b); },
            RuleExpr::And(parts) | RuleExpr::Or(parts) => for part in parts { self.rule(schema, owner, part); },
            RuleExpr::Not(part) => self.rule(schema, owner, part),
            RuleExpr::Exists {table,index,key,equalities,..} | RuleExpr::Created {table,index,key,equalities,..} => {
                self.population(schema, table); self.index(schema, table, index);
                for term in key { self.term(schema, owner, term); }
                for (column,term) in equalities { self.column(schema, table, column); self.term(schema, owner, term); }
            },
            _ => (),
        }
    }
    // IR is serialized with explicit expression tags. Follow variable definitions
    // to the guard, including reads hidden behind lowered lexical temporaries.
    fn expression(&mut self, schema: &Schema, value: &Value, bindings: &BTreeMap<String, Value>, visited: &mut BTreeSet<String>, field: Option<&str>) {
        match value {
            Value::Object(fields) => {
                if fields.contains_key("Literal") { return; }
                if let Some(table)=fields.get("ReceiptSettled").and_then(|r|r["table"].as_str()) {self.population(schema,table);}
                if let Some(object) = fields.get("Object").and_then(Value::as_object) {
                    for value in object.values() {self.expression(schema,value,bindings,visited,None);}
                    return;
                }
                if let Some(shape) = fields.get("Shape") {
                    self.expression(schema,&shape["base"],bindings,visited,None);
                    if let Some(object)=shape["fields"].as_object() {for value in object.values() {self.expression(schema,value,bindings,visited,None);}}
                    return;
                }
                if let Some(binary)=fields.get("Binary") {
                    if matches!(binary["op"].as_str(),Some("Eq"|"Ne")) {
                        let null=json!({"Literal":"Null"});
                        if binary["right"]==null {self.expression(schema,&binary["left"],bindings,visited,Some("$presence"));return;}
                        if binary["left"]==null {self.expression(schema,&binary["right"],bindings,visited,Some("$presence"));return;}
                    }
                }
                if let Some(block) = fields.get("Block") {
                    let mut bindings = bindings.clone();
                    if let Some(stmts) = block["body"].as_array() {
                        for stmt in stmts {
                            for tag in ["Const", "Let", "Assign"] {
                                if let Some(binding) = stmt.get(tag) {
                                    if let Some(name) = binding["name"].as_str() { bindings.insert(name.into(), binding["value"].clone()); }
                                }
                            }
                            self.expression(schema, stmt, &bindings, visited, None);
                        }
                    }
                    self.expression(schema, &block["value"], &bindings, visited, field); return;
                }
                if let Some(name) = fields.get("Variable").and_then(Value::as_str) {
                    let key = format!("{name}:{field:?}");
                    if visited.insert(key) { if let Some(value) = bindings.get(name) { self.expression(schema, value, bindings, visited, field); } }
                    return;
                }
                if let Some(access) = fields.get("Field") {
                    self.expression(schema, &access["base"], bindings, visited, access["name"].as_str()); return;
                }
                if let Some(read) = fields.get("Get").or_else(|| fields.get("Exists")) {
                    let table = read["table"].as_str().unwrap();
                    self.population(schema, table); self.index(schema, table, read["index"].as_str().unwrap());
                    if fields.contains_key("Get") {
                        if let Some(column) = field { if column!="$presence" {self.column(schema, table, column);} }
                        else if let Some(t) = schema.table(table) { for column in t.columns.keys() { self.column(schema, table, column); } }
                    }
                    self.expression(schema, &read["key"], bindings, visited, None);
                    return;
                }
                // Scans/merges/recursion carry table/index pairs. Their filters,
                // ranges and projections are visited below; retain all row columns
                // where a lowered expression has no point-read projection.
                if let Some(table) = fields.get("table").and_then(Value::as_str) {
                    if let Some(index) = fields.get("index").and_then(Value::as_str) {
                        self.population(schema, table); self.index(schema, table, index);
                        if !fields.contains_key("key") {
                            if let Some(t) = schema.table(table) { for column in t.columns.keys() { self.column(schema, table, column); } }
                        }
                    }
                }
                for value in fields.values() { self.expression(schema, value, bindings, visited, None); }
            },
            Value::Array(items) => for value in items { self.expression(schema, value, bindings, visited, field); },
            _ => (),
        }
    }
}

pub(super) fn rule(schema: &Schema, owner: &str, rule: &RuleExpr, other: &RuleExpr) -> Dependencies {
    let mut deps = Dependencies::default();
    deps.0.insert("auth".into(), json!(schema.auth));
    deps.rule(schema, owner, rule); deps.rule(schema, owner, other); deps
}

// Resolve lexical temporaries and discard source locations, retaining the
// actual lowered guard implementation (including expanded function bodies).
fn resolved(value: &Value, bindings: &BTreeMap<String,Value>, visiting: &mut BTreeSet<String>) -> Value {
    match value {
        Value::Object(fields) => {
            if let Some(name)=fields.get("Variable").and_then(Value::as_str) {
                if let Some(bound)=bindings.get(name) {
                    if visiting.insert(name.into()) {let result=resolved(bound,bindings,visiting);visiting.remove(name);return result;}
                }
            }
            Value::Object(fields.iter().filter(|(k,_)|k.as_str()!="site").map(|(k,v)|(k.clone(),resolved(v,bindings,visiting))).collect())
        },
        Value::Array(items)=>Value::Array(items.iter().map(|v|resolved(v,bindings,visiting)).collect()),
        value=>value.clone(),
    }
}

fn guards(schema: &Schema, program: &ir::Program) -> Vec<Dependencies> {
    fn body(out: &mut Vec<Dependencies>, schema: &Schema, stmts: &[ir::Stmt], inherited: &BTreeMap<String, Value>, context: &[Value], inherited_effects: &[(BTreeSet<String>,Value)]) -> BTreeMap<String,Value> {
        fn stops(stmts: &[ir::Stmt]) -> bool {
            stmts.iter().any(|stmt|match stmt {ir::Stmt::Return(_) | ir::Stmt::Break | ir::Stmt::Continue=>true,ir::Stmt::If {then_body,else_body,..}=>stops(then_body)&&stops(else_body),_=>false})
        }
        let mut bindings = inherited.clone();
        let mut context=context.to_vec();
        let mut effects=inherited_effects.to_vec();
        for stmt in stmts {
            // Effects execute against the incoming lexical environment; a branch
            // join may overwrite the very condition that controlled its write.
            let wrapper=ir::Program {name:String::new(),kind:ir::ProgramKind::Mutation,args:BTreeMap::new(),read_time_granularity_ms:None,body:vec![stmt.clone()],returned_shapes:BTreeMap::new(),native:false};
            let writes=ir::write_tables(&wrapper).into_iter().map(|(table,_)|table).collect::<BTreeSet<_>>();
            let effect_inputs=(!writes.is_empty()).then(||resolved(&json!(stmt),&bindings,&mut BTreeSet::new()));
            match stmt {
                ir::Stmt::Const {name,value} | ir::Stmt::Let {name,value} | ir::Stmt::Assign {name,value} => {
                    bindings.insert(name.clone(), resolved(&json!(value),&bindings,&mut BTreeSet::new()));
                },
                ir::Stmt::Push {target,value} => {
                    bindings.insert(target.clone(),json!({"append":[bindings.get(target),resolved(&json!(value),&bindings,&mut BTreeSet::new())]}));
                },
                ir::Stmt::Require {condition,code,message,..} => {
                    let mut deps=Dependencies::default();
                    deps.0.insert("auth".into(), json!(schema.auth));
                    let condition=json!(condition);
                    for value in context.iter().chain(std::iter::once(&condition)) { deps.expression(schema, value, &bindings, &mut BTreeSet::new(), None); }
                    let mut retained=BTreeSet::new();
                    loop {
                        let mut added=false;
                        for (i,(tables,value)) in effects.iter().enumerate().rev() {
                            if !retained.contains(&i) && tables.iter().any(|table|deps.0.keys().any(|key|key.starts_with(&format!("{table}.")))) {
                                retained.insert(i);added=true;
                                deps.expression(schema,value,&bindings,&mut BTreeSet::new(),None);
                            }
                        }
                        if !added {break;}
                    }
                    let prior:Vec<_>=retained.iter().map(|i|&effects[*i].1).collect();
                    deps.0.insert("compiled guard".into(), resolved(&json!([context,condition,code,message,prior]),&bindings,&mut BTreeSet::new()));
                    out.push(deps);
                },
                ir::Stmt::If {condition,then_body,else_body} => {
                    let condition=resolved(&json!(condition),&bindings,&mut BTreeSet::new());
                    let mut branch=context.clone(); branch.push(condition.clone());
                    let yes=body(out,schema,then_body,&bindings,&branch,&effects);
                    let no=body(out,schema,else_body,&bindings,&branch,&effects);
                    let (yes_stops,no_stops)=(stops(then_body),stops(else_body));
                    for name in yes.keys().chain(no.keys()).cloned().collect::<BTreeSet<_>>() {
                        let (a,b)=(yes.get(&name),no.get(&name));
                        let value=if yes_stops && !no_stops {b.cloned()} else if no_stops && !yes_stops || a==b {a.cloned()}
                            else {Some(json!({"branch":condition,"then":a,"else":b}))};
                        if let Some(value)=value {bindings.insert(name,value);}
                    }
                    if yes_stops || no_stops {context.push(json!({"reachability":condition,"thenStops":yes_stops,"elseStops":no_stops}));}
                },
                ir::Stmt::For {binding,domain,body:stmts} => {
                    let mut loop_context=context.clone(); loop_context.push(resolved(&json!(domain),&bindings,&mut BTreeSet::new()));
                    let mut inner=bindings.clone();inner.insert(binding.clone(),json!(domain));
                    fn carried(stmts: &[ir::Stmt], context: &[Value], out: &mut BTreeMap<String,Vec<Value>>, exits: &mut Vec<Value>) {
                        for stmt in stmts {match stmt {
                            ir::Stmt::Const {name,value} | ir::Stmt::Let {name,value} | ir::Stmt::Assign {name,value}=>out.entry(name.clone()).or_default().push(json!([context,value])),
                            ir::Stmt::Push {target,value}=>out.entry(target.clone()).or_default().push(json!([context,value])),
                            ir::Stmt::If {condition,then_body,else_body}=>{
                                let mut branch=context.to_vec();branch.push(json!({"then":condition}));carried(then_body,&branch,out,exits);
                                let mut branch=context.to_vec();branch.push(json!({"else":condition}));carried(else_body,&branch,out,exits);
                            },
                            ir::Stmt::For {binding,domain,body}=>{
                                out.entry(binding.clone()).or_default().push(json!(domain));
                                let mut context=context.to_vec();context.push(json!(domain));carried(body,&context,out,exits);
                            },
                            ir::Stmt::Return(_) | ir::Stmt::Break | ir::Stmt::Continue=>exits.push(json!({"when":context,"exit":match stmt {ir::Stmt::Return(_)=>"return",ir::Stmt::Break=>"break",_=>"continue"}})),
                            _=>(),
                        }
                        if stops(std::slice::from_ref(stmt)) {break;}
                        }
                    }
                    let mut assignments=BTreeMap::new();let mut exits=Vec::new();carried(stmts,&[],&mut assignments,&mut exits);
                    for (name,values) in assignments {
                        inner.insert(name.clone(),json!({"loopCarried":[bindings.get(&name),values]}));
                    }
                    let exits=resolved(&json!(exits),&inner,&mut BTreeSet::new());
                    if exits.as_array().is_some_and(|values|!values.is_empty()) {loop_context.push(exits.clone());context.push(json!({"loopExit":domain,"controls":exits}));}
                    let mut loop_effects=effects.clone();
                    for stmt in stmts {
                        let wrapper=ir::Program {name:String::new(),kind:ir::ProgramKind::Mutation,args:BTreeMap::new(),read_time_granularity_ms:None,body:vec![stmt.clone()],returned_shapes:BTreeMap::new(),native:false};
                        let writes=ir::write_tables(&wrapper).into_iter().map(|(table,_)|table).collect::<BTreeSet<_>>();
                        if !writes.is_empty() {loop_effects.push((writes,resolved(&json!(stmt),&inner,&mut BTreeSet::new())));}
                    }
                    let after=body(out,schema,stmts,&inner,&loop_context,&loop_effects);
                    for name in bindings.keys().cloned().collect::<Vec<_>>() {
                        if bindings.get(&name)!=after.get(&name) {
                            bindings.insert(name.clone(),json!({"loop":loop_context,"before":bindings.get(&name),"after":after.get(&name)}));
                        }
                    }
                },
                _ => (),
            }
            if let Some(inputs)=effect_inputs {effects.push((writes,inputs));}
            if stops(std::slice::from_ref(stmt)) {break;}
        }
        bindings
    }
    let mut out=Vec::new();body(&mut out,schema,&program.body,&BTreeMap::new(),&[],&[]);out
}

fn arguments_changed(before: &ir::Program, after: &ir::Program, guards: impl Iterator<Item=Value>) -> bool {
    fn variables(value: &Value, names: &mut BTreeSet<String>) {
        match value {
            Value::Object(fields)=> {
                if fields.contains_key("Literal") {return;}
                if let Some(name)=fields.get("Variable").and_then(Value::as_str) {names.insert(name.into());}
                if let Some(name)=fields.get("ArgList").and_then(|arg|arg["name"].as_str()) {names.insert(name.into());}
                for value in fields.values() {variables(value,names);}
            },
            Value::Array(values)=>for value in values {variables(value,names);}, _=>(),
        }
    }
    let mut names=BTreeSet::new();for guard in guards {variables(&guard,&mut names);}
    names.iter().any(|name|before.args.get(name)!=after.args.get(name))
}

pub(super) fn changes(current: &Schema, before: &ir::Program, target: &Schema, after: &ir::Program, compare_implementation: bool) -> Vec<BTreeSet<String>> {
    if !compare_implementation {
        let mut old=Dependencies::default();let mut new=Dependencies::default();
        for program in [before,after] {
            for guard in guards(current,program) {old.0.extend(guard.0);}
            for guard in guards(target,program) {new.0.extend(guard.0);}
        }
        let arg_change=arguments_changed(before,after,guards(current,before).into_iter().chain(guards(target,after)).filter_map(|mut g|g.0.remove("compiled guard")));
        old.0.remove("compiled guard");new.0.remove("compiled guard");
        let mut changed=old.changed(&new);if arg_change {changed.insert("arguments".into());}
        return vec![changed];
    }
    let (mut old,mut new)=(guards(current,before),guards(target,after));
    if old.len()!=new.len() {return vec![BTreeSet::from(["compiled guard".into()])];}
    old.iter_mut().zip(&mut new).map(|(a,b)| {
        if !compare_implementation {a.0.remove("compiled guard");b.0.remove("compiled guard");}
        let arg_change=arguments_changed(before,after,[a.0.get("compiled guard").cloned().unwrap_or(Value::Null),b.0.get("compiled guard").cloned().unwrap_or(Value::Null)].into_iter());
        let mut changed=a.changed(b);if arg_change {changed.insert("arguments".into());}changed
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn compile(source: &str) -> Schema {
        let bound=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);bound.schema
    }
    fn population(schema: &Schema, name: &str) -> Dependencies {
        let mut deps=Dependencies::default();deps.population(schema,name);deps
    }
    #[test]
    fn consulted_timeline_metadata_changes_without_polluting_ordinary_tables() {
        let mut schema=compile(include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../snapback4-lang/tests/fixtures/timeline-v2.q")));
        let source=schema.timelines[0].posts[0].clone();
        let before=population(&schema,&source);
        schema.timelines[0].author_cap+=1;
        assert!(!before.changed(&population(&schema,&source)).is_empty());
        let ordinary=compile("table ordinary:\n  value: int\n  public\n  online only\n").tables.remove("ordinary").unwrap();
        schema.tables.insert("ordinary".into(),ordinary);
        let before=population(&schema,"ordinary");schema.timelines[0].author_cap+=1;
        assert!(before.changed(&population(&schema,"ordinary")).is_empty());
    }
    #[test]
    fn consulted_receipt_delivery_and_field_closure_metadata_changes() {
        let mut schema=compile(include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/../snapback4-lang/tests/fixtures/receipts/social.q")));
        let table=schema.receipts[0].messages.clone();
        let before=population(&schema,&table);schema.receipts[0].seen_field.push_str("changed");
        assert!(!before.changed(&population(&schema,&table)).is_empty());
        let before=population(&schema,&table);schema.receipt_dependencies.entry(table.clone()).or_default().insert("changed".into());
        assert!(!before.changed(&population(&schema,&table)).is_empty());
        let table=schema.delivery[0].table.clone();let before=population(&schema,&table);
        schema.delivery[0].fingerprint.push_str("changed");
        assert!(!before.changed(&population(&schema,&table)).is_empty());
    }
}
