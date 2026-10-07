//! Internal, server-only Following traversal over owned event metadata.
//!
//! This milestone has no serve route, generated binding, card projection or
//! capability certificate. Like Engine::query, its Context is a trusted host
//! input. It cannot be used as a bearer-authentication boundary.
// @ref LLP 3000.026#9-exact-on-demand-history-design-handoff — exact-first online traversal; inbox bytes stay unchanged.
mod budget;
mod frontier;
mod read;
mod refresh;
mod session;
pub use refresh::{Mounted, Refresh};
pub mod projection;

use super::{Context, Engine};
use crate::{
    RuntimeError, Value,
    meter::{Ceilings, Metered},
    schema::timeline::Timeline,
    store::Tx,
};
use budget::{Budget, ENVELOPE, SCRATCH};
use frontier::{BLOCK_HEADS, Frontier, Head, Lane};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    sync::Arc,
};

// Control records and keys; ordinary engine ID validation also applies.
const SESSION_BASE: u64 = 16 * 1024;
// At most TOTAL_BYTES / SESSION_BASE = 8192 lifecycle records. Preflight
// strings plus worst-case split paths in opening/expiry/count maps. Reclaim
// charges this per record rather than assuming allocation reuse across steps.
const LIFECYCLE_SCRATCH: u64 = 64 * 1024;
const IDLE_MS: i64 = 300_000;
const SESSION_BYTES: u64 = 32 * 1024 * 1024;
const TOTAL_BYTES: u64 = 128 * 1024 * 1024;
const SESSIONS_PER_VIEW: usize = 4;

#[derive(Clone, Debug)]
pub struct Request {
    pub declaration: String,
    pub page_size: usize,
    /// Controller-minted opening id. Retry opening with the same id.
    pub opening: String,
    /// None addresses the opening unit; Some addresses an issued successor.
    pub token: Option<String>,
}

