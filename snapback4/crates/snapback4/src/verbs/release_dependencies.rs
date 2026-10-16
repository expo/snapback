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
        self.0.insert(key, json!([table.through, table.not_before, table.expire, table.ephemeral]));
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
            self.0.insert(format!("{name}.maintain"), json!(maintain));
            self.population(schema, &maintain.source);
            for column in schema.tables[&maintain.source].columns.keys() { self.column(schema, &maintain.source, column); }
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
                if let Some(object) = fields.get("Object").and_then(Value::as_object) {
                    for value in object.values() {self.expression(schema,value,bindings,visited,None);}
                    return;
                }
                if let Some(shape) = fields.get("Shape") {
                    self.expression(schema,&shape["base"],bindings,visited,None);
                    if let Some(object)=shape["fields"].as_object() {for value in object.values() {self.expression(schema,value,bindings,visited,None);}}
                    return;
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
                        if let Some(column) = field { self.column(schema, table, column); }
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
    fn body(out: &mut Vec<Dependencies>, schema: &Schema, stmts: &[ir::Stmt], inherited: &BTreeMap<String, Value>, context: &[Value]) -> BTreeMap<String,Value> {
        let mut bindings = inherited.clone();
        for stmt in stmts {
            match stmt {
                ir::Stmt::Const {name,value} | ir::Stmt::Let {name,value} | ir::Stmt::Assign {name,value} => {
                    bindings.insert(name.clone(), resolved(&json!(value),&bindings,&mut BTreeSet::new()));
                },
                ir::Stmt::Require {condition,code,message,..} => {
                    let mut deps=Dependencies::default();
                    deps.0.insert("auth".into(), json!(schema.auth));
                    let condition=json!(condition);
                    for value in context.iter().chain(std::iter::once(&condition)) { deps.expression(schema, value, &bindings, &mut BTreeSet::new(), None); }
                    deps.0.insert("compiled guard".into(), resolved(&json!([context,condition,code,message]),&bindings,&mut BTreeSet::new()));
                    out.push(deps);
                },
                ir::Stmt::If {condition,then_body,else_body} => {
                    let mut context=context.to_vec(); context.push(resolved(&json!(condition),&bindings,&mut BTreeSet::new()));
                    let yes=body(out,schema,then_body,&bindings,&context);
                    let no=body(out,schema,else_body,&bindings,&context);
                    for name in yes.keys().chain(no.keys()).cloned().collect::<BTreeSet<_>>() {
                        if yes.get(&name)!=no.get(&name) {
                            bindings.insert(name.clone(),json!({"branch":context.last(),"then":yes.get(&name),"else":no.get(&name)}));
                        }
                    }
                },
                ir::Stmt::For {binding,domain,body:stmts} => {
                    let mut context=context.to_vec(); context.push(resolved(&json!(domain),&bindings,&mut BTreeSet::new()));
                    let mut inner=bindings.clone();inner.insert(binding.clone(),json!(domain));
                    let after=body(out,schema,stmts,&inner,&context);
                    for name in bindings.keys().cloned().collect::<Vec<_>>() {
                        if bindings.get(&name)!=after.get(&name) {
                            bindings.insert(name.clone(),json!({"loop":context.last(),"before":bindings.get(&name),"after":after.get(&name)}));
                        }
                    }
                },
                _ => (),
            }
        }
        bindings
    }
    let mut out=Vec::new();body(&mut out,schema,&program.body,&BTreeMap::new(),&[]);out
}

fn arguments_changed(before: &ir::Program, after: &ir::Program, guards: impl Iterator<Item=Value>) -> bool {
    fn variables(value: &Value, names: &mut BTreeSet<String>) {
        match value {
            Value::Object(fields)=> {
                if fields.contains_key("Literal") {return;}
                if let Some(name)=fields.get("Variable").and_then(Value::as_str) {names.insert(name.into());}
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
