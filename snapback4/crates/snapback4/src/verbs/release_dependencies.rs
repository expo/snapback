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
        fn read_semantics(rule: &RuleExpr) -> RuleExpr {
            match rule {
                RuleExpr::Public {..}=>RuleExpr::Public {reason:String::new()},
                RuleExpr::And(parts)=>RuleExpr::And(parts.iter().map(read_semantics).collect()),
                RuleExpr::Or(parts)=>RuleExpr::Or(parts.iter().map(read_semantics).collect()),
                RuleExpr::Not(part)=>RuleExpr::Not(Box::new(read_semantics(part))),
                rule=>rule.clone(),
            }
        }
        // Public's explanation is operator prose, not a probe input.
        self.0.insert(format!("{name}.read"), json!(read_semantics(&table.rules.read)));
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
                if let Some(table)=fields.get("insertTarget").and_then(Value::as_str) {
                    self.population(schema,table);
                    if let Some(definition)=schema.table(table) {
                        self.0.insert(format!("{table}.unique"),json!(definition.indexes.iter().filter(|(_,index)|index.unique).collect::<BTreeMap<_,_>>()));
                        for (name,index) in &definition.indexes {if index.unique {self.index(schema,table,name);}}
                    }
                }
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
            // Literal values and authored field maps are data, never IR sites.
            if fields.contains_key("Literal") {return value.clone();}
            if let Some(object)=fields.get("Object").and_then(Value::as_object) {
                return json!({"Object":object.iter().map(|(name,value)|(name.clone(),resolved(value,bindings,visiting))).collect::<serde_json::Map<String,Value>>()});
            }
            if let Some(shape)=fields.get("Shape") {
                let fields=shape["fields"].as_object().unwrap().iter().map(|(name,value)|(name.clone(),resolved(value,bindings,visiting))).collect::<serde_json::Map<String,Value>>();
                return json!({"Shape":{"base":resolved(&shape["base"],bindings,visiting),"fields":fields}});
            }
            if let Some(name)=fields.get("Variable").and_then(Value::as_str) {
                if let Some(bound)=bindings.get(name) {
                    if visiting.insert(name.into()) {let result=resolved(bound,bindings,visiting);visiting.remove(name);return result;}
                }
            }
            // Only recognized read/scan/recurse, merge and Require records
            // carry ignorable location keys. Unknown records keep every field.
            let location=fields.get("site").is_some_and(|site|site.is_string()||site.is_null()) &&
                (fields.get("table").is_some_and(Value::is_string) && fields.get("index").is_some_and(Value::is_string)
                 || fields.get("code").is_some_and(Value::is_string) && fields.contains_key("condition")
                 || fields.get("lanes").is_some_and(Value::is_array));
            Value::Object(fields.iter().filter(|(k,_)|!location || k.as_str()!="site").map(|(k,v)|(k.clone(),resolved(v,bindings,visiting))).collect())
        },
        Value::Array(items)=>Value::Array(items.iter().map(|v|resolved(v,bindings,visiting)).collect()),
        value=>value.clone(),
    }
}

// Result definitions are shared by sequential and loop-carried data flow.
fn result_binding(stmt: &ir::Stmt) -> Option<(String,Value)> {
    match stmt {
        ir::Stmt::WriteTarget {target,patch,upsert,condition,result:Some(name)}=>Some((name.clone(),json!({"writeResult":[{"Get":target},patch,upsert,condition]}))),
        ir::Stmt::InsertIfAbsent {table,row,result}=>Some((result.clone(),json!({"insertResult":[{"insertTarget":table},{"Get":{"table":table,"index":"byId","key":[]}},row]}))),
        _=>None,
    }
}

