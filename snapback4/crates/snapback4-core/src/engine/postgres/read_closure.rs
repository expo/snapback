//! Bounded physical fact closure. SQL fetches exact addresses; ordinary Rust
//! still evaluates every rule, expression, refusal, cursor and logical charge.
// @ref LLP 3000.009.001.000.001#13-g4a-read-refinement-2026-10-23 — one snapshot, no SQL semantic executor.
use super::{
    read_plan::{Access, Answers},
    store::{Tx, decode},
};
use crate::{
    Context, Program, RuntimeError, Schema, Value,
    ir::*,
    rows::Dir,
    schema::{ColumnType, RuleExpr, RuleTerm},
};
use postgres::types::ToSql;
use std::collections::BTreeMap;

#[derive(Clone, PartialEq, Eq)]
enum Key {
    Fixed(Value),
    Field(usize, String),
}
#[derive(Clone)]
enum Binding {
    Key(Key),
    Row(usize),
    Other,
}
#[derive(Clone, PartialEq, Eq)]
struct Node {
    table: String,
    index: String,
    key: Vec<Key>,
    n: u32,
    point: bool,
    dir: Dir,
    parent: Option<usize>,
    count: u64,
}
pub(crate) struct Closure {
    nodes: Vec<Node>,
}
// Schema is compilation input, not a request-owned copy or retained row fact.
struct Builder<'a> {
    nodes: Vec<Node>,
    schema: &'a Schema,
    viewer: &'a str,
}
#[cfg(test)]
thread_local! { pub(super) static AFTER_FAILED_STATEMENT: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) }; }
#[cfg(test)]
pub(super) fn after_failed_statement() {
    let hook = AFTER_FAILED_STATEMENT.with(|hook| hook.borrow_mut().take());
    if let Some(hook) = hook { hook(); }
}
impl Closure {
    pub fn new(schema: &Schema, program: &Program, context: &Context) -> Option<Self> {
        if program.native
            || program.kind != ProgramKind::Query
            || !matches!(
                context.request_credential_kind.as_deref()?,
                "guest" | "user" | "member" | "account" | "oidc" | "service"
            )
            || schema
                .tables
                .values()
                .any(|t| t.expire.is_some() || t.not_before.is_some())
        {
            return None;
        }
        let mut plan = Builder { nodes: Vec::new(), schema, viewer: &context.viewer };
        let mut env = context
            .args
            .iter()
            .map(|(n, v)| (n.clone(), Binding::Key(Key::Fixed(v.clone()))))
            .collect();
        plan.block(&program.body, &mut env, context)?;
        if plan.nodes.is_empty() {
            return None;
        }
        let bytes = plan.nodes.iter().try_fold(0u64, |sum, n| {
            Some(
                sum.checked_add(
                    crate::rows::disclosed::decode_reservation(&schema.tables[&n.table])
                        .saturating_add(1024)
                        .checked_mul(n.count)?,
                )?,
            )
        })?;
        if bytes > super::prefetch::PREFETCH_ROW_BYTES as u64 {
            return None;
        }
        Some(Self { nodes: plan.nodes })
    }
}
impl Builder<'_> {
    fn block(
        &mut self,
        body: &[Stmt],
        env: &mut BTreeMap<String, Binding>,
        c: &Context,
    ) -> Option<()> {
        for stmt in body {
            match stmt {
                Stmt::Let { name, value } | Stmt::Const { name, value } => {
                    if c.args.contains_key(name) || env.contains_key(name) {
                        return None;
                    }
                    let value = self.expr(value, env, c)?;
                    env.insert(name.clone(), value);
                }
                Stmt::Assign { name, value } => {
                    if !matches!(env.get(name), Some(Binding::Other)) {
                        return None;
                    }
                    self.expr(value, env, c)?;
                    env.insert(name.clone(), Binding::Other);
                }
                Stmt::Require { condition, .. }
                | Stmt::Return(condition)
                | Stmt::Push {
                    value: condition, ..
                } => {
                    self.expr(condition, env, c)?;
                }
                Stmt::If {
                    condition,
                    then_body,
                    else_body,
                } => {
                    self.expr(condition, env, c)?;
                    self.block(then_body, &mut env.clone(), c)?;
                    self.block(else_body, &mut env.clone(), c)?;
                    // Branch assignments must never remain assumed addresses.
                    for stmt in then_body.iter().chain(else_body) {
                        if let Stmt::Assign { name, .. }
                        | Stmt::Let { name, .. }
                        | Stmt::Const { name, .. } = stmt
                        {
                            env.insert(name.clone(), Binding::Other);
                        }
                    }
                }
                Stmt::For {
                    binding,
                    domain: LoopDomain::Page(scan),
                    body,
                } => {
                    let node = self.scan(scan, env, c)?;
                    let mut inner = env.clone();
                    inner.insert(binding.clone(), Binding::Row(node));
                    self.block(body, &mut inner, c)?;
                    // An outer mutable binding is not a fixed address after a loop.
                    for value in env.values_mut() {
                        if !matches!(value, Binding::Key(Key::Fixed(_))) {
                            *value = Binding::Other;
                        }
                    }
                }
                _ => return None,
            }
        }
        Some(())
    }
    fn expr(&mut self, e: &Expr, env: &BTreeMap<String, Binding>, c: &Context) -> Option<Binding> {
        let other = Binding::Other;
        Some(match e {
            Expr::Literal(v) => Binding::Key(Key::Fixed(v.clone())),
            Expr::Variable(n) => env.get(n).cloned().unwrap_or(other),
            Expr::Input(Input::Viewer) => Binding::Key(Key::Fixed(Value::Id(c.viewer.clone()))),
            Expr::Input(_) => return None,
            Expr::Field { base, name } => match self.expr(base, env, c)? {
                Binding::Row(n)
                    if matches!(
                        self.schema.table(&self.nodes[n].table)?.columns.get(name),
                        Some(ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. })
                    ) =>
                {
                    Binding::Key(Key::Field(n, name.clone()))
                }
                _ => other,
            },
            Expr::Array(items) => {
                for item in items {
                    self.expr(item, env, c)?;
                }
                other
            }
            Expr::Object(fields) => {
                for item in fields.values() {
                    self.expr(item, env, c)?;
                }
                other
            }
            Expr::Shape { base, fields } => {
                self.expr(base, env, c)?;
                for item in fields.values() {
                    self.expr(item, env, c)?;
                }
                other
            }
            Expr::Binary { left, right, .. } => {
                self.expr(left, env, c)?;
                self.expr(right, env, c)?;
                other
            }
            Expr::Unary { value, .. } => {
                self.expr(value, env, c)?;
                other
            }
            Expr::Builtin { builtin, args }
                if matches!(
                    builtin,
                    Builtin::RequireUncapped
                        | Builtin::Max
                        | Builtin::Min
                        | Builtin::Len
                        | Builtin::OptionalField { .. }
                ) =>
            {
                for item in args {
                    self.expr(item, env, c)?;
                }
                other
            }
            Expr::Get(read) | Expr::Exists(read) => {
                let keys = read
                    .key
                    .iter()
                    .map(|e| match self.expr(e, env, c)? {
                        Binding::Key(k) => Some(k),
                        _ => None,
                    })
                    .collect::<Option<Vec<_>>>()?;
                let n = self.add(&read.table, &read.index, keys, 1, Dir::Asc, true)?;
                if matches!(e, Expr::Get(_)) {
                    Binding::Row(n)
                } else {
                    other
                }
            }
            Expr::Scan(scan) => Binding::Row(self.scan(scan, env, c)?),
            _ => return None,
        })
    }
    fn scan(&mut self, s: &Scan, env: &BTreeMap<String, Binding>, c: &Context) -> Option<usize> {
        if s.after.is_some()
            || s.before.is_some()
            || s.range.is_some()
            || s.merge_site.is_some()
            || s.opaque_cursor
            || !super::super::rules::scan_visibility(&self.schema, s).uniform
        {
            return None;
        }
        let Bound::Literal(n) = s.take else {
            return None;
        };
        if n > 128 {
            return None;
        }
        // A single excluded total-unique key can hide at most one candidate.
        // Fetch that extra raw fact; Rust still evaluates the filter.
        let extra = if let Some(filter) = &s.filter {
            let Expr::Binary {
                op: BinaryOp::Ne,
                left,
                right,
            } = filter.as_ref()
            else {
                return None;
            };
            let (Expr::Field { base, name }, Expr::Literal(Value::Id(_))) =
                (left.as_ref(), right.as_ref())
            else {
                return None;
            };
            if !matches!(base.as_ref(),Expr::Variable(v) if v=="$filter") {
                return None;
            }
            let table = self.schema.table(&s.table)?;
            let columns = table.index(&s.index)?.columns();
            let pinned: std::collections::BTreeSet<_> = columns
                .iter()
                .take(s.prefix.len())
                .map(String::as_str)
                .chain(std::iter::once(name.as_str()))
                .collect();
            if !table.indexes.values().any(|ix| {
                ix.unique
                    && ix.is_plain()
                    && ix.columns().iter().all(|c| {
                        pinned.contains(c.as_str())
                            && !matches!(table.columns.get(c), Some(ColumnType::Optional(_)))
                    })
            }) {
                return None;
            }
            1
        } else {
            0
        };
        let keys = s
            .prefix
            .iter()
            .map(|e| match self.expr(e.scalar()?, env, c)? {
                Binding::Key(k) => Some(k),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()?;
        self.add(
            &s.table,
            &s.index,
            keys,
            n + 1 + extra,
            if s.order == Order::Asc {
                Dir::Asc
            } else {
                Dir::Desc
            },
            false,
        )
    }
    fn add(
        &mut self,
        table: &str,
        index: &str,
        mut key: Vec<Key>,
        n: u32,
        dir: Dir,
        point: bool,
    ) -> Option<usize> {
        // A field pinned by its source range is already a fixed address.
        // This also deduplicates W2's per-message membership against its guard.
        for k in &mut key {
            if let Key::Field(p, f) = k {
                let source = &self.nodes[*p];
                if let Some(pos) = self
                    .schema
                    .table(&source.table)?
                    .index(&source.index)?
                    .columns()
                    .iter()
                    .position(|c| c == f)
                    && let Some(pinned) = source.key.get(pos)
                {
                    *k = pinned.clone();
                }
            }
        }
        // byId accepts the same textual identity as the ordinary get port.
        if index == "byId" {
            for k in &mut key {
                if let Key::Fixed(Value::String(v)) = k {
                    *k = Key::Fixed(Value::Id(v.clone()));
                }
            }
        }
        // Speculative parameters stay within the portable key envelope.
        // Wider or non-scalar keys retain ordinary Rust execution; this is
        // physical admission and never chooses a public refusal.
        key.iter().try_fold(0usize, |sum, k| {
            let Key::Fixed(v) = k else { return Some(sum) };
            let limit = crate::rows::MAX_INDEX_KEY_BYTES;
            match v {
                Value::String(s) | Value::Id(s) if s.len() <= limit && !s.contains('\0') => {}
                Value::Bytes(b) if b.len() <= limit => {}
                Value::Null | Value::Bool(_) | Value::Int(_) => {}
                _ => return None,
            }
            sum.checked_add(crate::key::encode(std::slice::from_ref(v)).len())
                .filter(|n| *n <= limit)
        })?;
        let t = self.schema.table(table)?;
        if self.schema.maintain_for(table).is_some()
            || t.ephemeral.is_some()
            || t.sync.is_some()
            || t.through.is_some()
            || !t.column_reads.is_empty()
            || !t.recorded.is_empty()
            || !t.sequences.is_empty()
            || t.written_by.values().any(|a| !a.audience)
            || t.rules.read.has_reference()
        {
            return None;
        }
        let ix = t.index(index)?;
        if !ix.is_plain() || key.len() > ix.components.len() {
            return None;
        }
        let mut parent = None;
        for k in &key {
            if let Key::Field(p, f) = k {
                // @ref LLP 3000.009.001.000.001#13-g4a-read-refinement-2026-10-23 — Rust materializes sparse defaults and optionals before forming addresses.
                let source = self.schema.table(&self.nodes[*p].table)?;
                if source.defaults.contains_key(f) || source.columns.get(f)?.is_optional() {
                    return None;
                }
                // PostgreSQL's JSON path reader unescapes the entire source
                // image. A legal JSON/asset payload (or enum) can contain NUL;
                // such an address source must keep Rust's portable decoder.
                if self
                    .schema
                    .table(&self.nodes[*p].table)?
                    .columns
                    .values()
                    .any(rust_json_source)
                {
                    return None;
                }
                if parent.is_some_and(|old| old != *p) {
                    return None;
                }
                parent = Some(*p);
                if !matches!(
                    self.schema.table(&self.nodes[*p].table)?.columns.get(f)?,
                    ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. }
                ) {
                    return None;
                }
            }
        }
        let count = u64::from(n).checked_mul(parent.map_or(1, |p| self.nodes[p].count))?;
        let node = Node {
            table: table.into(),
            index: index.into(),
            key,
            n,
            point,
            dir,
            parent,
            count,
        };
        if let Some(n) = self.nodes.iter().position(|old| old == &node) {
            return Some(n);
        }
        if self.nodes.len() >= 16 {
            return None;
        }
        let rule = t.rules.read.clone();
        let id = self.nodes.len();
        self.nodes.push(node);
        self.probes(&rule, id, 0)?;
        Some(id)
    }
    fn probes(&mut self, rule: &RuleExpr, source: usize, depth: usize) -> Option<()> {
        match rule {
            RuleExpr::And(rs) | RuleExpr::Or(rs) => {
                for r in rs {
                    self.probes(r, source, depth)?;
                }
            }
            RuleExpr::Not(r) => self.probes(r, source, depth)?,
            RuleExpr::Exists {
                table, index, key, ..
            } => {
                if depth > 0 || super::read_plan::has_probe(&self.schema.table(table)?.rules.read) {
                    return None;
                }
                let keys = key
                    .iter()
                    .map(|k| match k {
                        RuleTerm::Field(f) => Some(Key::Field(source, f.clone())),
                        RuleTerm::Viewer => Some(Key::Fixed(Value::Id(self.viewer.to_owned()))),
                        RuleTerm::Literal(v) => Some(Key::Fixed(v.clone())),
                        _ => None,
                    })
                    .collect::<Option<Vec<_>>>()?;
                self.add(table, index, keys, 1, Dir::Asc, true)?;
            }
            RuleExpr::Created { .. } => return None,
            _ => {}
        }
        Some(())
    }
}
impl Closure {
    pub fn execute(
        self,
        tx: &Tx<'_>,
        digest: &str,
    ) -> Result<crate::identity::facts::SessionFacts, RuntimeError> {
        let mut sql = Sql {
            params: vec![Param::Text(digest.into())],
        };
        let mut ctes = vec![format!(
            "authority AS MATERIALIZED ({})",
            super::authority::session_facts_sql(tx.read_sessions.get())
        )];
        for (id, node) in self.nodes.iter().enumerate() {
            ctes.push(sql.node(id, node)?);
        }
        let unions = self
            .nodes
            .iter()
            .enumerate()
            .map(|(i, _)| format!("SELECT {i} AS node, keys, data, k, lo, hi, unavailable FROM a{i}"))
            .collect::<Vec<_>>()
            .join(" UNION ALL ");
        ctes.push(format!("facts AS MATERIALIZED ({unions})"));
        // A failed speculative payload guard transfers no row images. Reopen
        // the ordinary snapshot before resolving authority or executing Rust.
        ctes.push(format!("payload AS MATERIALIZED (SELECT NOT COALESCE(pg_catalog.bool_or(unavailable),false) AND COALESCE(SUM(COALESCE(pg_catalog.octet_length(data),0)+pg_catalog.octet_length(keys)+COALESCE(pg_catalog.octet_length(k),0)*6+512),0) <= {} AS ready, pg_catalog.array_agg(node) AS nodes, pg_catalog.array_agg(keys) AS keys, pg_catalog.array_agg(data) AS images, pg_catalog.array_agg(k) AS row_keys FROM facts)", super::prefetch::PREFETCH_ROW_BYTES / 32));
        // Native arrays avoid escaping every row into a second JSON document
        // and hex-encoding its key. All four arrays share the same guarded cut.
        let statement = format!(
            "WITH {} SELECT authority.*, CASE WHEN ready THEN nodes END, CASE WHEN ready THEN keys END, CASE WHEN ready THEN images END, CASE WHEN ready THEN row_keys END FROM authority CROSS JOIN payload",
            ctes.join(",")
        );
        // Request keys are parameters; schema addresses are encoded code constants.
        // Bound the finite statement shapes as well:
        // alias/dedup choices must not grow a connection cache without limit.
        const PREPARED_CLOSURES: usize = 32;
        if !tx.cache.borrow().contains_key(statement.as_str())
            && tx
                .cache
                .borrow()
                .keys()
                .filter(|s| s.starts_with("WITH authority AS MATERIALIZED ("))
                .count()
                >= PREPARED_CLOSURES
        {
            return tx.complete_request_facts(digest);
        }
        let params: Vec<_> = sql.params.iter().map(Param::as_sql).collect();
        let pipeline = {
            let inner = tx.inner.borrow();
            inner.client.is_reader() && !inner.started
        };
        let rows = if pipeline {
            let typed: Vec<_> = sql.params.iter().map(|p| (p.as_sql(), p.ty())).collect();
            // Reuse RT5's typed admission, including text NUL and the physical
            // encoder bound, even though this flight uses binary Bind inputs.
            let encoded = typed.iter().try_fold(0usize, |n,(p,t)| {
                Ok::<_,RuntimeError>(n.saturating_add(super::literal::parameter(*p,t)?.len()))
            })?;
            if statement.len().saturating_add(encoded) > super::flight::ENCODED_LIMIT { return tx.complete_request_facts(digest); }
            tx.calls.set(tx.calls.get()+1);
            let result = tx.inner.borrow().client.independent_cached(&statement,&typed, || tx.calls.set(tx.calls.get()+1));
            tx.inner.borrow_mut().pending.clear();
            tx.finish_read_flight();
            match result {
                Ok(rows) => rows,
                // A connection loss is retryable for this request. Never hide
                // it with a fresh connection or replay an in-flight statement.
                Err(RuntimeError::Postgres(e)) if e.as_db_error().is_none() => return Err(e.into()),
                Err(_) => return tx.restart_request_facts(digest),
            }
        } else {
            let mut results = match tx.flight(&[(&statement, &params)], "ROLLBACK") {
                Ok(results) => results,
                Err(_) => return tx.restart_request_facts(digest),
            };
            tx.finish_read_flight();
            let Some(result) = results.pop() else { return tx.complete_request_facts(digest); };
            result.rows
        };
        let payload = match rows.first().map(|row| array_payload(row)) {
            Some(Ok(payload)) => payload,
            _ => return tx.complete_request_facts(digest),
        };
        let facts = super::authority::session_facts_rows(rows);
        if tx.needs_complete_facts(&facts) {
            return tx.complete_request_facts(digest);
        }
        let decoded = decode_answers(&self.nodes, payload);
        // Speculation cannot choose a program error or outrank authority.
        // Decode/address failures discard this cut and use ordinary access.
        #[allow(unused_mut)]
        let mut answers = match decoded {
            Ok(answers) => answers,
            Err(_) => return tx.complete_request_facts(digest),
        };
        #[allow(unused_mut)]
        let mut facts = facts;
        #[cfg(test)]
        plant_fault(&mut answers, &mut facts);
        *tx.read_cache.borrow_mut() = Answers::new(answers);
        Ok(facts)
    }
}
type Fact = (usize, String, Option<String>, Option<Vec<u8>>);
fn array_payload(row: &super::store::Row) -> Result<Vec<Fact>, RuntimeError> {
    let ids: Vec<i32> = row.try_get(19)?;
    let keys: Vec<String> = row.try_get(20)?;
    let images: Vec<Option<String>> = row.try_get(21)?;
    let row_keys: Vec<Option<Vec<u8>>> = row.try_get(22)?;
    if ids.len() != keys.len() || ids.len() != images.len() || ids.len() != row_keys.len() {
        return Err(RuntimeError::Store("incomplete composed arrays".into()));
    }
    ids.into_iter().zip(keys).zip(images).zip(row_keys).map(|(((id,key),data),k)| {
        Ok((usize::try_from(id).map_err(|_| RuntimeError::Store("negative composed node".into()))?,key,data,k))
    }).collect()
}
fn decode_answers(nodes: &[Node], payload: Vec<Fact>) -> Result<Vec<(Access, Vec<(Value, Vec<u8>)>)>, RuntimeError> {
    let mut answers: Vec<(Access, Vec<(Value, Vec<u8>)>)> = Vec::new();
    for (id, keys, data, k) in payload {
        let node = nodes.get(id).ok_or_else(|| RuntimeError::Store("unknown composed node".into()))?;
        let raw: Vec<Option<Value>> = serde_json::from_str(&keys).map_err(|e| RuntimeError::Store(e.to_string()))?;
        if raw.len() != node.key.len() { return Err(RuntimeError::Store("incomplete composed address".into())); }
        if raw.iter().any(Option::is_none) { continue; }
        let keys: Vec<Value> = raw.into_iter().flatten().collect();
        let range = Access::range(&node.table, &node.index, &keys, node.dir, i64::from(node.n))
            .ok_or_else(|| RuntimeError::Store("empty composed address".into()))?;
        let mut accesses = vec![range];
        if node.point && node.index == "byId" {
            // A unique point proves its exact index prefix too. Retain two
            // explicit facts: get uses the point, metered lookup uses the
            // ordered prefix (including its index key), never a wider range.
            accesses.push(Access::point(&node.table, &node.index, &keys)
                .ok_or_else(|| RuntimeError::Store("empty composed point".into()))?);
        }
        let image: Option<(Value, Vec<u8>)> = match (data, k) {
            (Some(data), Some(k)) => Some((decode(&data)?, k)),
            (None, None) => None,
            _ => return Err(RuntimeError::Store("incomplete composed image".into())),
        };
        for access in accesses {
            let pos = answers.iter().position(|(a, _)| a == &access).unwrap_or(answers.len());
            if pos == answers.len() { answers.push((access, vec![])); }
            if let Some((row, key)) = &image {
                let (_, out) = answers.get_mut(pos).ok_or_else(|| RuntimeError::Store("missing composed answer".into()))?;
                if !out.iter().any(|(_, old)| old == key) { out.push((row.clone(), key.clone())); }
            }
        }
    }
    for (a, rows) in &mut answers {
        rows.sort_by(|(_, a), (_, b)| a.cmp(b));
        if a.dir == Dir::Desc { rows.reverse(); }
    }
    Ok(answers)
}
#[cfg(test)]
fn hex(s: &str) -> Result<Vec<u8>, RuntimeError> {
    if s.len() % 2 != 0 { return Err(RuntimeError::Store("composed key hex".into())); }
    s.as_bytes()
        .chunks_exact(2)
        .map(|v| {
            std::str::from_utf8(v)
                .ok()
                .and_then(|s| u8::from_str_radix(s, 16).ok())
                .ok_or_else(|| RuntimeError::Store("composed key hex".into()))
        })
        .collect()
}
enum Param {
    Text(String),
    Bytes(Vec<u8>),
}
impl Param {
    fn ty(&self) -> postgres::types::Type { match self { Self::Text(_) => postgres::types::Type::TEXT, Self::Bytes(_) => postgres::types::Type::BYTEA } }
    fn as_sql(&self) -> &(dyn ToSql + Sync) {
        match self {
            Self::Text(v) => v,
            Self::Bytes(v) => v,
        }
    }
}
struct Sql {
    params: Vec<Param>,
}
impl Sql {
    fn param(&mut self, p: Param) -> String {
        self.params.push(p);
        format!("${}", self.params.len())
    }
    // @ref LLP 3000.009.001.000.002#22-read-ceilings — schema addresses are code; request keys remain typed parameters for fresh facts.
    fn constant(value: &str) -> Result<String, RuntimeError> {
        super::literal::encode(&super::literal::Datum::Text(value.into()), &postgres::types::Type::TEXT)
    }
    fn node(&mut self, id: usize, n: &Node) -> Result<String, RuntimeError> {
        let table = Self::constant(&n.table)?;
        let index = Self::constant(&n.index)?;
        // Do not ask PostgreSQL's JSON reader to unescape an image containing
        // NUL. The spelling check is conservative (escaped backslashes may
        // also decline); all raw images remain untouched for Rust's decoder.
        let unavailable = if n.parent.is_some() {
            let nul = Self::constant("\\u0000")?;
            format!("COALESCE(pg_catalog.strpos(s.data,{nul}) OPERATOR(pg_catalog.>) 0,false)")
        } else { "false".into() };
        let image = if n.parent.is_some() {
            format!(" CROSS JOIN LATERAL (SELECT {unavailable} AS unavailable, CASE WHEN {unavailable} THEN NULL::pg_catalog.jsonb ELSE COALESCE(s.data::pg_catalog.jsonb->'Row',s.data::pg_catalog.jsonb->'Map') END AS data OFFSET 0) image")
        } else { String::new() };
        let unavailable = if n.parent.is_some() { "image.unavailable" } else { "false" };
        let mut json = Vec::new();
        let mut parts = Vec::new();
        for k in &n.key {
            match k {
                Key::Fixed(v) => {
                    json.push(format!(
                        "{}::pg_catalog.text::pg_catalog.json",
                        self.param(Param::Text(crate::value::canonical_json(v)))
                    ));
                    parts.push(format!(
                        "{}::pg_catalog.bytea",
                        self.param(Param::Bytes(crate::key::encode(std::slice::from_ref(v))))
                    ));
                }
                Key::Field(_, name) => {
                    let field = Self::constant(name)?;
                    let value = format!("image.data->{field}::pg_catalog.text");
                    json.push(value.clone());
                    // Identity admission forbids NUL. UTF-8 therefore has no zero
                    // bytes; the ordinary Id tag/terminator encoding is exact.
                    parts.push(format!("'\\x06'::pg_catalog.bytea || pg_catalog.convert_to(({value})->>'Id','UTF8') || '\\x0000'::pg_catalog.bytea"));
                }
            }
        }
        let lo = if parts.is_empty() {
            "'\\x'::pg_catalog.bytea".into()
        } else {
            format!("({})", parts.join(" || "))
        };
        // @ref LLP 3000.009.001.000#91-adapter-parity-rules — intrinsic byId's portable full key is [id,id]; a point fetch can use the row primary address.
        // Intrinsic byId is exactly [id,id] in the portable index layout.
        // Fetch its row at the primary address, retaining the same full index
        // key for Rust's ordered-prefix facts and logical scan charges. A byId
        // range or non-identity key retains the ordinary index fetch below.
        let point_id = if n.point && n.index == "byId" && n.key.len() == 1 {
            match &n.key[0] {
                Key::Fixed(Value::Id(id)) => Some(self.param(Param::Text(id.clone()))),
                Key::Field(_, field) => Some(format!("(image.data->{}::pg_catalog.text)->>'Id'",Self::constant(field)?)),
                _ => None,
            }
        } else { None };
        let target = point_id.as_ref().map_or(String::new(), |id|format!(", {id}::pg_catalog.text AS target"));
        let fetch = if point_id.is_some() {
            format!("SELECT r.data,q.lo || q.lo AS k FROM r WHERE r.t={table} AND r.id=q.target LIMIT 1")
        } else {
            let dir = if n.dir == Dir::Asc { "ASC" } else { "DESC" };
            format!("SELECT r.data,i.k FROM i JOIN r ON r.t=i.t AND r.id=i.id WHERE i.t={table} AND i.ix={index} AND i.k>=q.lo AND i.k<q.lo || '\\xff'::pg_catalog.bytea ORDER BY i.k {dir} LIMIT {}", n.n)
        };
        let source = n
            .parent
            .map_or_else(|| "(SELECT 1) s".into(), |p| format!("a{p} s"));
        Ok(format!(
            "a{id} AS MATERIALIZED (SELECT q.keys,q.lo,q.lo || '\\xff'::pg_catalog.bytea AS hi,q.unavailable,h.data,h.k FROM {source}{image} CROSS JOIN LATERAL (SELECT pg_catalog.json_build_array({})::pg_catalog.text AS keys, {unavailable} AS unavailable, {lo} AS lo{target} OFFSET 0) q LEFT JOIN LATERAL ({fetch}) h ON true)",
            json.join(",")
        ))
    }
}

