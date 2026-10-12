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
        rule,
        residency,
        effects: None,
        expire: None,
    };
    let access = Table {
        name: "access".into(),
        columns: vec![
            column("bucket", Type::Int),
            column("principal", Type::Principal),
        ],
        keys: vec![(
            "byMember".into(),
            vec!["bucket".into(), "principal".into()],
            true,
        )],
        rule: Rule::Allow,
        residency: Residency::Public,
        effects: None,
        expire: None,
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
            residual: None,
            domain: None,
            guard: None,
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