/// Public metadata only. Neither an admission token nor an edge epoch escapes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Event {
    pub id: String,
    pub actor: String,
    pub author: String,
    pub post: String,
    pub repost: bool,
    pub at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Item {
    Event(Event),
    Shaped {
        id: String,
        value: serde_json::Value,
        authority: Vec<projection::Witness>,
    },
    Omitted {
        id: String,
        code: &'static str,
    },
}
impl Item {
    fn retained_bytes(&self) -> u64 {
        match self {
            Self::Event(e) => {
                256 + (e.id.len() + e.actor.len() + e.author.len() + e.post.len()) as u64
            }
            Self::Omitted { id, .. } => 256 + id.len() as u64,
            Self::Shaped {
                id,
                value,
                authority,
            } => {
                512 + id.len() as u64
                    + projection::json_heap(value)
                    + authority
                        .iter()
                        .map(projection::Witness::bytes)
                        .sum::<u64>()
            }
        }
    }
    pub fn id(&self) -> &str {
        match self {
            Self::Event(e) => &e.id,
            Self::Omitted { id, .. } | Self::Shaped { id, .. } => id,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub enum Response {
    Preparing {
        next: String,
    },
    Stalled {
        next: String,
    },
    Page {
        items: Vec<Item>,
        next: Option<String>,
    },
    Restart,
    Refused {
        code: &'static str,
    },
}
impl Response {
    pub fn next(&self) -> Option<&str> {
        match self {
            Self::Preparing { next } | Self::Stalled { next } => Some(next),
            Self::Page { next, .. } => next.as_deref(),
            _ => None,
        }
    }
}

/// Pinned bytes are the replay object, not a freshly reshaped answer.
pub struct Pinned {
    pub response: Response,
    bytes: String,
}
impl Pinned {
    pub fn bytes(&self) -> &str {
        &self.bytes
    }
}

/// Operator instrumentation is deliberately separate from the serializable DTO.
pub struct Outcome {
    pub answer: Arc<Pinned>,
    pub metered: Metered,
    pub frontier_writes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Position {
    at: i64,
    id: String,
}
impl Position {
    fn suffix(&self) -> Vec<Value> {
        vec![
            Value::Int(self.at),
            Value::Id(self.id.clone()),
            Value::Id(self.id.clone()),
        ]
    }
}
impl Event {
    fn position(&self) -> Position {
        Position {
            at: self.at,
            id: self.id.clone(),
        }
    }
    fn string_bytes(&self) -> usize {
        self.id.len() + self.actor.len() + self.author.len() + self.post.len()
    }
    fn row(row: Value) -> Result<Self, RuntimeError> {
        let text = |name| row.field(name)?.as_str().map(str::to_owned);
        Ok(Self {
            id: text("id")?,
            actor: text("actorId")?,
            author: text("authorId")?,
            post: text("postId")?,
            repost: row.field("repost")? == &Value::Bool(true),
            at: row.field("at")?.as_int()?,
        })
    }
}

#[derive(Clone)]
struct Staged {
    cards: Vec<projection::Witness>,
    head: Head,
    item: Item,
    bytes: u64,
    item_bytes: u64,
}
struct Unit {
    token: String,
    answer: Arc<Pinned>,
    witnesses: Vec<Head>,
    cards: Vec<Vec<projection::Witness>>,
    bytes: u64,
}

#[derive(Clone)]
struct Session {
    viewer: String,
    declaration: String,
    page_size: usize,
    arguments: BTreeMap<String, Value>,
    projection: Option<String>,
    store: String,
    generation: u64,
    bound: String,
    head: u64,
    touched: i64,
    pending_token: String,
    abandoned: bool,
    frontier: Frontier,
    retained: bool,
    dirty: BTreeSet<u64>,
    pending: Option<Lane>,
    edge_after: Option<Vec<Value>>,
    discovered: bool,
    lanes: u64,
    after: Option<Position>,
    staged: Vec<Staged>,
    staged_bytes: u64,
    item_bytes: u64,
    units: VecDeque<Arc<Unit>>,
}
impl Session {
    fn bytes(&self) -> u64 {
        SESSION_BASE
            + self
                .arguments
                .values()
                .map(super::runner::expression_copy)
                .sum::<u64>()
            + self.frontier.bytes
            + self.staged_bytes
            + self.units.iter().map(|u| u.bytes).sum::<u64>()
    }
    fn checkpoint(&self) -> u64 {
        self.dirty.len() as u64 + 5
    }
    fn reset_scan(&mut self) {
        self.frontier = Frontier::default();
        self.edge_after = None;
        self.discovered = false;
        self.lanes = 1;
        self.pending = Some(Lane {
            actor: self.viewer.clone(),
            epoch: None,
            after: self.after.clone(),
            block: 0,
        });
    }
}

/// Metered, viewer-bound opening registration. It owns a quota slot before
/// traversal, and an unknown or reclaimed opening can never be admitted again.
pub struct Opening {
    pub request: Request,
    pub metered: Metered,
}
struct Registration {
    identity: Option<(String, u64)>,
    projection: Option<String>,
    arguments: Option<String>,
    declaration: String,
    page_size: usize,
    touched: i64,
    abandoned: bool,
}

/// Volatile custody intentionally restarts on process loss. No table, catalog,
/// schema capability or application-store byte is introduced by this reader.
pub struct Reader {
    incarnation: String,
    sessions: BTreeMap<(String, String), Session>,
    openings: BTreeMap<(String, String), Registration>,
    counts: BTreeMap<(String, String), usize>,
    expiry: BTreeSet<(i64, (String, String))>,
    bytes: u64,
    per_session: u64,
    total: u64,
}
impl Reader {
    pub fn new() -> Result<Self, RuntimeError> {
        Ok(Self {
            incarnation: token()?[..32].into(),
            sessions: BTreeMap::new(),
            openings: BTreeMap::new(),
            counts: BTreeMap::new(),
            expiry: BTreeSet::new(),
            bytes: 0,
            per_session: SESSION_BYTES,
            total: TOTAL_BYTES,
        })
    }
    /// Register an opening before handing its token to a consumer. The future
    /// host maps these named native refusals into the protocol's refused phase.
    /// No unregistered token is accepted, even within this process incarnation.
    pub fn opening(
        &mut self,
        viewer: &str,
        declaration: &str,
        page_size: usize,
        now: i64,
        ceilings: Ceilings,
    ) -> Result<Opening, RuntimeError> {
        let refuse = |code, message: &str| RuntimeError::Structural {
            code,
            message: message.into(),
        };
        if viewer == crate::SYSTEM_PRINCIPAL
            || !crate::value::identity_fits(viewer)
            || declaration.len() > 128
            || !(1..=100).contains(&page_size)
        {
            return Err(refuse("E_FOLLOWING_INPUT", "invalid Following opening"));
        }
        let mut b = Budget::new(ceilings, 0);
        if !b.take(Metered {
            examined: 1,
            steps: 64,
            heap_bytes: LIFECYCLE_SCRATCH,
            rows_written: 3,
            output_bytes: ENVELOPE,
            ..Default::default()
        }) {
            return Err(refuse(
                "E_FOLLOWING_REQUEST_TOO_SMALL",
                "Following opening cannot fit its request allowance",
            ));
        }
        let view = (viewer.to_owned(), declaration.to_owned());
        if self.counts.get(&view).copied().unwrap_or(0) >= SESSIONS_PER_VIEW
            || self.bytes + SESSION_BASE > self.total
            || SESSION_BASE > self.per_session
        {
            return Err(refuse(
                "E_FOLLOWING_QUOTA",
                "Following session quota is exhausted",
            ));
        }
        let opening = format!("{}{}", self.incarnation, &token()?[32..]);
        let key = (viewer.to_owned(), opening.clone());
        self.openings.insert(
            key.clone(),
            Registration {
                identity: None,
                projection: None,
                arguments: None,
                declaration: declaration.into(),
                page_size,
                touched: now,
                abandoned: false,
            },
        );
        self.expiry.insert((now.saturating_add(IDLE_MS), key));
        *self.counts.entry(view).or_default() += 1;
        self.bytes += SESSION_BASE;
        Ok(Opening {
            request: Request {
                declaration: declaration.into(),
                page_size,
                opening,
                token: None,
            },
            metered: b.used,
        })
    }
    /// Bind the generated operation and normalized arguments before the host
    /// hands the opening to its consumer. The digest keeps registration small.
    pub fn opening_projected(
        &mut self,
        engine: &Engine,
        operation: &str,
        mut context: Context,
    ) -> Result<Opening, RuntimeError> {
        let p = engine
            .programs
            .get(operation)
            .ok_or_else(|| RuntimeError::Input("unknown Following operation".into()))?;
        let plan = projection::plan(&engine.schema, p).ok_or_else(|| RuntimeError::Structural {
            code: "E_FOLLOWING_DECLARATION",
            message: "not a generated Following projection".into(),
        })?;
        super::validate::validate_inputs(&engine.schema, p, &mut context.args)?;
        if plan
            .binding
            .cursor
            .as_ref()
            .is_some_and(|c| context.args.get(c).is_some_and(|v| v != &Value::Null))
        {
            return Err(RuntimeError::Structural {
                code: "E_FOLLOWING_INPUT",
                message: "history starts without an inbox cursor".into(),
            });
        }
        let args_heap = context
            .args
            .values()
            .map(super::runner::expression_copy)
            .sum::<u64>()
            .saturating_mul(4);
        let mut admission = Budget::new(engine.ceilings, 0);
        if !admission.take(Metered {
            heap_bytes: LIFECYCLE_SCRATCH.saturating_add(args_heap),
            rows_written: 3,
            output_bytes: ENVELOPE,
            examined: 1,
            steps: 64,
            ..Default::default()
        }) {
            return Err(RuntimeError::Structural {
                code: "E_FOLLOWING_REQUEST_TOO_SMALL",
                message: "Following arguments exceed admission allowance".into(),
            });
        }
        let identity = (
            engine.store.meta("store_id")?.unwrap_or_default(),
            engine.generation,
        );
        let digest = argument_digest(&context.args);
        let mut o = self.opening(
            &context.viewer,
            &plan.binding.declaration,
            plan.binding.page_size,
            context.now.unwrap_or_else(crate::now_ms),
            engine.ceilings,
        )?;
        let registered = self
            .openings
            .get_mut(&(context.viewer, o.request.opening.clone()))
            .unwrap();
        registered.identity = Some(identity);
        registered.projection = Some(operation.into());
        registered.arguments = Some(digest);
        o.metered = admission.used;
        Ok(o)
    }

    pub fn accounted_bytes(&self) -> u64 {
        self.bytes
    }

    pub fn request(
        &mut self,
        engine: &mut Engine,
        request: Request,
        context: Context,
    ) -> Result<Outcome, RuntimeError> {
        self.request_inner(engine, request, context, None)
    }

    pub fn request_projected(
        &mut self,
        engine: &mut Engine,
        request: Request,
        context: Context,
        operation: &str,
    ) -> Result<Outcome, RuntimeError> {
        self.request_inner(engine, request, context, Some(operation))
    }

    fn request_inner(
        &mut self,
        engine: &mut Engine,
        request: Request,
        mut context: Context,
        operation: Option<&str>,
    ) -> Result<Outcome, RuntimeError> {
        let plan = operation
            .map(|name| {
                let p = engine
                    .programs
                    .get(name)
                    .ok_or_else(|| RuntimeError::Input("unknown Following projection".into()))?;
                let plan = projection::plan(&engine.schema, p).ok_or_else(|| {
                    RuntimeError::Structural {
                        code: "E_FOLLOWING_DECLARATION",
                        message: "operation is not a generated Following projection".into(),
                    }
                })?;
                super::validate::validate_inputs(&engine.schema, p, &mut context.args)?;
                Ok::<_, RuntimeError>(plan)
            })
            .transpose()?;
        let now = context.now.unwrap_or_else(crate::now_ms);
        let mut budget = Budget::new(engine.ceilings, request.page_size.min(100));
        if plan.is_some() {
            budget.publication.heap_bytes = 4 << 20;
        }
        if plan.as_ref().is_some_and(|p| {
            p.binding.declaration != request.declaration
                || p.binding.page_size != request.page_size
                || p.binding
                    .cursor
                    .as_ref()
                    .is_some_and(|c| context.args.get(c).is_some_and(|v| v != &Value::Null))
        }) {
            return simple(Response::Restart, budget);
        }
        if !budget.take(Metered {
            examined: 2,
            steps: 64,
            heap_bytes: SCRATCH,
            output_bytes: ENVELOPE,
            ..Default::default()
        }) {
            return Err(RuntimeError::Input(
                "Following request allowance cannot hold its control envelope and scratch".into(),
            ));
        }
        if context.viewer == crate::SYSTEM_PRINCIPAL
            || !crate::value::identity_fits(&context.viewer)
            || request.opening.len() != 64
            || !request.opening.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return simple(
                Response::Refused {
                    code: "E_FOLLOWING_INPUT",
                },
                budget,
            );
        }
        if !request.opening.starts_with(&self.incarnation) {
            return simple(Response::Restart, budget);
        }
        if request
            .token
            .as_ref()
            .is_some_and(|t| t.len() != 64 || !t.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return simple(Response::Restart, budget);
        }
        if !budget.fits(budget.publication) {
            return simple(
                Response::Refused {
                    code: "E_FOLLOWING_REQUEST_TOO_SMALL",
                },
                budget,
            );
        }
        let key = (context.viewer.clone(), request.opening.clone());
        let token = request.token.as_ref().unwrap_or(&request.opening);
        let tx = engine.store.read_transaction()?;
        let store = tx.meta("store_id")?.unwrap_or_default();
        let head = tx.next_seq()?.saturating_sub(1);
        let Some(timeline) = engine
            .schema
            .timelines
            .iter()
            .find(|t| t.name == request.declaration)
        else {
            return simple(
                if request.token.is_some()
                    || self.sessions.contains_key(&key)
                    || self.openings.contains_key(&key)
                {
                    Response::Restart
                } else {
                    Response::Refused {
                        code: "E_FOLLOWING_DECLARATION",
                    }
                },
                budget,
            );
        };
        if !(1..=100).contains(&request.page_size) {
            return simple(
                if self.sessions.contains_key(&key) || self.openings.contains_key(&key) {
                    Response::Restart
                } else {
                    Response::Refused {
                        code: "E_FOLLOWING_PAGE_SIZE",
                    }
                },
                budget,
            );
        }
        let existing = self.sessions.get(&key);
        if let Some(s) = existing {
            if s.abandoned
                || now.saturating_sub(s.touched) >= IDLE_MS
                || s.declaration != request.declaration
                || s.page_size != request.page_size
                || s.projection.as_deref() != operation
                || s.arguments != context.args
                || s.store != store
                || s.generation != engine.generation
                || head < s.head
            {
                return simple(Response::Restart, budget);
            }
            if let Some(unit) = s.units.iter().find(|u| &u.token == token) {
                let outcome = session::replay(&tx, &engine.schema, timeline, s, unit, budget, now)?;
                if !matches!(
                    outcome.answer.response,
                    Response::Restart | Response::Refused { .. }
                ) {
                    let s = self.sessions.get_mut(&key).unwrap();
                    self.expiry
                        .remove(&(s.touched.saturating_add(IDLE_MS), key.clone()));
                    s.touched = now.max(s.touched);
                    s.head = head;
                    self.expiry.insert((s.touched.saturating_add(IDLE_MS), key));
                }
                return Ok(outcome);
            }
            if token != &s.pending_token {
                return simple(Response::Restart, budget);
            }
        } else {
            let Some(o) = self.openings.get(&key) else {
                return simple(Response::Restart, budget);
            };
            if request.token.is_some()
                || o.abandoned
                || now.saturating_sub(o.touched) >= IDLE_MS
                || request.declaration != o.declaration
                || request.page_size != o.page_size
                || o.identity
                    .as_ref()
                    .is_some_and(|(incarnation, generation)| {
                        incarnation != &store || *generation != engine.generation
                    })
                || o.projection.as_deref() != operation
                || o.arguments
                    .as_ref()
                    .is_some_and(|a| a != &argument_digest(&context.args))
                || (operation.is_none() && !context.args.is_empty())
            {
                return simple(Response::Restart, budget);
            }
        }
        // The bounded record map is copied; its head records are copy-on-write.
        // Refusals, storage errors and failed publication leave the old unit intact.
        let fork = existing.map_or(
            SESSION_BASE
                + context
                    .args
                    .values()
                    .map(super::runner::expression_copy)
                    .sum::<u64>(),
            |s| {
                SESSION_BASE
                    + s.arguments
                        .values()
                        .map(super::runner::expression_copy)
                        .sum::<u64>()
                    + s.frontier.fork_bytes()
                    + s.staged_bytes
            },
        );
        let nodes = existing.map_or(0, |s| s.frontier.block_count() as u64);
        if !budget.work(
            Metered {
                heap_bytes: fork,
                examined: nodes,
                steps: nodes * 16,
                ..Default::default()
            },
            5,
        ) {
            return simple(
                Response::Refused {
                    code: "E_FOLLOWING_REQUEST_TOO_SMALL",
                },
                budget,
            );
        }
        let old_bytes = existing.map_or(SESSION_BASE, Session::bytes);
        let other_bytes = self.bytes - old_bytes;
        let mut session = if let Some(s) = existing {
            s.clone()
        } else {
            let mut s = Session {
                viewer: context.viewer.clone(),
                declaration: request.declaration.clone(),
                page_size: request.page_size,
                arguments: context.args.clone(),
                projection: operation.map(str::to_owned),
                store,
                generation: engine.generation,
                bound: format!("{head:016x}ffffffffffffffff"),
                head,
                touched: now,
                pending_token: request.opening.clone(),
                abandoned: false,
                frontier: Frontier::default(),
                retained: false,
                dirty: BTreeSet::new(),
                pending: None,
                edge_after: None,
                discovered: false,
                lanes: 0,
                after: None,
                staged: Vec::new(),
                staged_bytes: 0,
                item_bytes: 0,
                units: VecDeque::new(),
            };
            s.reset_scan();
            s
        };
        session.dirty.clear();
        let outcome = session::advance(
            &tx,
            &engine.schema,
            plan.as_ref(),
            now,
            timeline,
            &mut session,
            budget,
            self.per_session,
            self.total.saturating_sub(other_bytes),
        )?;
        // Publication and checkpoint are one ownership swap under the host's
        // controller lock. No source writes, application commits or sync events.
        if matches!(
            outcome.answer.response,
            Response::Page { .. } | Response::Preparing { .. } | Response::Stalled { .. }
        ) {
            tx.rollback()?;
            let touched = self
                .openings
                .get(&key)
                .map_or(session.touched, |o| o.touched);
            self.expiry
                .remove(&(touched.saturating_add(IDLE_MS), key.clone()));
            self.openings.remove(&key);
            session.touched = now.max(session.touched);
            session.head = head;
            self.bytes = other_bytes + session.bytes();
            self.expiry
                .insert((session.touched.saturating_add(IDLE_MS), key.clone()));
            self.sessions.insert(key, session);
        }
        Ok(outcome)
    }

    /// Cancellation only abandons the addressed consumer. Reclamation is separate
    /// and bounded, so neither expiry nor a cancellation storm drops a huge heap.
    pub fn cancel(&mut self, viewer: &str, opening: &str, ceilings: Ceilings) -> Metered {
        let mut b = Budget::new(ceilings, 0);
        if !crate::value::identity_fits(viewer)
            || opening.len() != 64
            || !b.take(Metered {
                steps: 32,
                heap_bytes: LIFECYCLE_SCRATCH,
                rows_written: 1,
                ..Default::default()
            })
        {
            return b.used;
        }
        let key = (viewer.to_owned(), opening.to_owned());
        if let Some(o) = self.openings.get_mut(&key) {
            self.expiry
                .remove(&(o.touched.saturating_add(IDLE_MS), key.clone()));
            o.abandoned = true;
            self.expiry.insert((i64::MIN, key));
        } else if let Some(s) = self.sessions.get_mut(&key) {
            self.expiry
                .remove(&(s.touched.saturating_add(IDLE_MS), key.clone()));
            s.abandoned = true;
            self.expiry.insert((i64::MIN, key));
        }
        b.used
    }
}

fn token() -> Result<String, RuntimeError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|e| RuntimeError::Store(format!("history token entropy: {e}")))?;
    Ok(crate::value::encode_bytes_hex(&bytes))
}

fn pinned(response: Response) -> Arc<Pinned> {
    let bytes = serde_json::to_string(&response)
        .expect("bounded Following response consists of strings and integers");
    Arc::new(Pinned { response, bytes })
}
fn simple(response: Response, budget: Budget) -> Result<Outcome, RuntimeError> {
    let answer = pinned(response);
    debug_assert!(answer.bytes.len() as u64 <= ENVELOPE);
    Ok(Outcome {
        answer,
        metered: budget.used,
        frontier_writes: 0,
    })
}

#[cfg(test)]
mod tests;

fn argument_digest(args: &BTreeMap<String, Value>) -> String {
    use sha2::{Digest, Sha256};
    crate::value::encode_bytes_hex(&Sha256::digest(
        crate::value::canonical_json(args).as_bytes(),
    ))
}
