//! A schema-driven covering matrix, not a list of concrete paired worlds.
//! Grammar productions declare the programs; compiled columns generate values,
//! compiled mutations generate operations, and Pair observes every query/channel.
use crate::disclosure::{Operation, Pair, Seed};
use serde_json::{Value as Json, json};
use snapback4_core::{ir::ProgramKind, schema::ColumnType};

#[allow(dead_code)]
pub struct Case {
    pub label: String,
    pub pair: Pair,
    pub predicts: bool,
}

// The type grammar is deliberately separate from the value generator. Adding a
// private field to a program automatically adds its boundaries to the matrix.
pub fn type_declarations() -> Vec<String> {
    let mut declarations = Vec::new();
    for (ty, default) in [
        ("int", "0"),
        ("time", "0"),
        ("bool", "false"),
        ("text <=10000000", "''"),
        ("id", "'zero'"),
        ("principal", "'bob'"),
        ("decimal 2", "0"),
        ("money USD 2", "0"),
        ("enum('zero', 'max')", "'zero'"),
        ("records", "'zero'"),
        ("json <=256", "0"),
    ] {
        declarations.push(format!("{ty} default {default}"));
        declarations.push(format!("{ty} ? default null"));
        // Lists cannot have literal array defaults; a nullable list can use null.
        declarations.push(format!("[{ty}] <=1 ? default null"));
    }
    // These types admit null defaults but have no non-null literal default.
    for ty in ["bytes <=256", "image <=256", "video <=256"] {
        declarations.push(format!("{ty} ? default null"));
        declarations.push(format!("[{ty}] <=1 ? default null"));
    }
    declarations
}

/// All boundary values come from ColumnType, including nullable/list recursion.
/// No field name or query/operation name selects a value.
pub fn values(kind: &ColumnType) -> Vec<Json> {
    match kind {
        ColumnType::Optional(inner) => {
            let mut result = vec![Json::Null];
            result.extend(values(inner));
            result
        }
        ColumnType::List { of, max } => {
            let mut result = vec![json!([])];
            for value in values(of) {
                result.push(Json::Array(vec![value; (*max).min(1) as usize]));
            }
            result
        }
        ColumnType::ListRange { of, min, max } => values(of).into_iter().flat_map(|value|
            [*min, min.saturating_add(1).min(*max)].map(|len| Json::Array(vec![value.clone(); len as usize]))
        ).collect(),
        ColumnType::Int
        | ColumnType::Time
        | ColumnType::Decimal { .. }
        | ColumnType::Money { .. } => vec![json!(0), json!(9_007_199_254_740_991i64)],
        ColumnType::Text { max } => vec![json!(""), json!("x".repeat(*max as usize))],
        ColumnType::Id | ColumnType::Ref { .. } => vec![json!("zero"), json!("max")],
        ColumnType::Principal => vec![json!("bob"), json!("carol")],
        ColumnType::Bool => vec![json!(false), json!(true)],
        ColumnType::Enum { variants } => variants.iter().map(|v| json!(v)).collect(),
        ColumnType::Bytes { max } => vec![json!(""), json!("ff".repeat(*max as usize))],
        ColumnType::Json { .. } => vec![json!({}), json!({"value":true})],
        ColumnType::Image { .. } | ColumnType::Video { .. } | ColumnType::File { .. } => {
            vec![json!({"id":"asset-zero"}), json!({"id":"asset-max"})]
        }
    }
}

fn compile(source: &str) -> snapback4_lang::Bound {
    let b = crate::generated::runtime_compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{}\n{:?}", source, b.diagnostics);
    b
}

