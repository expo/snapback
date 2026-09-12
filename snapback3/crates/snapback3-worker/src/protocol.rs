use serde::Serialize;
use serde_json::{Value as Json, json};
use snapback3_core::{
    Actor, Context, DeliveryProjectionContext, IdentityError, OperationError, OperationRequest,
    ProgramKind, Runtime, RuntimeError, SessionAuthority, project_delivery,
};
use std::{
    collections::BTreeMap,
    fmt::Display,
    time::{SystemTime, UNIX_EPOCH},
};

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
        Ok(serde_json::to_value(envelope).expect("envelope serializable"))
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