fn guards(schema: &Schema, program: &ir::Program) -> Vec<Dependencies> {
    selected_guards(schema,program,&BTreeSet::new())
}
fn selected_guards(schema: &Schema, program: &ir::Program, excluded: &BTreeSet<String>) -> Vec<Dependencies> {
    fn nested(out: &mut Vec<Dependencies>,schema: &Schema,value: &Value,bindings: &BTreeMap<String,Value>,context: &[Value],effects: &[(BTreeSet<String>,Value)],excluded: &BTreeSet<String>) {
        match value {
            Value::Object(fields)=> {
                if fields.contains_key("Literal") {return;}
                if let Some(object)=fields.get("Object").and_then(Value::as_object) {
                    for value in object.values() {nested(out,schema,value,bindings,context,effects,excluded);}return;
                }
                if let Some(shape)=fields.get("Shape") {
                    nested(out,schema,&shape["base"],bindings,context,effects,excluded);
                    if let Some(fields)=shape["fields"].as_object() {for value in fields.values() {nested(out,schema,value,bindings,context,effects,excluded);}}return;
                }
                if let Some(block)=fields.get("Block") {
                    let statements:Vec<ir::Stmt>=serde_json::from_value(block["body"].clone()).expect("serialized IR block");
                    let (bindings,effects)=body(out,schema,&statements,bindings,context,effects,excluded);
                    nested(out,schema,&block["value"],&bindings,context,&effects,excluded);return;
                }
                if let Some(binary)=fields.get("Binary") {
                    nested(out,schema,&binary["left"],bindings,context,effects,excluded);
                    let mut branch=context.to_vec();
                    if matches!(binary["op"].as_str(),Some("And"|"Or")) {branch.push(resolved(&json!({"shortCircuit":binary["op"],"left":binary["left"]}),bindings,&mut BTreeSet::new()));}
                    nested(out,schema,&binary["right"],bindings,&branch,effects,excluded);return;
                }
                if let Some(builtin)=fields.get("Builtin") {
                    if builtin["builtin"].get("ExtremumOf").is_some() {
                        nested(out,schema,&builtin["args"][0],bindings,context,effects,excluded);
                        let source=resolved(&builtin["args"][0],bindings,&mut BTreeSet::new());
                        let mut projected=bindings.clone();projected.insert("$filter".into(),source.clone());
                        let mut context=context.to_vec();context.push(json!({"projectionSource":source}));
                        nested(out,schema,&builtin["args"][1],&projected,&context,effects,excluded);return;
                    }
                }
                if let Some(write)=fields.get("WriteTarget") {
                    for field in ["target","patch"] {nested(out,schema,&write[field],bindings,context,effects,excluded);}
                    if let Some(condition)=write.get("condition").filter(|value|!value.is_null()) {
                        let target=resolved(&json!({"Get":write["target"]}),bindings,&mut BTreeSet::new());
                        let mut inner=bindings.clone();inner.insert(condition["old"].as_str().expect("condition old binding").into(),target.clone());
                        let mut context=context.to_vec();context.push(json!({"writeTarget":target}));
                        let setup:Vec<ir::Stmt>=serde_json::from_value(condition["setup"].clone()).expect("serialized write condition");
                        let (inner,effects)=body(out,schema,&setup,&inner,&context,effects,excluded);
                        nested(out,schema,&condition["value"],&inner,&context,&effects,excluded);
                    }
                    return;
                }
                if fields.contains_key("scan") && fields.get("binding").is_some_and(Value::is_string) {
                    // Runtime guards precede discovery. Setup sees the discovery
                    // row; projection sees the target scan row after setup.
                    nested(out,schema,&value["guard"],bindings,context,effects,excluded);
                    let mut context=context.to_vec();context.push(json!({"laneGuard":resolved(&value["guard"],bindings,&mut BTreeSet::new())}));
                    let mut inner=bindings.clone();
                    if let Some(source)=fields.get("source").filter(|value|!value.is_null()) {
                        nested(out,schema,source,bindings,&context,effects,excluded);
                        let source=resolved(source,bindings,&mut BTreeSet::new());
                        inner.insert(fields["binding"].as_str().unwrap().into(),source.clone());context.push(json!({"laneSource":source}));
                    }
                    let setup:Vec<ir::Stmt>=fields.get("setup").map(|value|serde_json::from_value(value.clone()).expect("serialized lane setup")).unwrap_or_default();
                    let (mut inner,effects)=body(out,schema,&setup,&inner,&context,effects,excluded);
                    let scan=resolved(&json!({"Scan":fields["scan"]}),&inner,&mut BTreeSet::new());
                    nested(out,schema,&scan,&inner,&context,&effects,excluded);
                    for name in ["$project","$filter"] {inner.insert(name.into(),scan.clone());}
                    context.push(json!({"projectionSource":scan}));
                    for name in ["project","distinct"] {nested(out,schema,&value[name],&inner,&context,&effects,excluded);}return;
                }
                // Scan filters execute per admitted source row. Keep their
                // source population/key and avoid making the filter its own input.
                if let Some(scan)=fields.get("Scan").and_then(Value::as_object).or_else(|| (fields.contains_key("filter") && fields.get("table").is_some_and(Value::is_string) && fields.get("index").is_some_and(Value::is_string)).then_some(fields)) {
                    let source=Value::Object(scan.iter().filter(|(name,_)|name.as_str()!="filter").map(|(name,value)|(name.clone(),value.clone())).collect());
                    let mut inner=bindings.clone();inner.insert("$filter".into(),source.clone());
                    let mut context=context.to_vec();context.push(resolved(&source,bindings,&mut BTreeSet::new()));
                    if let Some(filter)=scan.get("filter") {nested(out,schema,filter,&inner,&context,effects,excluded);}
                    for value in source.as_object().unwrap().values() {nested(out,schema,value,bindings,&context,effects,excluded);}return;
                }
                for value in fields.values() {nested(out,schema,value,bindings,context,effects,excluded);}
            },
            Value::Array(values)=>for value in values {nested(out,schema,value,bindings,context,effects,excluded);},_=>(),
        }
    }
    fn body(out: &mut Vec<Dependencies>, schema: &Schema, stmts: &[ir::Stmt], inherited: &BTreeMap<String, Value>, context: &[Value], inherited_effects: &[(BTreeSet<String>,Value)], excluded: &BTreeSet<String>) -> (BTreeMap<String,Value>,Vec<(BTreeSet<String>,Value)>) {
        fn stops(stmts: &[ir::Stmt]) -> bool {
            stmts.iter().any(|stmt|match stmt {ir::Stmt::Return(_) | ir::Stmt::Break | ir::Stmt::Continue=>true,ir::Stmt::If {then_body,else_body,..}=>stops(then_body)&&stops(else_body),_=>false})
        }
        let mut bindings = inherited.clone();
        let mut context=context.to_vec();
        let mut effects=inherited_effects.to_vec();
        for stmt in stmts {
            // Expanded helpers can live in projection/filter expression blocks,
            // as well as ordinary statement bodies. Do not revisit branch bodies.
            let inputs=match stmt {ir::Stmt::If {condition,..}=>json!(condition),ir::Stmt::For {domain,..}=>json!(domain),_=>json!(stmt)};
            nested(out,schema,&inputs,&bindings,&context,&effects,excluded);
            // Effects execute against the incoming lexical environment; a branch
            // join may overwrite the very condition that controlled its write.
            let wrapper=ir::Program {name:String::new(),kind:ir::ProgramKind::Mutation,args:BTreeMap::new(),read_time_granularity_ms:None,body:vec![stmt.clone()],returned_shapes:BTreeMap::new(),native:false};
            let writes=ir::write_tables(&wrapper).into_iter().map(|(table,_)|table).collect::<BTreeSet<_>>();
            let effect_inputs=(!writes.is_empty() && !matches!(stmt,ir::Stmt::If {..}|ir::Stmt::For {..})).then(||resolved(&json!([context,stmt]),&bindings,&mut BTreeSet::new()));
            match stmt {
                ir::Stmt::Const {name,value} | ir::Stmt::Let {name,value} | ir::Stmt::Assign {name,value} => {
                    bindings.insert(name.clone(), resolved(&json!(value),&bindings,&mut BTreeSet::new()));
                },
                ir::Stmt::WriteTarget {result:Some(_),..} | ir::Stmt::InsertIfAbsent {..} => {
                    let (name,value)=result_binding(stmt).unwrap();
                    bindings.insert(name,resolved(&value,&bindings,&mut BTreeSet::new()));
                },
                ir::Stmt::Push {target,value} => {
                    bindings.insert(target.clone(),json!({"append":[bindings.get(target),resolved(&json!(value),&bindings,&mut BTreeSet::new())]}));
                },
                ir::Stmt::Require {condition,code,message,site} => {
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
                    if !site.as_ref().is_some_and(|site|excluded.contains(site)) {out.push(deps);}
                },
                ir::Stmt::If {condition,then_body,else_body} => {
                    let condition=resolved(&json!(condition),&bindings,&mut BTreeSet::new());
                    let mut branch=context.clone(); branch.push(json!({"then":condition}));
                    let (yes,yes_effects)=body(out,schema,then_body,&bindings,&branch,&effects,excluded);
                    *branch.last_mut().unwrap()=json!({"else":condition});
                    let (no,no_effects)=body(out,schema,else_body,&bindings,&branch,&effects,excluded);
                    for effect in yes_effects.into_iter().chain(no_effects) {if !effects.contains(&effect) {effects.push(effect);}}
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
                            ir::Stmt::WriteTarget {result:Some(_),..} | ir::Stmt::InsertIfAbsent {..}=>{
                                let (name,value)=result_binding(stmt).unwrap();out.entry(name).or_default().push(json!([context,value]));
                            },
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
                    // Collect individual writes with their own incoming bindings and
                    // branch controls, then expose them to later iterations.
                    let (_,loop_effects)=body(&mut Vec::new(),schema,stmts,&inner,&loop_context,&effects,excluded);
                    let (after,after_effects)=body(out,schema,stmts,&inner,&loop_context,&loop_effects,excluded);
                    for effect in after_effects {if !effects.contains(&effect) {effects.push(effect);}}
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
        (bindings,effects)
    }
    let mut out=Vec::new();body(&mut out,schema,&program.body,&BTreeMap::new(),&[],&[],excluded);out
}

fn arguments_changed(before: &ir::Program, after: &ir::Program, guards: impl Iterator<Item=Value>) -> bool {
    fn variables(value: &Value, names: &mut BTreeSet<String>) {
        match value {
            Value::Object(fields)=> {
                if fields.contains_key("Literal") {return;}
                if let Some(object)=fields.get("Object").and_then(Value::as_object) {
                    for value in object.values() {variables(value,names);}return;
                }
                if let Some(shape)=fields.get("Shape") {
                    variables(&shape["base"],names);
                    if let Some(object)=shape["fields"].as_object() {for value in object.values() {variables(value,names);}}return;
                }
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
    compare_guards(before,after,guards(current,before),guards(target,after))
}

pub(super) fn independent_changes(current: &Schema,before: &ir::Program,target: &Schema,after: &ir::Program,old_sites: &BTreeSet<String>,new_sites: &BTreeSet<String>) -> Vec<BTreeSet<String>> {
    compare_guards(before,after,selected_guards(current,before,old_sites),selected_guards(target,after,new_sites))
}

fn compare_guards(before: &ir::Program,after: &ir::Program,old: Vec<Dependencies>,new: Vec<Dependencies>) -> Vec<BTreeSet<String>> {
    (0..old.len().max(new.len())).map(|i| {
        let (Some(a),Some(b))=(old.get(i),new.get(i)) else {return BTreeSet::from(["compiled guard".into()]);};
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
    fn merge_projection_guards_keep_target_inputs_separate_from_discovery() {
        let bound=snapback4_lang::compile(&[("schema.q".into(),"table discovery:\n  value: int\n  public\n  online only\ntable targets:\n  value: int default 1\n  public\n  online only\nquery discover():\n  return discovery first 1 by .id\nquery target():\n  return targets first 1 by .id\n".into())]);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let scan=|name: &str| match &bound.programs.iter().find(|p|p.program.name==name).unwrap().program.body.last().unwrap() {
            ir::Stmt::Return(ir::Expr::Scan(scan))=>scan.clone(),other=>panic!("expected scan: {other:?}"),
        };
        let project=ir::Expr::Block {body:vec![ir::Stmt::Require {
            condition:ir::Expr::Binary {op:ir::BinaryOp::Gt,left:Box::new(ir::Expr::Field {base:Box::new(ir::var("$project")),name:"value".into()}),right:Box::new(ir::Expr::Literal(snapback4_core::Value::Int(0)))},
            code:"BLOCKED".into(),site:None,message:None,
        }],value:Box::new(ir::Expr::Literal(snapback4_core::Value::Bool(true)))};
        let merge:ir::Merge=serde_json::from_value(json!({"site":"test","lanes":[{"guard":null,"distinct":null,"branch":"target","project":project,"setup":[],"scan":scan("target"),"source":scan("discover"),"binding":"discovered"}]})).unwrap();
        let mut program=bound.programs[0].program.clone();program.kind=ir::ProgramKind::Mutation;
        program.body=vec![ir::Stmt::Return(ir::Expr::Merge(merge))];
        let schema=bound.schema;assert!(changes(&schema,&program,&schema,&program,true).iter().all(BTreeSet::is_empty));
        let mut target=schema.clone();target.tables.get_mut("targets").unwrap().defaults.insert("value".into(),snapback4_core::schema::ColumnDefault::Literal(snapback4_core::Value::Int(2)));
        assert_eq!(changes(&schema,&program,&target,&program,true),vec![BTreeSet::from(["targets".into()])]);
        let mut target=schema.clone();target.tables.get_mut("targets").unwrap().rules.read=RuleExpr::Deny;
        assert_eq!(changes(&schema,&program,&target,&program,true),vec![BTreeSet::from(["targets".into()])]);
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