pub fn program(declaration: &str) -> String {
    let default = declaration.split(" default ").nth(1).unwrap();
    format!(
        r#"
table records:
  owner: principal
  other: principal default 'alice'
  reader: principal default 'bob'
  secret: {declaration} written by .owner
  ownSecret: int default 0 written by .other
  label: int default 0
  title: text <=20 default 'public'
  by byWords: words(title), id
  immutable owner
  public
  insert <- allow
  update <- allow
  delete <- deny
  sync public
table likes:
  postId: records
  immutable postId
  public
  insert <- allow
  sync public
maintain received: count likes by postId.owner
  read <- allow
view activity:
  records {{ id, title, label }}
mutation insertRow(id: id):
  return insert records {{ id, owner: 'bob', secret: {default} }}
mutation insertAbsent(id: id):
  return insert records {{ id, owner: 'bob', secret: {default} }} if absent
mutation upsertRow(id: records):
  upsert records[id] {{ owner: 'bob', secret: {default} }}
mutation patch(id: records):
  update records[id] {{ secret: {default} }}
mutation refresh(id: records):
  update records[id] {{ label: 1 }}
  return true
mutation deleteRow(id: records):
  delete records[id]
mutation like(id: records):
  return insert likes {{ postId: id }}
mutation noop():
  return true
query one(id: records):
  return records[id]
query scalar(id: records):
  return records[id].secret
query page(c: cursor ?):
  return records after c first 1 by .id {{ * }}
query range():
  return records where .label >= 0 first 20 by .label
query planned():
  return activity first 20
query search():
  return records matching 'public' first 20
query counted():
  return count(records)
query summed():
  return sum(records, .label)
query maximum():
  best = 0
  for row in records:
    best = max(best, row.label)
  return best
query captures():
  return received first 20
"#
    )
}

fn pair(source: &str, seeds: [Seed; 2], op: &str, key: &str) -> Pair {
    Pair::new(
        source,
        seeds,
        "alice",
        Operation::new(op, json!({"id":key}), "alice"),
    )
    .query("one", json!({"id":"target"}))
    .query("scalar", json!({"id":"target"}))
    .query("page", json!({"c":null}))
}

fn seed(field: &str, value: Json, owner: &str) -> Seed {
    let mut row = json!({"id":"target","owner":owner,"other":"carol"});
    row[field] = value;
    let mut rows = vec![("records".into(), row)];
    for id in ["a", "z"] {
        rows.push((
            "records".into(),
            json!({"id":id,"owner":"bob","other":"carol"}),
        ));
    }
    rows
}