#[cfg(test)]
#[derive(Clone, Copy)]
pub(super) enum Fault {
    Membership,
    Total,
    Order,
    Authority,
}
#[cfg(test)]
thread_local! {pub(super) static FAULT: std::cell::Cell<Option<Fault>>=const{std::cell::Cell::new(None)};}
#[cfg(test)]
fn plant_fault(
    answers: &mut [(Access, Vec<(Value, Vec<u8>)>)],
    facts: &mut crate::identity::facts::SessionFacts,
) {
    FAULT.with(|fault| match fault.get() {
        Some(Fault::Authority) => facts.sessions.clear(),
        Some(Fault::Membership) => {
            for (a, rows) in answers {
                if a.table == "memberships" {
                    rows.clear();
                }
            }
        }
        Some(Fault::Total) => {
            for (a, rows) in answers {
                if a.table == "rooms" {
                    for (v, _) in rows {
                        if let Value::Row(fields) | Value::Map(fields) = v {
                            fields.insert("total".into(), Value::Int(999));
                        }
                    }
                }
            }
        }
        Some(Fault::Order) => {
            for (a, rows) in answers {
                if a.table == "messages" {
                    rows.reverse();
                }
            }
        }
        None => {}
    });
}

fn rust_json_source(kind: &ColumnType) -> bool {
    match kind {
        ColumnType::Json { .. }
        | ColumnType::Image { .. }
        | ColumnType::Video { .. }
        | ColumnType::File { .. } => true,
        ColumnType::Enum { variants } => variants.iter().any(|v| v.contains('\0')),
        ColumnType::Optional(inner)
        | ColumnType::List { of: inner, .. }
        | ColumnType::ListRange { of: inner, .. } => rust_json_source(inner),
        _ => false,
    }
}

