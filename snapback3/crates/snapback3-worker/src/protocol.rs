use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};
use snapback3_core::{
    Actor, ArgType, Context, DeliveryEnvelopeV1, DeliveryProjectionContext, DeliveryState,
    IdentityError, OperationError, OperationRequest, ProgramKind, Runtime, RuntimeError,
    SessionAuthority, project_delivery, value_to_wire_json,
};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fmt::Display,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const JS_SAFE_U64: u64 = 9_007_199_254_740_991;
// Empty certified pages are cheap enough that sixteen executions repeatedly
// stopped before either fairness guard. Thirty-two removes those avoidable
// round trips while the 20 ms and 1 MiB soft bounds still yield meaningful work.
const ACQUISITION_EXECUTIONS: usize = 32;
const ACQUISITION_SOFT_BYTES: usize = 1024 * 1024;
const ACQUISITION_HARD_BYTES: usize = 15 * 1024 * 1024;
const ACQUISITION_WORK: Duration = Duration::from_millis(20);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AcquisitionChain {
    key: String,
    op: String,
    args: Json,
    cursor: String,
    #[serde(default = "default_follow")]
    follow: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    validator: Option<String>,
}

fn default_follow() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AcquisitionRequest {
    expected_seq: Option<u64>,
    chains: Vec<AcquisitionChain>,
}

struct PendingAcquisition {
    seen_cursors: BTreeSet<Option<String>>,
    chain: AcquisitionChain,
}

impl PendingAcquisition {
    fn new(chain: AcquisitionChain) -> Self {
        let cursor = chain.args[&chain.cursor].as_str().map(str::to_owned);
        Self {
            seen_cursors: BTreeSet::from([cursor]),
            chain,
        }
    }

    fn advance(&mut self, actual_args: Json, next: String) -> Result<(), Fault> {
        if !self.seen_cursors.insert(Some(next.clone())) {
            return Err(Fault::new(
                "S3_ACQUISITION_CURSOR_REPEAT",
                format!(
                    "query {} repeated an acquisition cursor within one owner turn",
                    self.chain.op
                ),
            ));
        }
        self.chain.args = actual_args;
        self.chain
            .args
            .as_object_mut()
            .expect("acquisition args validated")
            .insert(self.chain.cursor.clone(), Json::String(next));
        self.chain.validator = None;
        Ok(())
    }
}

#[derive(Debug, Serialize)]
pub struct Fault {
    pub code: String,
    pub message: String,
}
impl Fault {
    pub fn new(code: &str, message: impl Display) -> Self {
        Self {
            code: code.into(),
            message: message.to_string(),
        }
    }
    pub fn input(error: impl Display) -> Self {
        Self::new("S3_INPUT", error)
    }
    pub fn internal(error: impl Display) -> Self {
        Self::new("S3_RUNTIME", error)
    }
    pub fn runtime(error: RuntimeError) -> Self {
        Self::internal(error)
    }
    fn auth(error: IdentityError) -> Self {
        Self::new("S3_AUTH", error)
    }
    fn operation(error: OperationError) -> Self {
        let code = match &error {
            OperationError::InvalidIntent => "S3_INTENT_INVALID",
            OperationError::IntentReused => "S3_INTENT_REUSED",
            OperationError::Changed => "S3_OPERATION_CHANGED",
            OperationError::Kind => "S3_OPERATION_KIND",
            OperationError::Runtime(_) => "S3_RUNTIME",
        };
        Self::new(code, error)
    }
}
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_millis() as i64
}
fn string<'a>(params: &'a Json, key: &str) -> Result<&'a str, Fault> {
    params
        .get(key)
        .and_then(Json::as_str)
        .ok_or_else(|| Fault::input(format!("{key} must be a string")))
}
fn ensure_safe_seq(seq: u64) -> Result<(), Fault> {
    if seq <= JS_SAFE_U64 {
        Ok(())
    } else {
        Err(Fault::new(
            "S3_SEQUENCE_CHANGED",
            "owner sequence exceeds the public JavaScript-safe range",
        ))
    }
}
fn sequence_changed(expected: u64, actual: u64) -> Fault {
    Fault::new(
        "S3_SEQUENCE_CHANGED",
        format!("acquisition sequence changed from {expected} to {actual}"),
    )
}