/// Emits one pair at a time: ten-megabyte endpoints never accumulate in a list.
pub fn visit(mut emit: impl FnMut(Case)) -> usize {
    let mut count = 0;
    let mut send = |label: String, pair: Pair, predicts: bool| {
        count += 1;
        emit(Case {
            label,
            pair,
            predicts,
        });
    };
    for declaration in type_declarations() {
        let source = program(&declaration);
        let b = compile(&source);
        for (table_name, table) in &b.schema.tables {
            for (field, authority) in &table.written_by {
                if authority.audience {
                    continue;
                }
                let variants = values(&table.columns[field]);
                for (endpoint, value) in variants.iter().enumerate().skip(1) {
                    let seeds = [
                        seed(field, variants[0].clone(), "bob"),
                        seed(field, value.clone(), "bob"),
                    ];
                    // Every declared mutation, not a manually selected write list.
                    for p in b
                        .programs
                        .iter()
                        .filter(|p| p.program.kind == ProgramKind::Mutation)
                    {
                        let p = &p.program;
                        send(
                            format!(
                                "payload/{declaration}/{table_name}.{field}/{endpoint}/{}",
                                p.name
                            ),
                            pair(&source, seeds.clone(), &p.name, "target"),
                            false,
                        );
                    }
                    // Every field is also varied beside another owner's patch.
                    for (patch_field, patch_authority) in &table.written_by {
                        if patch_field == field || patch_authority.owner == authority.owner {
                            continue;
                        }
                        let patch_owner = &patch_authority.owner;
                        let patch_default = snapback4_core::wire::to_json(
                            &table.defaults[patch_field].value(crate::disclosure::NOW, "alice"),
                        )
                        .to_string();
                        let comparison = if matches!(
                            &table.columns[patch_field],
                            ColumnType::Int | ColumnType::Time
                        ) {
                            format!("next.{patch_field} >= old.{patch_field}")
                        } else {
                            format!("next.{patch_field} = next.{patch_field}")
                        };
                        let owned_base = source.replace(
                            "update <- allow",
                            &format!(
                                "update (old, next) <- {comparison} and next.{field} = old.{field}"
                            ),
                        );
                        let owned_base = owned_base.replace("10000000", "1000000");
                        let owned_source = format!(
                            "{owned_base}\nmutation mark(id: records):\n  update records[id] {{ {patch_field}: {patch_default} }}\n  return true\n"
                        );
                        let mut owned = seeds.clone();
                        let owned_schema = compile(&owned_source);
                        let owned_values =
                            values(&owned_schema.schema.tables[table_name].columns[field]);
                        for (world, rows) in owned.iter_mut().enumerate() {
                            rows[0].1[patch_owner] = json!("alice");
                            rows[0].1[field] =
                                owned_values[if world == 0 { 0 } else { endpoint }].clone();
                        }
                        send(
                            format!("owned/{declaration}/{field}/{endpoint}/{patch_field}"),
                            pair(&owned_source, owned, "mark", "target"),
                            true,
                        );
                    }
                }
                // Row existence and owner identity are hidden only behind a row
                // audience. In this role Alice can insert but cannot read/update.
                let hidden = source
                    .replace(
                        "  public\n  insert <- allow\n  update <- allow",
                        "  read <- .reader = viewer\n  insert <- allow\n  update <- deny",
                    )
                    .replacen("  sync public", "  sync to .reader", 1)
                    .replace(
                        "maintain received: count likes by postId.owner\n  read <- allow\n",
                        "",
                    )
                    .replace("query captures():\n  return received first 20\n", "")
                    .replace("count(records)", "count(records[reader = viewer])")
                    .replace("sum(records,", "sum(records[reader = viewer],")
                    .replace(
                        "for row in records:",
                        "for row in records[reader = viewer]:",
                    );
                let h = compile(&hidden);
                for p in h
                    .programs
                    .iter()
                    .filter(|p| p.program.kind == ProgramKind::Mutation)
                {
                    let p = &p.program;
                    send(
                        format!("absence/{declaration}/{field}/{}", p.name),
                        pair(
                            &hidden,
                            [vec![], seed(field, variants.last().unwrap().clone(), "bob")],
                            &p.name,
                            "target",
                        ),
                        false,
                    );
                }
                for op in ["refresh", "deleteRow", "noop"] {
                    let mut same = seed(field, variants[0].clone(), "bob");
                    same[0].1[&authority.owner] = json!("alice");
                    send(
                        format!("owner/{declaration}/{field}/{op}"),
                        pair(
                            &hidden,
                            [same, seed(field, variants[0].clone(), "bob")],
                            op,
                            "target",
                        ),
                        false,
                    );
                }
            }
        }
        // Equality, inequality, all ordered operators allowed by the binder,
        // and both witness productions. Rules are generated per private field.
        transitions(&source, &mut send);
    }
    // Following's source is a declared program too; discover its private fields.
    for compat in [false, true] {
        let mut following = crate::cases::safe_following_for(compat);
        following.source = following.source.replace(
            "secret: int default 0",
            "secret: text <=10000000 default ''",
        );
        let b = compile(&following.source);
        for (name, table) in &b.schema.tables {
            for (field, a) in &table.written_by {
                if a.audience {
                    continue;
                }
                let variants = values(&table.columns[field]);
                for value in variants.iter().skip(1) {
                    let mut seeds = following.seeds.clone();
                    for (w, rows) in seeds.iter_mut().enumerate() {
                        for (t, row) in rows {
                            if t == name {
                                row[field] = if w == 0 {
                                    variants[0].clone()
                                } else {
                                    value.clone()
                                };
                            }
                        }
                    }
                    let p = Pair::new(
                        following.source.clone(),
                        seeds,
                        "alice",
                        following.operations[0].clone(),
                    )
                    .query("home", json!({"c":null}))
                    .query("cards", json!({"c":null}));
                    send(format!("following/{compat}/{name}.{field}"), p, false);
                }
            }
        }
    }
    // The read rule names the witness schema; enumerate the owner principals.
    memberships(&mut send);
    populations(&mut send);
    crate::disclosure::authorization::visit(&mut send);
    count
}