#[cfg(test)]
mod decode_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn g4a_fix1_malformed_payloads_return_errors_without_panics() {
        let node = Node { table: "books".into(), index: "byId".into(), key: vec![Key::Fixed(Value::Id("b".into()))], n: 1, point: true, dir: Dir::Asc, parent: None, count: 1 };
        let nodes = [node];
        for payload in [
            "null".to_owned(), "[".to_owned(),
            json!([[99,"[]",null,null]]).to_string(),
            json!([[0,"[]",null,null]]).to_string(),
            json!([[0,"not json",null,null]]).to_string(),
            json!([[0,"[42]",null,null]]).to_string(),
            json!([[0,"[{\"Id\":\"b\"}]","bad row","01"]]).to_string(),
            json!([[0,"[{\"Id\":\"b\"}]","\"Null\"","f"]]).to_string(),
            json!([[0,"[{\"Id\":\"b\"}]","\"Null\"",null]]).to_string(),
        ] {
            let parsed = (|| {
                let rows: Vec<(usize,String,Option<String>,Option<String>)> = serde_json::from_str(&payload).map_err(|e| RuntimeError::Store(e.to_string()))?;
                let rows = rows.into_iter().map(|(id,key,data,k)| Ok((id,key,data,k.map(|v|hex(&v)).transpose()?))).collect::<Result<_,RuntimeError>>()?;
                decode_answers(&nodes,rows)
            })();
            assert!(parsed.is_err(), "accepted {payload}");
        }
        for malformed in ["f", "雪", "zz", "0雪"] { assert!(hex(malformed).is_err()); }
    }
}