pub struct Owner {
    pub runtime: Runtime,
    pub development: bool,
}
impl Owner {
    fn authority(&self, params: &Json, at: i64) -> Result<SessionAuthority, Fault> {
        let token = params.get("token").and_then(Json::as_str).unwrap_or("");
        self.runtime.authenticate(token, at).map_err(Fault::auth)
    }
    fn context(authority: &SessionAuthority, at: i64, mutation: bool) -> Result<Context, Fault> {
        let actor = Actor::try_from(&authority.principal).map_err(Fault::input)?;
        let mut context = if mutation {
            Context::mutation(actor, BTreeMap::new())
        } else {
            Context::query(actor, BTreeMap::new())
        };
        context.auth_epoch = authority.auth_epoch;
        context.read_time = Some(at);
        if mutation {
            context.now = Some(at);
        }
        Ok(context)
    }
    pub fn call(&mut self, method: &str, params: &Json) -> Result<Json, Fault> {
        let at = now();
        match method {
            "health" => Ok(
                json!({"ok":true,"pid":std::process::id(),"version":env!("CARGO_PKG_VERSION"),"seq":self.runtime.store().commit_seq().map_err(Fault::runtime)?}),
            ),
            "manifest" => Ok(self.manifest()),
            "authenticate" => {
                Ok(serde_json::to_value(self.authority(params, at)?)
                    .expect("authority serializable"))
            }
            "auth" => self.auth(params, at),
            "query" => {
                let authority = self.authority(params, at)?;
                self.query(params, &authority, at)
            }
            "read" => {
                let authority = self.authority(params, at)?;
                let queries = params
                    .get("queries")
                    .and_then(Json::as_array)
                    .ok_or_else(|| Fault::input("queries must be an array"))?;
                if queries.len() > 64 {
                    return Err(Fault::input("at most 64 query resources per read"));
                }
                let mut resources = Vec::new();
                for query in queries {
                    let key = string(query, "key")?;
                    resources.push(match self.query(query, &authority, at) {
                        Ok(envelope) => json!({"key":key,"envelope":envelope}),
                        Err(error) => json!({"key":key,"error":error}),
                    });
                }
                Ok(
                    json!({"seq":self.runtime.store().commit_seq().map_err(Fault::runtime)?,
                    "generation":self.runtime.generation().program_hash(),"resources":resources}),
                )
            }
            "acquire" => {
                let authority = self.authority(params, at)?;
                self.acquire(params, &authority, at)
            }
            "mutation" => {
                let authority = self.authority(params, at)?;
                let mut request = params
                    .as_object()
                    .ok_or_else(|| Fault::input("mutation must be an object"))?
                    .clone();
                request.remove("token");
                let request: OperationRequest =
                    serde_json::from_value(Json::Object(request)).map_err(Fault::input)?;
                self.runtime
                    .execute_operation(&request, Self::context(&authority, at, true)?)
                    .map_err(Fault::operation)
            }
            "status" => {
                let authority = self.authority(params, at)?;
                Ok(self
                    .runtime
                    .store()
                    .stored_operation(authority.principal.id.as_str(), string(params, "intent")?)
                    .map_err(Fault::runtime)?
                    .map(|intent| intent.response)
                    .unwrap_or(Json::Null))
            }
            "project" => {
                let project = serde_json::from_value(
                    params
                        .get("project")
                        .cloned()
                        .ok_or_else(|| Fault::input("project required"))?,
                )
                .map_err(Fault::input)?;
                let next = crate::project::certify(project)?;
                self.runtime
                    .apply_successor(next)
                    .map_err(|error| Fault::new("S3_SUCCESSOR", error))?;
                Ok(self.manifest())
            }
            _ => Err(Fault::new("S3_METHOD", "unknown private worker method")),
        }
    }
    fn auth(&mut self, params: &Json, at: i64) -> Result<Json, Fault> {
        let session = match string(params, "action")? {
            "persona" if self.development => self.runtime.persona(string(params, "name")?, at),
            "persona" => {
                return Err(Fault::new(
                    "S3_FORBIDDEN",
                    "personas are available only in the development server",
                ));
            }
            "signup" => {
                self.runtime
                    .signup(string(params, "email")?, string(params, "password")?, at)
            }
            "login" => {
                self.runtime
                    .login(string(params, "email")?, string(params, "password")?, at)
            }
            "logout" => {
                self.runtime
                    .logout(string(params, "token")?, at)
                    .map_err(Fault::auth)?;
                return Ok(json!({"ok":true}));
            }
            _ => return Err(Fault::input("unknown authentication action")),
        }
        .map_err(Fault::auth)?;
        Ok(serde_json::to_value(session).expect("session serializable"))
    }
    fn query(
        &mut self,
        params: &Json,
        authority: &SessionAuthority,
        at: i64,
    ) -> Result<Json, Fault> {
        let (envelope, _) = self.query_delivery(params, authority, at)?;
        Ok(serde_json::to_value(envelope).expect("envelope serializable"))
    }
    fn query_delivery(
        &mut self,
        params: &Json,
        authority: &SessionAuthority,
        at: i64,
    ) -> Result<(DeliveryEnvelopeV1, Json), Fault> {
        let op = string(params, "op")?;
        let (program, certificate) = self
            .runtime
            .generation()
            .programs()
            .get(op)
            .filter(|(_, _)| !op.starts_with("__"))
            .ok_or_else(|| Fault::new("S3_OPERATION_UNKNOWN", format!("unknown query {op}")))?
            .clone();
        if program.kind != ProgramKind::Query {
            return Err(Fault::new(
                "S3_OPERATION_KIND",
                "query route accepts queries only",
            ));
        }
        let mut context = Self::context(authority, at, false)?;
        context.args =
            snapback3_core::wire::program_args(&program, params.get("args").unwrap_or(&json!({})))
                .map_err(Fault::runtime)?;
        let args = Json::Object(
            context
                .args
                .iter()
                .map(|(name, value)| (name.clone(), value_to_wire_json(value)))
                .collect(),
        );
        let execution = self
            .runtime
            .execute(op, context.clone())
            .map_err(Fault::runtime)?;
        let generation = self.runtime.generation();
        let schema_hash = generation.schema().hash();
        let envelope = project_delivery(
            &execution,
            &DeliveryProjectionContext {
                schema: generation.schema(),
                read_time: context
                    .query_read_time(&program, &certificate)
                    .map_err(Fault::runtime)?,
                op,
                args: &context.args,
                generation: generation.program_hash(),
                schema_hash: &schema_hash,
                plan_hash: &certificate.plan_hash,
                principal: context.viewer(),
                auth_epoch: context.auth_epoch,
            },
        )
        .map_err(Fault::internal)?;
        Ok((envelope, args))
    }
    fn acquire(
        &mut self,
        params: &Json,
        authority: &SessionAuthority,
        at: i64,
    ) -> Result<Json, Fault> {
        let mut request = params
            .as_object()
            .ok_or_else(|| Fault::input("acquire must be an object"))?
            .clone();
        request.remove("token");
        if matches!(request.get("expectedSeq"), Some(Json::Null)) {
            return Err(Fault::input(
                "expectedSeq must be a nonnegative safe integer",
            ));
        }
        if request
            .get("chains")
            .and_then(Json::as_array)
            .is_some_and(|chains| {
                chains.iter().any(|chain| {
                    chain
                        .as_object()
                        .is_some_and(|chain| matches!(chain.get("validator"), Some(Json::Null)))
                })
            })
        {
            return Err(Fault::input("validator must be a lowercase SHA-256 digest"));
        }
        let request: AcquisitionRequest =
            serde_json::from_value(Json::Object(request)).map_err(Fault::input)?;
        if request.chains.is_empty() || request.chains.len() > 64 {
            return Err(Fault::input(
                "chains must contain between 1 and 64 declarations",
            ));
        }
        if request.expected_seq.is_some_and(|seq| seq > JS_SAFE_U64) {
            return Err(Fault::input(
                "expectedSeq must be a nonnegative safe integer",
            ));
        }

        let mut seen = BTreeSet::new();
        for chain in &request.chains {
            self.validate_acquisition_chain(chain)?;
            if !seen.insert(chain.key.clone()) {
                return Err(Fault::input(
                    "acquisition chain keys must be unique within a request",
                ));
            }
        }

        let turn_seq = self.runtime.store().commit_seq().map_err(Fault::runtime)?;
        ensure_safe_seq(turn_seq)?;
        if request
            .expected_seq
            .is_some_and(|expected| expected != turn_seq)
        {
            return Err(Fault::new(
                "S3_SEQUENCE_CHANGED",
                format!(
                    "acquisition expected sequence {} but the owner is at {turn_seq}",
                    request.expected_seq.expect("checked some")
                ),
            ));
        }
        let generation = self.runtime.generation().program_hash().to_owned();
        let started = Instant::now();
        let mut pending = request
            .chains
            .into_iter()
            .map(PendingAcquisition::new)
            .collect::<VecDeque<_>>();
        let mut pages = Vec::new();
        let mut response_bytes = 0usize;

        while let Some(mut pending_chain) = pending.pop_front() {
            if !pages.is_empty()
                && (pages.len() >= ACQUISITION_EXECUTIONS
                    || response_bytes >= ACQUISITION_SOFT_BYTES
                    || started.elapsed() >= ACQUISITION_WORK)
            {
                pending.push_front(pending_chain);
                break;
            }
            let chain = &mut pending_chain.chain;
            let query = json!({"op":chain.op,"args":chain.args});
            let (envelope, actual_args) = self.query_delivery(&query, authority, at)?;
            if envelope.seq != turn_seq {
                return Err(sequence_changed(turn_seq, envelope.seq));
            }
            if envelope.generation != generation {
                return Err(Fault::new(
                    "S3_GENERATION_CHANGED",
                    "acquisition generation changed within one owner turn",
                ));
            }
            // @ref LLP 2000#16-making-acquisition-fast —
            // a stopped traversal is not a dataset-completeness claim; partial,
            // denied, and capped-without-next remain visible in the page message.
            let next = if chain.follow
                && matches!(
                    envelope.state,
                    DeliveryState::Complete | DeliveryState::Capped
                ) {
                envelope.next.clone()
            } else {
                None
            };
            let message = if chain
                .validator
                .as_ref()
                .is_some_and(|validator| validator == &envelope.validator)
            {
                json!({"state":"unchanged","seq":envelope.seq,"validator":envelope.validator})
            } else {
                serde_json::to_value(envelope).expect("envelope serializable")
            };
            let page = json!({
                "key":chain.key,
                "op":chain.op,
                "args":actual_args,
                "message":message,
            });
            response_bytes = response_bytes
                .saturating_add(serde_json::to_vec(&page).map_err(Fault::internal)?.len());
            pages.push(page);
            if let Some(next) = next {
                pending_chain.advance(actual_args, next)?;
                pending.push_back(pending_chain);
            }
        }

        let final_seq = self.runtime.store().commit_seq().map_err(Fault::runtime)?;
        if final_seq != turn_seq {
            return Err(sequence_changed(turn_seq, final_seq));
        }
        if self.runtime.generation().program_hash() != generation {
            return Err(Fault::new(
                "S3_GENERATION_CHANGED",
                "acquisition generation changed before the owner turn completed",
            ));
        }
        let more = !pending.is_empty();
        let continuations = pending
            .into_iter()
            .map(|pending| pending.chain)
            .collect::<Vec<_>>();
        let response = json!({
            "generation":generation,
            "seq":turn_seq,
            "pages":pages,
            "continuations":continuations,
            "more":more,
        });
        if serde_json::to_vec(&response)
            .map_err(Fault::internal)?
            .len()
            > ACQUISITION_HARD_BYTES
        {
            return Err(Fault::new(
                "S3_ACQUISITION_OVERSIZE",
                "acquisition response exceeds the 15 MiB worker-frame budget",
            ));
        }
        Ok(response)
    }
    fn validate_acquisition_chain(&self, chain: &AcquisitionChain) -> Result<(), Fault> {
        if chain.key.is_empty() || chain.key.len() > 512 {
            return Err(Fault::input(
                "acquisition key must be a nonempty string of at most 512 bytes",
            ));
        }
        if chain.op.is_empty() || chain.op.len() > 256 {
            return Err(Fault::input(
                "acquisition op must be a nonempty string of at most 256 bytes",
            ));
        }
        if chain.cursor.is_empty() || chain.cursor.len() > 256 {
            return Err(Fault::input(
                "acquisition cursor must be a nonempty string of at most 256 bytes",
            ));
        }
        if chain.validator.is_some() && chain.follow {
            return Err(Fault::input(
                "validator requires follow:false so conditional refresh executes one page",
            ));
        }
        if chain.validator.as_ref().is_some_and(|validator| {
            validator.len() != 64
                || !validator
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        }) {
            return Err(Fault::input("validator must be a lowercase SHA-256 digest"));
        }
        let args = chain
            .args
            .as_object()
            .ok_or_else(|| Fault::input("acquisition args must be a JSON object"))?;
        if !matches!(args.get(&chain.cursor), Some(Json::Null | Json::String(_))) {
            return Err(Fault::input(format!(
                "acquisition args must explicitly contain {} as null or a cursor string",
                chain.cursor
            )));
        }
        let (program, certificate) = self
            .runtime
            .generation()
            .programs()
            .get(&chain.op)
            .filter(|_| !chain.op.starts_with("__"))
            .ok_or_else(|| {
                Fault::new(
                    "S3_OPERATION_UNKNOWN",
                    format!("unknown query {}", chain.op),
                )
            })?;
        if program.kind != ProgramKind::Query {
            return Err(Fault::new(
                "S3_OPERATION_KIND",
                "acquisition accepts queries only",
            ));
        }
        if !matches!(
            program.args.get(&chain.cursor),
            Some(ArgType::Optional(inner)) if matches!(inner.as_ref(), ArgType::Cursor)
        ) || snapback3_core::certificate::result_cursor(program, certificate).as_deref()
            != Some(&chain.cursor)
        {
            return Err(Fault::input(format!(
                "{} must be a certified result-page query and {} must be Optional<Cursor>",
                chain.op, chain.cursor
            )));
        }
        snapback3_core::wire::program_args(program, &chain.args).map_err(Fault::input)?;
        Ok(())
    }
    fn manifest(&self) -> Json {
        let generation = self.runtime.generation();
        let programs: serde_json::Map<String, Json> = generation.programs().iter().filter(|(name, _)| !name.starts_with("__"))
            .map(|(name, (program, certificate))| (name.clone(), json!({"kind":match program.kind { ProgramKind::Query => "query", _ => "mutation" },
                "ir":program,"certificate":certificate,"planHash":certificate.plan_hash}))).collect();
        json!({"generation":generation.program_hash(),"schemaHash":generation.schema().hash(),
            "schema":generation.schema(),"programs":programs,"seq":self.runtime.store().commit_seq().unwrap_or(0)})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback3_core::{
        Auth, Bound, Ceilings, ColumnType, Expr, Generation, Index, KeyProvenance, Order, Program,
        ProjectJson, Scan, Schema, Stmt, Store, Value, object, public_table,
        search_key::IndexComponent,
    };

    fn fixture() -> (Owner, String) {
        let mut schema = Schema::default();
        schema.tables.insert(
            "items".into(),
            public_table(
                BTreeMap::from([
                    ("id".into(), ColumnType::Id),
                    ("name".into(), ColumnType::Text { max: 64 }),
                ]),
                BTreeMap::from([(
                    "byId".into(),
                    Index {
                        components: vec![IndexComponent::Column("id".into())],
                        unique: true,
                    },
                )]),
            ),
        );
        let program = Program {
            name: "items.page".into(),
            kind: ProgramKind::Query,
            args: BTreeMap::from([
                ("c".into(), ArgType::Optional(Box::new(ArgType::Cursor))),
                (
                    "scope".into(),
                    ArgType::Optional(Box::new(ArgType::Text {
                        max: 64,
                        min: 0,
                        format: None,
                    })),
                ),
            ]),
            read_time_granularity_ms: None,
            body: vec![Stmt::Return(Expr::Scan(Scan {
                site: "items.page".into(),
                table: "items".into(),
                index: "byId".into(),
                prefix: Vec::new(),
                take: Bound::Literal(2),
                order: Order::Asc,
                after: Some(Box::new(Expr::Variable("c".into()))),
                before: None,
                range: None,
                opaque_cursor: true,
                merge_site: None,
                provenance: KeyProvenance::Const,
            }))],
        };
        let generation = Generation::certify(
            &ProjectJson {
                version: 1,
                schema,
                programs: vec![program],
                effects: Vec::new(),
                auth: Auth::default(),
            },
            Ceilings::default(),
        )
        .unwrap();
        let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
        runtime
            .seed(
                &(0..5)
                    .map(|number| {
                        (
                            "items".into(),
                            object([
                                ("id", Value::Id(format!("item-{number}"))),
                                ("name", Value::String(format!("Item {number}"))),
                            ]),
                        )
                    })
                    .collect::<Vec<_>>(),
            )
            .unwrap();
        let mut owner = Owner {
            runtime,
            development: true,
        };
        let session = owner
            .call("auth", &json!({"action":"persona","name":"alice"}))
            .unwrap();
        (owner, session["token"].as_str().unwrap().to_owned())
    }

    fn declaration(key: &str) -> Json {
        json!({
            "key":key,
            "op":"items.page",
            "args":{"c":null},
            "cursor":"c",
        })
    }

    #[test]
    fn acquisition_follows_pages_and_conditionally_revalidates_one_page() {
        let (mut owner, token) = fixture();
        let seq = owner.runtime.store().commit_seq().unwrap();
        let mut request = json!({
            "token":token,
            "expectedSeq":seq,
            "chains":[declaration("items")],
        });
        let mut pages = Vec::new();
        loop {
            let response = owner.call("acquire", &request).unwrap();
            assert_eq!(response["seq"], seq);
            pages.extend(response["pages"].as_array().unwrap().iter().cloned());
            if response["more"] == false {
                break;
            }
            request = json!({
                "token":token,
                "expectedSeq":seq,
                "chains":response["continuations"],
            });
        }
        assert_eq!(pages.len(), 3);
        assert!(pages.iter().all(|page| page["key"] == "items"));
        assert_eq!(pages[0]["args"]["c"], Json::Null);
        assert!(pages[1]["args"]["c"].is_string());
        assert_eq!(pages[2]["message"]["state"], "complete");
        assert_eq!(pages[2]["message"]["next"], Json::Null);
        assert!(pages.iter().all(|page| page["message"]["seq"] == seq));

        let validator = pages[0]["message"]["validator"].clone();
        let unchanged = owner
            .call(
                "acquire",
                &json!({
                    "token":token,
                    "expectedSeq":seq,
                    "chains":[{
                        "key":"items:first",
                        "op":"items.page",
                        "args":pages[0]["args"],
                        "cursor":"c",
                        "follow":false,
                        "validator":validator,
                    }],
                }),
            )
            .unwrap();
        assert_eq!(unchanged["pages"].as_array().unwrap().len(), 1);
        assert_eq!(unchanged["pages"][0]["message"]["state"], "unchanged");
        assert_eq!(unchanged["pages"][0]["message"]["validator"], validator);
        assert_eq!(unchanged["more"], false);
    }

    #[test]
    fn acquisition_canonicalizes_only_executed_continuations() {
        let (mut owner, token) = fixture();
        let mut chains = vec![declaration("continued")];
        chains.extend((0..ACQUISITION_EXECUTIONS).map(|number| {
            json!({
                "key":format!("waiting-{number}"),
                "op":"items.page",
                "args":{"c":null},
                "cursor":"c",
                "follow":false,
            })
        }));

        let response = owner
            .call("acquire", &json!({"token":token,"chains":chains}))
            .unwrap();
        let continuations = response["continuations"].as_array().unwrap();
        let continued = continuations
            .iter()
            .find(|continuation| continuation["key"] == "continued")
            .expect("the executed followed page remains runnable");
        assert!(continued["args"]["c"].is_string());
        assert_eq!(continued["args"]["scope"], Json::Null);

        let waiting = continuations
            .iter()
            .find(|continuation| {
                continuation["key"]
                    .as_str()
                    .is_some_and(|key| key.starts_with("waiting-"))
            })
            .expect("at least one declaration is stopped before execution");
        assert!(waiting["args"].get("scope").is_none());
    }

    #[test]
    fn acquisition_rejects_invalid_declarations_and_changed_sequence() {
        let (mut owner, token) = fixture();
        let seq = owner.runtime.store().commit_seq().unwrap();
        owner
            .runtime
            .seed(&[(
                "items".into(),
                object([
                    ("id", Value::Id("item-after".into())),
                    ("name", Value::String("After".into())),
                ]),
            )])
            .unwrap();
        let changed = owner
            .call(
                "acquire",
                &json!({"token":token,"expectedSeq":seq,"chains":[declaration("one")]}),
            )
            .unwrap_err();
        assert_eq!(changed.code, "S3_SEQUENCE_CHANGED");
        assert_eq!(
            owner
                .call(
                    "acquire",
                    &json!({"token":"invalid","chains":[declaration("one")]})
                )
                .unwrap_err()
                .code,
            "S3_AUTH"
        );

        for chains in [
            json!([declaration("same"), declaration("same")]),
            json!([{
                "key":"bad-cursor","op":"items.page","args":{"other":null},
                "cursor":"other",
            }]),
            json!([{
                "key":"bad-validator","op":"items.page","args":{"c":null},
                "cursor":"c","validator":"0".repeat(64),
            }]),
            json!([{
                "key":"unknown","op":"items.unknown","args":{"c":null},"cursor":"c",
            }]),
            json!([{
                "key":"x".repeat(513),"op":"items.page","args":{"c":null},"cursor":"c",
            }]),
            json!([{
                "key":"unknown-field","op":"items.page","args":{"c":null},"cursor":"c",
                "extra":true,
            }]),
        ] {
            assert!(
                owner
                    .call("acquire", &json!({"token":token,"chains":chains}))
                    .is_err()
            );
        }
        assert!(
            owner
                .call(
                    "acquire",
                    &json!({"token":token,"chains":[declaration("one")],"extra":true})
                )
                .is_err()
        );
    }

    #[test]
    fn acquisition_bounds_each_turn_and_preserves_full_continuations() {
        let (mut owner, token) = fixture();
        let chains = (0..33)
            .map(|number| {
                json!({
                    "key":format!("item-{number}"),
                    "op":"items.page",
                    "args":{"c":null},
                    "cursor":"c",
                    "follow":false,
                    "validator":"0".repeat(64),
                })
            })
            .collect::<Vec<_>>();
        let response = owner
            .call("acquire", &json!({"token":token,"chains":chains}))
            .unwrap();
        let pages = response["pages"].as_array().unwrap();
        let continuations = response["continuations"].as_array().unwrap();
        assert!(!pages.is_empty());
        assert_eq!(pages.len(), ACQUISITION_EXECUTIONS);
        assert_eq!(pages.len() + continuations.len(), 33);
        assert_eq!(response["more"], true);
        assert!(continuations.iter().all(|continuation| {
            continuation["follow"] == false && continuation["validator"].is_string()
        }));

        let chain: AcquisitionChain = serde_json::from_value(declaration("repeat")).unwrap();
        let mut repeated = PendingAcquisition::new(chain);
        repeated
            .advance(
                json!({"c":null,"normalizedOptional":null}),
                "same-cursor".into(),
            )
            .unwrap();
        assert_eq!(
            repeated.chain.args,
            json!({"c":"same-cursor","normalizedOptional":null})
        );
        assert_eq!(
            repeated
                .advance(
                    json!({"c":"same-cursor","normalizedOptional":null}),
                    "same-cursor".into(),
                )
                .unwrap_err()
                .code,
            "S3_ACQUISITION_CURSOR_REPEAT"
        );
    }
}