fn transitions(source: &str, send: &mut impl FnMut(String, Pair, bool)) {
    let b = compile(source);
    let table = &b.schema.tables["records"];
    for (field, _) in &table.written_by {
        let kind = &table.columns[field];
        let variants = values(kind);
        let mut predicates = vec![
            format!("next.{field} = old.{field}"),
            format!("next.{field} != old.{field}"),
        ];
        if matches!(kind.required(), ColumnType::Int | ColumnType::Time) {
            for op in [">=", ">", "<=", "<"] {
                predicates.push(format!("next.{field} {op} old.{field}"));
            }
        }
        // Probe keys must be indexable; lists are tested by self-comparison.
        if kind.is_indexable() {
            predicates.push(if matches!(kind.required(), ColumnType::Text { .. }) {
                format!("exists guesses[tag = 0, value = old.{field}]")
            } else {
                format!("exists guesses[value = old.{field}]")
            });
        }
        for predicate in predicates {
            let ty = kind.to_string();
            let extra = if predicate.starts_with("exists") {
                format!(
                    "\ntable guesses:\n  value: {ty}\n{}  public\n  sync public\n",
                    if matches!(kind.required(), ColumnType::Text { .. }) {
                        "  tag: int default 0\n  unique tag\n"
                    } else {
                        "  unique value\n"
                    }
                )
            } else {
                String::new()
            };
            // Nullable unique probes need an explicit presence guard. Text
            // probes use the total tag key plus a residual and keep nulls.
            let guarded = if predicate.starts_with("exists") && matches!(kind, ColumnType::Optional(_))
                && !matches!(kind.required(), ColumnType::Text { .. }) {
                format!("old.{field} != null and {predicate}")
            } else { predicate.clone() };
            let rule_source = source.replace(
                "update <- allow",
                &format!("update (old, next) <- {guarded}"),
            ) + &extra;
            let compiled = compile(&rule_source);
            // Walk actual rule references to select hidden inputs. This catches
            // new references added to a fixture without updating a case array.
            assert!(
                compiled.schema.tables["records"]
                    .rules
                    .update
                    .references_field(field)
            );
            for value in variants.iter().skip(1) {
                let mut seeds = [
                    seed(field, variants[0].clone(), "bob"),
                    seed(field, value.clone(), "bob"),
                ];
                if predicate.starts_with("exists") {
                    for rows in &mut seeds {
                        rows.push(("guesses".into(),json!({"id":"guess","value":if value.to_string().len() > 1024 { &variants[0] } else { value }})));
                    }
                }
                send(
                    format!("transition/{kind}/{field}/{guarded}"),
                    pair(&rule_source, seeds, "refresh", "target"),
                    false,
                );
            }
        }
    }
}

pub const MEMBERS: &str = r#"
table access:
  room: text <=20
  principal: principal
  unique room, principal
  read <- .principal = viewer
  sync to .principal
table notes:
  room: text <=20
  owner: principal
  other: principal
  secret: int default 0 written by .owner
  otherSecret: int default 0 written by .other
  read <- exists access[.room, viewer]
  sync to access[.room]
mutation mark(id: notes, n: int):
  for i in range(0, n):
    require true else BAD
  update notes[id] { secret: 9 }
  return true
query one(id: notes):
  return notes[id]
"#;

