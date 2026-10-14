//! SplitMix64 gives stable seeds independent of crate versions and host RNGs.
use crate::ast::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};
use snapback4_core::Ceilings;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Case {
    pub seed: u64,
    pub program: Program,
    pub rows: Vec<(String, Json)>,
    pub principal: String,
    pub args: Json,
    pub clock: i64,
    pub budget: Ceilings,
    /// The prelude's inputs, one per `Program::prelude` mutation, in order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<Step>,
    /// The clock the rows are seeded at; `clock` when absent. Time advances
    /// from here through each step to `clock`, where `run` executes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seeded_at: Option<i64>,
    /// Sweep expired rows at `clock`, before `run`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sweep: bool,
}
/// One prelude mutation's input: its arguments, viewer and clock, and whether the
/// expired rows are swept (`sweep_expired`) at that clock before it runs.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Step {
    pub args: Json,
    pub at: i64,
    /// The step's viewer; the case's principal when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewer: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sweep: bool,
}
/// Labels: empty, ASCII, private use, outside the BMP, an emoji, and a
/// precomposed and a decomposed `é` (distinct texts, code-point ordered).
pub const TEXTS: [&str; 7] = ["", "a", "\u{e000}", "\u{10000}", "\u{1f600}", "\u{e9}", "e\u{301}"];
/// Integers at and near the i53 bounds.
pub const VALUES: [i64; 7] = [
    0,
    1,
    -1,
    9_007_199_254_740_991,
    -9_007_199_254_740_991,
    9_007_199_254_740_990,
    -9_007_199_254_740_990,
];
pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }
    pub fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    pub fn pick(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// Give every generated access row a required item reference, add the total
/// `(item, principal)` membership point and ensure the case viewer holds one.
/// PAGE2 then discovers target ids through `(principal, item)` and opens a
/// fully pinned physical byId lane for each target.
pub(crate) fn id_membership(case: &mut Case) {
    let items = case.rows.iter().filter(|(table, _)| table == "items")
        .filter_map(|(_, row)| row["id"].as_str().map(str::to_owned)).collect::<Vec<_>>();
    let access = case.program.tables.iter_mut().find(|table| table.name == "access").expect("generated access table");
    access.columns.push(column("item", Type::Reference("items".into())));
    // The competing `(bucket, principal)` unique proves that every positional
    // planner resolves intrinsic `.id` by its focal-table reference type.
    access.keys.push(("byItem".into(), vec!["item".into(), "principal".into()], true));
    access.keys.push(("byPrincipalItem".into(), vec!["principal".into(), "item".into()], false));
    if items.is_empty() {
        case.rows.retain(|(table, _)| table != "access");
        return;
    }
    let mut viewer = false;
    let mut n = 0;
    for (table, row) in &mut case.rows {
        if table != "access" { continue; }
        row.as_object_mut().expect("generated access row").insert("item".into(), json!(items[n % items.len()]));
        viewer |= row["principal"] == case.principal;
        n += 1;
    }
    let mut pairs = std::collections::BTreeSet::new();
    case.rows.retain(|(table, row)| table != "access" || pairs.insert((row["item"].to_string(), row["principal"].to_string())));
    if !viewer {
        case.rows.push(("access".into(), json!({"id":format!("page-id-{}", case.seed),
            "bucket":0,"principal":case.principal,"item":items[n % items.len()]})));
    }
}

/// Make an uncapped positional membership point nullable while a separate
/// fully fixed total unique bounds its inverted discovery to one source row.
pub(crate) fn discovery_unique_membership(case: &mut Case) {
    let items = &mut case.program.tables[0];
    items.effects = Some(vec![Rule::OwnerOrWitness, Rule::Allow, Rule::Allow, Rule::Allow]);
    let access = case.program.tables.iter_mut().find(|table| table.name == "access")
        .expect("generated access table");
    access.columns.iter_mut().find(|column| column.name == "bucket")
        .expect("generated membership parent").ty = Type::Nullable(Box::new(Type::Int));
    access.keys.push(("byPrincipalOnly".into(), vec!["principal".into()], true));
    access.rule = Rule::Member;
    access.effects = Some(vec![Rule::Member, Rule::Allow, Rule::Allow, Rule::Allow]);
    access.residency = Residency::Online;
    let bucket = case.args["bucket"].as_u64().expect("generated bucket");
    let viewer = case.principal.clone();
    let other = if viewer == "alice" { "bob" } else { "alice" };
    case.rows.retain(|(table, _)| table != "access");
    case.rows.push(("access".into(), json!({"id":"discovery-viewer", "bucket":bucket, "principal":viewer})));
    case.rows.push(("access".into(), json!({"id":"discovery-other", "bucket":1 - bucket, "principal":other})));
    case.program.membership_named_reordered = false;
}

fn column(name: &str, ty: Type) -> Column {
    Column {
        name: name.into(),
        ty,
    }
}
fn binary(op: Bin, a: Expr, b: Expr) -> Expr {
    Expr::Binary(op, Box::new(a), Box::new(b))
}
/// The base case for `seed`, widened (`crate::widen`) from an independent
/// stream: a seed whose widening draws nothing is the base case unchanged.
pub fn generate(seed: u64) -> Case {
    crate::widen::widen(base(seed))
}
pub fn base(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let mode = rng.pick(4);
    let rule = [Rule::Allow, Rule::Deny, Rule::Owner, Rule::Witness][mode as usize].clone();
    let residency = if rng.pick(2) == 0 {
        Residency::Online
    } else {
        match mode {
            0 => Residency::Public,
            2 => Residency::Owner,
            _ => Residency::Online,
        }
    };
    let table = Table {
        name: "items".into(),
        columns: vec![
            column("owner", Type::Principal),
            column("bucket", Type::Int),
            column("score", Type::Int),
            column("label", Type::Text),
            column("flag", Type::Bool),
            column("maybe", Type::Nullable(Box::new(Type::Int))),
            column("tag", Type::Id),
        ],
        keys: vec![
            (
                "byLabel".into(),
                vec!["bucket".into(), "label".into(), "score".into(), "id".into()],
                false,
            ),
            ("byTag".into(), vec!["tag".into()], true),
        ],
        caps: vec![],
        rule,
        residency,
        effects: None,
        expire: None,
        not_before: None,
    };
    let access = Table {
        name: "access".into(),
        columns: vec![
            column("bucket", Type::Int),
            column("principal", Type::Principal),
        ],
        keys: vec![
            ("byMember".into(), vec!["bucket".into(), "principal".into()], true),
            ("byPrincipal".into(), vec!["principal".into(), "bucket".into()], false),
        ],
        caps: vec![(16, vec!["principal".into()])],
        rule: Rule::Allow,
        residency: Residency::Public,
        effects: None,
        expire: None,
        not_before: None,
    };
    let values = VALUES;
    let a = values[rng.pick(values.len() as u64) as usize];
    let b = values[rng.pick(values.len() as u64) as usize];
    let arithmetic = binary(
        if rng.pick(2) == 0 { Bin::Add } else { Bin::Mul },
        Expr::Arg("a".into(), Type::Int),
        Expr::Arg("b".into(), Type::Int),
    );
    let bad = binary(
        Bin::Eq,
        Expr::Assert(Box::new(Expr::Arg(
            "n".into(),
            Type::Nullable(Box::new(Type::Int)),
        ))),
        Expr::Int(0),
    );
    let body = match rng.pick(33) {
        0 => Body::Scalar(binary(Bin::Add, Expr::Int(1), Expr::Int(2))),
        1..=3 => Body::Scalar(arithmetic.clone()),
        4..=7 => Body::Scalar(binary(Bin::Or, Expr::Bool(true), bad.clone())),
        8..=11 => Body::Scalar(binary(Bin::And, Expr::Bool(false), bad)),
        12 => Body::Scalar(binary(
            Bin::Eq,
            Expr::Text("𐀀".into()),
            Expr::Text("\u{e000}".into()),
        )),
        13 => Body::Scalar(Expr::Assert(Box::new(Expr::Arg(
            "n".into(),
            Type::Nullable(Box::new(Type::Int)),
        )))),
        14 => Body::Scalar(binary(
            Bin::Add,
            Expr::Identity(Box::new(Expr::Int(1))),
            Expr::Identity(Box::new(Expr::Int(2))),
        )),
        15 => Body::Scalar(Expr::Bool(rng.pick(2) == 0)),
        16 => Body::Read {
            kind: Read::Point,
            take: 1,
            descending: false,
            filter: false,
            owner: false,
            project: None,
        },
        17..=23 => Body::Read {
            kind: Read::Page,
            take: (rng.pick(6) + 3) as u32,
            descending: rng.pick(2) == 0,
            filter: rng.pick(2) == 0,
            owner: mode == 2,
            project: None,
        },
        n @ 24..=28 => Body::Read {
            kind: [Read::Bounded, Read::Count, Read::Sum, Read::Min, Read::Max][(n - 24) as usize]
                .clone(),
            take: (rng.pick(4) + 1) as u32,
            descending: rng.pick(2) == 0,
            filter: rng.pick(2) == 0,
            owner: mode == 2,
            project: None,
        },
        n => Body::Write(
            [Write::Insert, Write::Upsert, Write::Update, Write::Delete][(n - 29) as usize].clone(),
            arithmetic,
        ),
    };
    let pageable = matches!(
        body,
        Body::Read {
            kind: Read::Page,
            ..
        }
    );
    let bucket = rng.pick(2);
    let mut rows = vec![];
    let texts = ["", "a", "\u{e000}", "𐀀", "😀", "é", "é"];
    for i in 0..if pageable {
        6 + rng.pick(9)
    } else {
        rng.pick(6)
    } {
        rows.push(("items".into(), json!({"id":format!("r{i}"), "owner":if rng.pick(2)==0 {"alice"} else {"bob"}, "bucket":if pageable {bucket} else {rng.pick(2)}, "score":values[rng.pick(values.len() as u64) as usize], "label":texts[rng.pick(texts.len() as u64) as usize], "flag":rng.pick(4)!=0, "maybe":if rng.pick(2)==0 {Json::Null} else {json!(a)}, "tag":format!("tag{i}")})));
    }
    for principal in ["alice", "bob"] {
        for bucket in 0..2 {
            if rng.pick(4) != 0 {
                rows.push(("access".into(), json!({"id":format!("{principal}{bucket}"), "bucket":bucket, "principal":principal})));
            }
        }
    }
    Case {
        seed,
        program: Program {
            tables: vec![table, access],
            body: body.clone(),
            lets: vec![("unused".into(), Expr::Int(rng.pick(10) as i64))],
            bind_return: false,
            reverse: false,
            helper: true,
            order: None,
            named_page_order: None,
            principal_arg: None,
            residual: None,
            domain: None,
            guard: None,
            membership_named_reordered: false,
            boolean_grant_normalized: false,
            upsert_unique_tag: None,
            search_term: None,
            prelude: vec![],
            time_arg: false,
            arg_bound: None,
            kids: None,
        },
        rows,
        principal: if rng.pick(2) == 0 { "alice" } else { "bob" }.into(),
        args: json!({"key":if rng.pick(2)==0 {"r0"} else {"missing"}, "bucket":bucket, "c":null, "n":if matches!(body, Body::Scalar(Expr::Binary(Bin::Or | Bin::And, ..))) || rng.pick(2)==0 {Json::Null} else {json!(a)}, "a":a,"b":b}),
        clock: 1000 + rng.pick(100000) as i64,
        budget: Ceilings {
            steps: 10000 + rng.pick(10000),
            ..Ceilings::default()
        },
        steps: vec![],
        seeded_at: None,
        sweep: false,
    }
}

/// PAGE3 independent stream: ordinary complete pages with pure membership,
/// compound grants/memberships and static role residuals. No bound IR edits.
pub(crate) fn page3(case: &mut Case) {
    use crate::ast::{Body, Read, Rule, Residency, Type};
    let mut rng = Rng::new(case.seed ^ 0x5041_4745_335f_454e);
    if rng.pick(6) != 0 { return; }
    let Body::Read { kind: kind @ (Read::Page | Read::Bounded), filter, owner, project, .. } = &mut case.program.body else { return };
    *kind = Read::Page; *filter = false; *owner = false; *project = None;
    let shape = rng.pick(6);
    case.program.domain = Some("true".into());
    case.program.order = Some(vec!["id".into()]);
    case.program.residual = None; case.program.guard = None;
    case.program.search_term = None; case.program.boolean_grant_normalized = false;
    case.program.membership_named_reordered = false;
    let rule = match shape { 0 => Rule::Witness, 1 => Rule::PureIdWitness, 2 => Rule::CompoundGrant, 3 => Rule::CompoundMembership, 4 => Rule::RoleGrant, _ => Rule::OwnerOrGrant };
    if shape == 5 { case.program.domain = Some(".owner = viewer or exists access[0, viewer]".into()); }
    let items = &mut case.program.tables[0];
    items.rule = rule; items.effects = None; items.residency = Residency::Online;
    let access = case.program.tables.iter_mut().find(|t| t.name == "access").unwrap();
    access.rule = Rule::Member; access.effects = None; access.residency = Residency::Member;
    access.expire = None; access.not_before = None;
    if rng.pick(2) == 0 { access.caps.clear(); }
    if shape == 1 && !access.columns.iter().any(|column| column.name == "item") { id_membership(case); }
    if shape == 4 {
        let access = case.program.tables.iter_mut().find(|t| t.name == "access").unwrap();
        if !access.columns.iter().any(|column| column.name == "role") { access.columns.push(column("role", Type::Text)); }
        for (name, row) in &mut case.rows { if name == "access" { row["role"] = json!(if rng.pick(2) == 0 { "admin" } else { "staff" }); } }
    }
}

/// Wave-11 contextual reference family. Keep the sources independent of IR;
/// the explicit spelling is a metamorphic oracle for the contextual spelling.
// @ref LLP 3000.036.002#8 — inserted/lookup snapshots project only in reference contexts.
pub fn qdiag(seed:u64) -> (Case,String,String) {
    let mut case=base(seed);
    case.program.body=Body::Block(Block { stmts:vec![],ret:Expr::Bool(true) });
    case.program.prelude.clear(); case.steps.clear(); case.rows.clear(); case.budget=Ceilings::default();
    case.args=json!({"key":"new-parent","k2":"new-child","bucket":0,"c":null,"n":null,"a":0,"b":1});
    let mut rng=Rng::new(seed);
    let (owner,visible)=(if rng.pick(2)==0 {"alice"} else {"bob"},rng.pick(2)==0);
    if rng.pick(3)==0 { case.rows.push(("kids".into(),json!({"id":"old-child","item":"new-parent","owner":owner}))); }
    let read=if visible {"allow"} else {".owner = viewer"};
    let implicit=format!("table items:\n  sibling: items ? on delete keep\n  unique sibling\n  owner: principal\n  label: text <=64\n  public\n  insert <- allow\n  sync public\ntable kids:\n  item: items on delete keep\n  owner: principal\n  unique item\n  read <- {read}\n  insert <- allow\n  online only\nmutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):\n  item = insert items {{ id:key, owner:viewer, label:'parent' }}\n  insert kids {{ id:k2, item, owner:viewer }}\n  seen = items[items[key] ! else NOT_FOUND] ! else NOT_FOUND\n  return seen.id\nquery observe(key: id, k2: id):\n  return {{ item:items[key], child:kids[k2] }}\n");
    let explicit=implicit.replace("id:k2, item, owner","id:k2, item:item.id, owner").replace("items[items[key] ! else NOT_FOUND]","items[(items[key] ! else NOT_FOUND).id]");
    (case,implicit,explicit)
}

// @ref LLP 3000.036.001#17 — independent surface generation of mixed,
// exact-scope, pinned-pair, parent-snapshot and online search families.
pub(crate) fn page4(case: &mut Case) {
    let mut rng=Rng::new(case.seed ^ 0x5041_4745_345f_454e);
    if rng.pick(6)!=0 {return;}
    let Body::Read {kind: kind @ (Read::Page | Read::Bounded),filter,owner,project,..}=&mut case.program.body else {return};
    *kind=Read::Page;*filter=false;*owner=false;*project=None;
    if case.program.tables.iter().any(|table| table.name=="access" && table.columns.iter().any(|column|matches!(column.ty, Type::Nullable(_)))) {return;}
    let shape=rng.pick(9);
    // These are read families; old widened writes must not omit a newly
    // introduced schema column or mutate this family's seeded authority.
    case.program.prelude.clear();case.steps.clear();
    case.args.as_object_mut().unwrap().remove("k2");
    case.program.named_page_order=None;case.program.principal_arg=None;case.args.as_object_mut().unwrap().remove("manager");
    case.program.domain=Some("true".into());case.program.order=Some(vec!["id".into()]);
    case.program.residual=None;case.program.guard=None;case.program.search_term=None;
    case.program.membership_named_reordered=false;case.program.boolean_grant_normalized=false;
    case.program.tables[0].effects=None;case.program.tables[0].residency=Residency::Online;
    let access=case.program.tables.iter_mut().find(|t|t.name=="access").unwrap();
    access.effects=Some(vec![Rule::Member,Rule::Deny,Rule::Deny,Rule::Deny]);access.rule=Rule::Member;access.residency=Residency::Member;
    access.expire=None;access.not_before=None;access.caps.clear();
    case.program.tables[0].rule=match shape {0|7=>Rule::OwnerPublicMember,8=>Rule::OwnerOrWitness,1=>Rule::OwnerPublicIdMember,2=>Rule::OwnerOrWitness,3=>Rule::PairWitness,6=>Rule::NegativeGrant,_=>Rule::Witness};
    if shape==7 {
        let items=&mut case.program.tables[0];
        items.keys.retain(|(name,_,_)|name!="byPage4");
        items.keys.push(("byPage4".into(),vec!["score".into(),"id".into()],false));
        case.program.order=Some(vec!["score".into()]);case.program.named_page_order=Some("byPage4".into());
    }
    if shape==8 {case.program.domain=Some(".bucket = bucket".into());}
    if shape==1 && !case.program.tables.iter().find(|t|t.name=="access").unwrap().columns.iter().any(|c|c.name=="item") {id_membership(case);}
    if shape==2 {case.program.domain=Some("exists access[.bucket, viewer]".into());}
    if shape==3 {
        let items=&mut case.program.tables[0];
        if !items.columns.iter().any(|c|c.name=="helper") {items.columns.push(column("helper",Type::Principal));}
        let access=case.program.tables.iter_mut().find(|t|t.name=="access").unwrap();
        if !access.columns.iter().any(|c|c.name=="helper") {access.columns.push(column("helper",Type::Principal));}
        access.keys.retain(|(name,_,_)|name!="byPairPrincipal");
        access.keys.push(("byPairPrincipal".into(),vec!["principal".into()],true));
        access.rule=Rule::Allow;access.effects=Some(vec![Rule::Allow,Rule::Deny,Rule::Deny,Rule::Deny]);access.residency=Residency::Public;
        let mut principals=std::collections::BTreeSet::new();
        case.rows.retain(|(table,row)| table!="access" || principals.insert(row["principal"].as_str().unwrap().to_owned()));
        for (table,row) in &mut case.rows {if table=="access" {row["helper"]=json!(if row["principal"]=="alice" {"bob"} else {"alice"});}}
        for (t,row) in &mut case.rows {if t=="items" {row["helper"]=json!(if rng.pick(2)==0 {"alice"}else{"bob"});}}
    }
    if shape==3 && rng.pick(2)==0 {
        case.program.principal_arg=Some("manager".into());case.program.domain=Some(".helper = manager".into());
        case.args["manager"]=json!(if rng.pick(2)==0 {"alice"}else{"bob"});
    }
    if shape==4 {
        if !case.program.tables.iter().any(|t|t.name=="parents") {
            case.program.tables.push(Table {name:"parents".into(),columns:vec![],keys:vec![],caps:vec![],rule:Rule::Allow,residency:Residency::Public,effects:None,expire:None,not_before:None});
        }
        case.rows.retain(|(table,row)|table!="parents" || row["id"]!="parent");
        case.program.lets.retain(|(name,_)|name!="parent");
        case.rows.push(("parents".into(),json!({"id":"parent"})));
        case.args["key"]=json!("parent");
        case.program.lets.push(("parent".into(),Expr::Assert(Box::new(Expr::Point("parents".into(),Key::Key)))));
        case.program.domain=Some(".tag = parent.id".into());
        case.program.tables[0].residency=Residency::Group;
        case.program.tables[0].columns.iter_mut().find(|column| column.name=="tag").unwrap().ty=Type::Id;
        let mut assigned=false;
        for (t,row) in &mut case.rows {if t=="items" && !assigned && rng.pick(2)==0 {row["tag"]=json!("parent");assigned=true;}}
    }
    if shape==5 {
        let items=&mut case.program.tables[0];
        items.keys.retain(|(name,_,_)|name!="byWords");
        items.keys.push(("byWords".into(),vec!["words(label)".into(),"score".into(),"id".into()],false));
        case.program.search_term=Some(if rng.pick(2)==0 {"a"}else{""}.into());case.program.order=Some(vec!["score".into()]);
    }
}

pub(crate) fn page4_features(case: &Case) -> Vec<String> {
    let family=match case.program.tables[0].rule {
        Rule::OwnerPublicMember if case.program.named_page_order.is_some()=>Some("named-plain-page"),
        Rule::OwnerPublicMember=>Some("mixed-public-member"),Rule::OwnerPublicIdMember=>Some("mixed-public-id"),Rule::PairWitness if case.program.principal_arg.is_some()=>Some("pinned-pair-argument"),Rule::PairWitness=>Some("pinned-pair"),Rule::NegativeGrant=>Some("negative-readable-grant"),
        Rule::OwnerOrWitness if case.program.domain.as_deref()==Some(".bucket = bucket")=>Some("pinned-membership-party"),
        Rule::OwnerOrWitness if case.program.domain.as_deref()==Some("exists access[.bucket, viewer]")=>Some("exact-where-scope"),
        Rule::Witness if case.program.domain.as_deref()==Some(".tag = parent.id")=>Some("parent-snapshot"),
        Rule::Witness if case.program.search_term.is_some() && case.program.order.as_ref().is_some_and(|order|order==&["score"])=>Some("online-membership-search"),
        _=>None,
    };
    family.map(|name|vec![format!("page4/{name}")]).unwrap_or_default()
}

/// PAGE5's three new planner families are generated independently so their
/// evidence does not depend on the broader widening stream selecting a page.
// @ref LLP 3000.036.001#18 — bounded products, fixed+varying grants and exact vacancy all receive generated cases.
pub fn page5(seed: u64, shape: u64) -> Case {
    let mut case = base(seed);
    let mut rng = Rng::new(seed ^ 0x5041_4745_355f_454e ^ shape);
    case.program.body = Body::Read { kind: Read::Page, take: 1 + rng.pick(3) as u32,
        descending: rng.pick(2) == 0, filter: false, owner: false, project: None };
    case.program.prelude.clear(); case.steps.clear(); case.program.lets.clear();
    case.program.order = Some(vec!["id".into()]); case.program.named_page_order = None;
    case.program.principal_arg = None; case.program.residual = None; case.program.guard = None;
    case.program.search_term = None; case.program.membership_named_reordered = false;
    case.program.boolean_grant_normalized = false; case.program.kids = None;
    case.program.tables[0].effects = None; case.program.tables[0].residency = Residency::Online;
    let bucket = case.args["bucket"].as_u64().unwrap_or(0);
    match shape % 3 {
        0 => {
            case.program.tables[0].rule = Rule::ProductScope;
            case.program.domain = Some("(.owner = viewer or .helper = viewer) and (.status = 'open' or .status = 'active')".into());
            let items = &mut case.program.tables[0];
            if !items.columns.iter().any(|column| column.name == "helper") { items.columns.push(column("helper", Type::Principal)); }
            if !items.columns.iter().any(|column| column.name == "status") { items.columns.push(column("status", Type::Text)); }
            for (table, row) in &mut case.rows { if table == "items" {
                row["helper"] = json!(if rng.pick(2) == 0 { "alice" } else { "bob" });
                row["status"] = json!(["open", "active", "closed"][rng.pick(3) as usize]);
            }}
        }
        1 => {
            case.program.tables[0].rule = Rule::FixedPerRow;
            case.program.domain = Some(".bucket = bucket".into());
            case.program.order = Some(vec!["score".into()]);
            id_membership(&mut case);
            let access = case.program.tables.iter_mut().find(|table| table.name == "access").unwrap();
            access.rule = Rule::Member; access.effects = None; access.residency = Residency::Online;
            access.expire = None; access.not_before = None; access.caps.clear();
            access.keys.iter_mut().find(|(name, _, _)| name == "byItem").unwrap().1 =
                vec!["item".into(), "bucket".into(), "principal".into()];
            access.keys.retain(|(name, _, _)| name != "byMember");
            for (table, row) in &mut case.rows {
                if table == "access" { row["bucket"] = json!(bucket); }
            }
            let roles = Table { name: "roles".into(), columns: vec![column("bucket", Type::Int), column("principal", Type::Principal)],
                keys: vec![("byBucketPrincipal".into(), vec!["bucket".into(), "principal".into()], true)], caps: vec![],
                rule: Rule::Member, residency: Residency::Online, effects: None, expire: None, not_before: None };
            case.program.tables.push(roles);
            let seats = Table { name: "seats".into(), columns: vec![column("bucket", Type::Int), column("principal", Type::Principal)],
                keys: vec![("byBucketPrincipal".into(), vec!["bucket".into(), "principal".into()], true)], caps: vec![],
                rule: Rule::Member, residency: Residency::Online, effects: None, expire: None, not_before: None };
            case.program.tables.push(seats);
            if rng.pick(4) != 0 { case.rows.push(("roles".into(), json!({"id":format!("role-{seed}"), "bucket":bucket, "principal":case.principal}))); }
            if rng.pick(4) != 0 { case.rows.push(("seats".into(), json!({"id":format!("seat-{seed}"), "bucket":bucket, "principal":case.principal}))); }
        }
        _ => {
            case.program.tables[0].rule = Rule::Vacancy;
            case.program.domain = Some("true".into());
            id_membership(&mut case);
            let access = case.program.tables.iter_mut().find(|table| table.name == "access").unwrap();
            access.rule = Rule::Member; access.effects = None; access.residency = Residency::Online;
            access.expire = None; access.not_before = None; access.caps.clear();
            access.keys.retain(|(name, _, _)| name == "byItem");
            access.keys.iter_mut().for_each(|(_, columns, unique)| { *columns = vec!["item".into()]; *unique = true; });
            let mut items = std::collections::BTreeSet::new();
            case.rows.retain(|(table, row)| table != "access" || items.insert(row["item"].to_string()));
        }
    }
    case
}

pub(crate) fn page5_features(case: &Case) -> Vec<String> {
    let family = match case.program.tables[0].rule {
        Rule::ProductScope => Some("product-scope"),
        Rule::FixedPerRow => Some("fixed-per-row"),
        Rule::Vacancy => Some("vacancy"),
        _ => None,
    };
    family.map(|name| vec![format!("page5/{name}")]).unwrap_or_default()
}

/// A membership PAGE whose alternative product pins the membership's varying
/// target stays on the ordinary incomplete scan. The independent model must
/// classify every factor before applying the same pinned-target exclusion.
// @ref LLP 3000.036.001#18 — a filter product cannot replace varying membership discovery.
pub fn page_membership_filter_fallback(seed: u64) -> Case {
    let mut case = base(seed);
    case.program.tables[0].rule = Rule::OwnerOrWitness;
    case.program.tables[0].effects = None;
    case.program.tables[0].residency = Residency::Online;
    let access = case.program.tables.iter_mut().find(|table| table.name == "access").unwrap();
    access.rule = Rule::Allow; access.effects = None; access.residency = Residency::Public;
    access.expire = None; access.not_before = None;
    case.program.body = Body::Read { kind: Read::Page, take: 1, descending: seed % 2 == 0,
        filter: false, owner: false, project: None };
    case.program.domain = Some("(.bucket = bucket or .bucket = 1)".into());
    case.program.residual = Some("(.score > 0 or .flag = false)".into());
    case.program.order = Some(vec!["label".into(), "score".into()]);
    case.program.named_page_order = None; case.program.prelude.clear(); case.program.lets.clear();
    case.steps.clear(); case.rows.clear();
    case
}

/// Two independent equality-alternative factors are a bounded Cartesian
/// membership plan when no alternative pins the membership's varying field.
/// This mirrors the native planner in the independent Lean classifier.
// @ref LLP 3000.036.001#18 — bounded positive query products retain every factor in each lane.
pub fn page_membership_filter_product(seed: u64) -> Case {
    let mut case = base(seed);
    let mut rng = Rng::new(seed ^ 0x5041_4745_355f_5052);
    case.program.tables[0].rule = Rule::Witness;
    case.program.tables[0].effects = None;
    case.program.tables[0].residency = Residency::Online;
    case.program.tables[0].columns.push(column("region", Type::Text));
    case.program.tables[0].columns.push(column("status", Type::Text));
    let access = case.program.tables.iter_mut().find(|table| table.name == "access").unwrap();
    access.rule = Rule::Allow; access.effects = None; access.residency = Residency::Public;
    access.expire = None; access.not_before = None;
    case.program.body = Body::Read { kind: Read::Page, take: 1 + rng.pick(3) as u32,
        descending: rng.pick(2) == 0, filter: false, owner: false, project: None };
    case.program.domain = Some("(.region = 'north' or .region = 'south')".into());
    case.program.residual = Some("(.status = 'open' or .status = 'held')".into());
    case.program.order = Some(vec!["label".into(), "score".into()]);
    case.program.named_page_order = None; case.program.prelude.clear(); case.program.lets.clear();
    case.steps.clear();
    for (table, row) in &mut case.rows {
        if table == "items" {
            row["region"] = json!(if rng.pick(3) == 0 { "other" } else if rng.pick(2) == 0 { "north" } else { "south" });
            row["status"] = json!(if rng.pick(3) == 0 { "closed" } else if rng.pick(2) == 0 { "open" } else { "held" });
        }
    }
    case
}
