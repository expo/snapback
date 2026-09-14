//! Binder-only expression ownership. No grouping enters the executed IR.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Owner { Condition, Payload }
#[derive(Clone, Debug)]
pub(crate) struct Owned { pub kind: Owner, pub by: String }
pub(crate) type Ownership = BTreeMap<String, Owned>;

// @ref LLP 3000.007#19.1 — ownership travels beside flat baseline statements, never through their lowering or serialization.
#[derive(Default)]
pub(super) struct Body {
    pub code: Vec<Stmt>,
    pub ownership: Ownership,
}

impl std::ops::Deref for Body {
    type Target = [Stmt];
    fn deref(&self) -> &[Stmt] { &self.code }
}

impl Body {
    pub fn push(&mut self, stmt: Stmt) { self.code.push(stmt); }

    pub fn nest(&mut self, prefix: &str, ownership: &Ownership) {
        self.ownership.extend(ownership.iter().map(|(path, owner)| (format!("{prefix}.{path}"), Owned { kind: owner.kind, by: format!("{prefix}.{}", owner.by) })));
    }

    pub fn extend(&mut self, other: Body) {
        let offset = self.len();
        self.ownership.extend(other.ownership.into_iter().map(|(path, owner)| {
            (shift(&path, offset), Owned { kind: owner.kind, by: shift(&owner.by, offset) })
        }));
        self.code.extend(other.code);
    }

    pub fn push_if(&mut self, condition: Expr, then_body: Body, else_body: Body) {
        self.nest(&format!("{}.then", self.len()), &then_body.ownership);
        self.nest(&format!("{}.else", self.len()), &else_body.ownership);
        self.push(Stmt::If { condition, then_body: then_body.code, else_body: else_body.code });
    }

    pub fn push_for(&mut self, binding: String, domain: LoopDomain, body: Body) {
        self.nest(&format!("{}.loop", self.len()), &body.ownership);
        self.push(Stmt::For { binding, domain, body: body.code });
    }

    pub fn own(&mut self, start: usize, owner: Owner) {
        // More deeply nested owners remain: an emit's setup resets effect
        // control even when that emit occurs in another condition's helper.
        let by = self.len().to_string();
        for index in start..self.len() {
            let entry = self.ownership.entry(index.to_string()).or_insert_with(|| Owned { kind: owner, by: by.clone() });
            if owner == Owner::Payload { *entry = Owned { kind: owner, by: by.clone() }; }
        }
    }
}

/// Translate only the side map through baseline helper-return lowering.
/// No branch here can change the code that helper_returns receives or emits.
/// Original statement ownership includes a new guard around that statement;
/// nested ownership follows it into :then. A return's two assignments share
/// its ownership, and a loop's generated break has no expression owner.
pub(super) fn helper_ownership(body: &Body) -> Ownership {
    if body.ownership.is_empty() { return Ownership::new(); }
    let mut paths = BTreeMap::new();
    helper_paths(&body.code, "", "", &mut paths);
    let mut result = Ownership::new();
    for (path, owner) in &body.ownership {
        for target in &paths[path].cover {
            result.insert(target.clone(), Owned { kind: owner.kind, by: paths[&owner.by].statement.clone() });
        }
    }
    result
}

fn shift(path: &str, offset: usize) -> String {
    let (head, tail) = path.split_once('.').map_or((path, String::new()), |(head, tail)| (head, format!(".{tail}")));
    format!("{}{tail}", head.parse::<usize>().unwrap() + offset)
}

struct Location { cover: Vec<String>, statement: String }

fn child(prefix: &str, index: usize) -> String {
    if prefix.is_empty() { index.to_string() } else { format!("{prefix}.{index}") }
}

fn helper_paths(body: &[Stmt], source: &str, target: &str, paths: &mut BTreeMap<String, Location>) -> bool {
    let mut may_return = false;
    let mut offset = 0;
    for (index, stmt) in body.iter().enumerate() {
        let from = child(source, index);
        let to = child(target, offset);
        let inner = if may_return { format!("{to}.then.0") } else { to.clone() };
        let returns = match stmt {
            Stmt::Return(_) => true,
            Stmt::If { then_body, else_body, .. } => {
                let a = helper_paths(then_body, &format!("{from}.then"), &format!("{inner}.then"), paths);
                let b = helper_paths(else_body, &format!("{from}.else"), &format!("{inner}.else"), paths);
                a || b
            }
            Stmt::For { body, .. } => helper_paths(body, &format!("{from}.loop"), &format!("{inner}.loop"), paths),
            // Write-condition setup does not contain helper-local returns;
            // baseline helper_returns leaves it alone.
            Stmt::WriteTarget { condition: Some(condition), .. } => {
                unchanged_paths(&condition.setup, &format!("{from}.condition"), &format!("{inner}.condition"), paths);
                false
            }
            _ => false,
        };
        let width = if !may_return && matches!(stmt, Stmt::Return(_)) { 2 } else { 1 };
        paths.insert(from, Location { cover: (0..width).map(|n| child(target, offset + n)).collect(), statement: inner });
        offset += width;
        may_return |= returns;
    }
    may_return
}

fn unchanged_paths(body: &[Stmt], source: &str, target: &str, paths: &mut BTreeMap<String, Location>) {
    for (index, stmt) in body.iter().enumerate() {
        let from = child(source, index);
        let to = child(target, index);
        paths.insert(from.clone(), Location { cover: vec![to.clone()], statement: to.clone() });
        match stmt {
            Stmt::If { then_body, else_body, .. } => {
                unchanged_paths(then_body, &format!("{from}.then"), &format!("{to}.then"), paths);
                unchanged_paths(else_body, &format!("{from}.else"), &format!("{to}.else"), paths);
            }
            Stmt::For { body, .. } => unchanged_paths(body, &format!("{from}.loop"), &format!("{to}.loop"), paths),
            Stmt::WriteTarget { condition: Some(condition), .. } => unchanged_paths(&condition.setup, &format!("{from}.condition"), &format!("{to}.condition"), paths),
            _ => {}
        }
    }
}

pub(crate) fn runtime_path(program: &str, path: &str) -> String {
    let mut result = program.to_owned();
    for part in path.split('.') {
        match part { "loop" => {}, "then" | "else" | "condition" => { result.push(':'); result.push_str(part); }, index => {
            let Ok(index) = index.parse::<usize>() else { return String::new(); };
            result.push_str(&format!(":{}", index + 1));
        } }
    }
    result
}