pub fn membership_pair() -> Pair {
    let rows = vec![
        (
            "access".into(),
            json!({"id":"a","room":"room","principal":"alice"}),
        ),
        (
            "notes".into(),
            json!({"id":"note","room":"room","owner":"alice","other":"bob","secret":1,"otherSecret":7}),
        ),
    ];
    let mut other = rows.clone();
    other.insert(
        1,
        (
            "access".into(),
            json!({"id":"b","room":"room","principal":"bob"}),
        ),
    );
    Pair::new(
        MEMBERS,
        [rows, other],
        "alice",
        Operation::new("mark", json!({"id":"note","n":0}), "alice"),
    )
    .query("one", json!({"id":"note"}))
}

fn memberships(send: &mut impl FnMut(String, Pair, bool)) {
    let base = membership_pair();
    let b = compile(&base.source);
    for authority in b.schema.tables["notes"].written_by.values() {
        let owner = base.seeds[0][1].1[&authority.owner].as_str().unwrap();
        if owner == "alice" {
            continue;
        }
        send(
            format!("membership/{owner}/absent-present"),
            membership_pair(),
            true,
        );
        let mut p = membership_pair();
        p.seeds[1][1].1["principal"] = json!("carol");
        send(format!("membership/{owner}/other-owner"), p, true);
    }
}

/// Cross omitted ordinary fields with private payload and population. All read
/// programs are observed by Pair, including views/search/streaming/Following.
fn populations(send: &mut impl FnMut(String, Pair, bool)) {
    for ordinary in ["extra: int ?", "extra: text <=20 ?"] {
        for present in [false, true] {
            for population in [1, 20, 32] {
                let source = program("text <=1000000 default ''").replacen("  label: int", &format!("  {ordinary}\n  label: int"), 1);
                let b = compile(&source);
                let endpoint = values(&b.schema.tables["records"].columns["secret"]).pop().unwrap();
                let seeds = [0,1].map(|world| (0..population).map(|n| {
                    let mut row = json!({"id":if n==0 {"target".into()} else {format!("row-{n:03}")},"owner":"bob","other":"carol","secret":if world==0 {json!("")}else{endpoint.clone()}});
                    if present { row["extra"] = Json::Null; }
                    ("records".into(),row)
                }).collect());
                send(format!("population/{ordinary}/{present}/{population}/reads"),pair(&source,seeds,"noop","target"),false);
                for compat in [false,true] {
                    let mut following = crate::cases::safe_following_for(compat);
                    following.source = following.source.replace("secret: int default 0", &format!("{ordinary}\n  secret: text <=1000000 default ''"));
                    for (world, seed) in following.seeds.iter_mut().enumerate() {
                        let original = seed.remove(0).1;
                        for n in 0..population {
                            let mut row = original.clone();
                            row["id"] = json!(if n==0 {"p".into()}else{format!("post-{n:03}")});
                            row["at"] = json!(n+5);
                            row["secret"] = if world==0 {json!("")}else{endpoint.clone()};
                            if present { row["extra"] = Json::Null; }
                            seed.push(("posts".into(),row));
                        }
                    }
                    following.operations.truncate(1);
                    send(format!("population/{ordinary}/{present}/{population}/following/{compat}"),following,false);
                }
            }
        }
    }
}

/// The pairs run the server's own refusals, including the private-field
/// page it refuses before walking (`E_FIELD_AUTHORITY`, "scope this read to
/// a uniformly readable audience"), which `check` now also refuses at the
/// page (LLP 3000.036 §17.3). That check runs after admission and leaves
/// the program bound, so dropping it here runs exactly the programs these
/// suites ran before; every other problem still fails the compile.
pub fn runtime_compile(sources: &[(String, String)]) -> snapback4_lang::Bound {
    let mut b = snapback4_lang::compile(sources);
    b.diagnostics.retain(|d| !(d.code == "E_FIELD_AUTHORITY" && d.message.contains("scope this read to a uniformly readable audience")));
    b
}
