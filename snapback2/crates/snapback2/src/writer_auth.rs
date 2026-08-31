//! Session authority resolution and exact-epoch stream fencing.
// @ref LLP 1002#5-the-owner — bearer streams retain and fence the exact authenticated session epoch.

use super::*;
use snapback2_core::{IdentityError, Principal, SessionAuthority};
use std::time::Duration;

const MAX_SESSION_POLL: Duration = Duration::from_secs(1);

#[derive(Clone)]
pub(super) struct ResolvedAuthority {
    pub(super) principal: Principal,
    pub(super) session: Option<SessionFence>,
}

impl ResolvedAuthority {
    fn from_session(authority: SessionAuthority) -> Self {
        let session = SessionFence {
            principal: authority.principal.id.to_string(),
            auth_epoch: authority.auth_epoch,
        };
        Self {
            principal: authority.principal,
            session: Some(session),
        }
    }

    fn persona(principal: Principal) -> Self {
        Self {
            principal,
            session: None,
        }
    }

    fn auth_epoch(&self) -> u64 {
        self.session
            .as_ref()
            .map_or(0, |session| session.auth_epoch)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct SessionFence {
    principal: String,
    auth_epoch: u64,
}

impl SessionFence {
    fn matches(&self, authority: &SessionAuthority) -> bool {
        self.auth_epoch == authority.auth_epoch && self.principal == authority.principal.id.as_str()
    }
}

impl State {
    pub(super) fn resolve_authority(
        &mut self,
        identity: Identity,
    ) -> Result<ResolvedAuthority, Refusal> {
        match identity {
            Identity::Bearer(token) => {
                let now = self.now();
                // The sweep and authentication must share one clock sample. If
                // expiry crossed between an earlier dispatch sweep and this
                // lookup, deleting the session inside authenticate would lose
                // the epoch needed to terminate retained streams.
                self.sweep_expired_sessions_at(now)?;
                self.runtime()
                    .authenticate(&token, now)
                    .map(ResolvedAuthority::from_session)
                    .map_err(|error| Refusal::from_identity(&error))
            }
            Identity::Persona(name) => {
                self.require_dev_personas()?;
                let now = self.now();
                self.runtime_mut()
                    .ensure_persona(&name, now)
                    .map(ResolvedAuthority::persona)
                    .map_err(|error| Refusal::from_identity(&error))
            }
            Identity::Anonymous => Err(Refusal::new(
                "E_AUTH_REQUIRED",
                "auth",
                "authentication is required",
                "send Authorization: Bearer <token> or X-Snapback-As in dev",
                "auth/identity",
            )),
        }
    }

    pub(super) fn context(
        &self,
        authority: &ResolvedAuthority,
        op: &str,
        args: Json,
    ) -> Result<Context, Refusal> {
        let values = operation_args(self.runtime().generation(), op, &args)?;
        self.execution_context(authority, values)
    }

    pub(super) fn mutation_context(
        &mut self,
        authority: &ResolvedAuthority,
        op: &str,
        args: Json,
    ) -> Result<Context, Refusal> {
        let mut context = self.context(authority, op, args)?;
        context.new_ids = self
            .runtime_mut()
            .reserve_new_ids()
            .map_err(|error| Refusal::from_runtime(&error))?;
        Ok(context)
    }

    pub(super) fn execution_context(
        &self,
        authority: &ResolvedAuthority,
        args: BTreeMap<String, Value>,
    ) -> Result<Context, Refusal> {
        let mut context = Context::query(actor(&authority.principal)?, args);
        context.auth_epoch = authority.auth_epoch();
        let now = self.now();
        context.now = Some(now);
        context.read_time = Some(now);
        Ok(context)
    }

    pub(super) fn sweep_expired_sessions(&mut self) -> Result<(), Refusal> {
        let now = self.now();
        self.sweep_expired_sessions_at(now)
    }

    pub(super) fn sweep_expired_sessions_at(&mut self, now: i64) -> Result<(), Refusal> {
        let next = self
            .runtime()
            .next_session_expiry()
            .map_err(|error| Refusal::from_identity(&error))?;
        if !next.is_some_and(|expiry| expiry <= now) {
            return Ok(());
        }
        let expired = self
            .runtime_mut()
            .expire_sessions(now)
            .map_err(|error| Refusal::from_identity(&error))?;
        for authority in expired {
            self.fence_session(&authority);
        }
        Ok(())
    }

    pub(super) fn auth_poll_timeout(&self) -> Result<Duration, Refusal> {
        let expiry = self
            .runtime()
            .next_session_expiry()
            .map_err(|error| Refusal::from_identity(&error))?;
        let Some(expiry) = expiry else {
            return Ok(MAX_SESSION_POLL);
        };
        let remaining = expiry.saturating_sub(self.now()).max(0) as u64;
        Ok(Duration::from_millis(remaining).min(MAX_SESSION_POLL))
    }

    pub(super) fn fence_session(&mut self, authority: &SessionAuthority) {
        let seq = self.runtime().store().commit_seq().unwrap_or_default();
        let live_ids = self
            .live
            .iter()
            .filter_map(|(id, client)| {
                client
                    .session
                    .as_ref()
                    .is_some_and(|session| session.matches(authority))
                    .then_some(*id)
            })
            .collect::<Vec<_>>();
        for id in live_ids {
            if let Some(client) = self.live.remove(&id) {
                self.runtime_mut().unsubscribe(client.runtime_id);
                send_session_terminal(&client.events, seq);
            }
        }

        let channel_ids = self
            .channels
            .iter()
            .filter_map(|(id, client)| {
                client
                    .session
                    .as_ref()
                    .is_some_and(|session| session.matches(authority))
                    .then_some(*id)
            })
            .collect::<Vec<_>>();
        for id in channel_ids {
            if let Some(client) = self.channels.remove(&id) {
                send_session_terminal(&client.events, seq);
            }
        }
    }
}

fn send_session_terminal(events: &Sender<SseEvent>, seq: u64) {
    let refusal = Refusal::from_identity(&IdentityError::Session);
    let (data, terminal) = refusal_frame(refusal, seq);
    let _ = events.send(SseEvent {
        seq: Some(seq),
        data,
        terminal,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback2_core::{Auth, Ceilings, ProjectJson, Schema, Store};

    #[test]
    fn bearer_debug_never_formats_the_token() {
        let token = "secret-bearer-token";
        let rendered = format!("{:?}", Identity::Bearer(token.to_owned()));
        assert_eq!(rendered, "Bearer(<redacted>)");
        assert!(!rendered.contains(token));
    }

    #[test]
    fn auth_at_expiry_fences_the_exact_epoch_after_an_e_minus_one_sweep() {
        let auth = Auth {
            password: true,
            guests: false,
        };
        let project = ProjectJson {
            version: 1,
            schema: Schema {
                tables: BTreeMap::new(),
                maintains: Vec::new(),
                channels: BTreeMap::new(),
                auth: auth.clone(),
                effects: Vec::new(),
            },
            programs: Vec::new(),
            effects: Vec::new(),
            auth,
        };
        let generation = Generation::certify(&project, Ceilings::default()).unwrap();
        let mut runtime = Runtime::open(Store::memory().unwrap(), generation.clone()).unwrap();
        let issued_at = unix_millis();
        let first = runtime
            .signup("expiry-race@example.com", "long enough password", issued_at)
            .unwrap();
        let sibling = runtime
            .login(
                "expiry-race@example.com",
                "long enough password",
                issued_at + 60_000,
            )
            .unwrap();
        let (first_live_tx, first_live_rx) = mpsc::channel();
        let (first_channel_tx, first_channel_rx) = mpsc::channel();
        let (sibling_live_tx, _sibling_live_rx) = mpsc::channel();
        let (sibling_channel_tx, _sibling_channel_rx) = mpsc::channel();
        let session = |authority: &SessionAuthority| SessionFence {
            principal: authority.principal.id.to_string(),
            auth_epoch: authority.auth_epoch,
        };
        let first_authority = runtime
            .authenticate(&first.token, first.expires_at - 1)
            .unwrap();
        let sibling_authority = runtime
            .authenticate(&sibling.token, first.expires_at - 1)
            .unwrap();
        let mut state = State {
            runtime: Some(runtime),
            compiled: CompiledProject {
                project,
                generation,
                api_dts: String::new(),
                compiler_ms: 0.0,
            },
            seed: SeedData::default(),
            root: PathBuf::new(),
            mode: "dev".to_owned(),
            phase: json!("ready"),
            live: BTreeMap::from([
                (
                    1,
                    LiveClient {
                        runtime_id: 1,
                        op: "fixture.first".to_owned(),
                        context: Context::query(Actor::user("fixture").unwrap(), BTreeMap::new()),
                        session: Some(session(&first_authority)),
                        last_frame: json!({}),
                        events: first_live_tx,
                    },
                ),
                (
                    2,
                    LiveClient {
                        runtime_id: 2,
                        op: "fixture.sibling".to_owned(),
                        context: Context::query(Actor::user("fixture").unwrap(), BTreeMap::new()),
                        session: Some(session(&sibling_authority)),
                        last_frame: json!({}),
                        events: sibling_live_tx,
                    },
                ),
            ]),
            channels: BTreeMap::from([
                (
                    1,
                    ChannelClient {
                        name: "fixture.first".to_owned(),
                        args: BTreeMap::new(),
                        context: Context::query(Actor::user("fixture").unwrap(), BTreeMap::new()),
                        session: Some(session(&first_authority)),
                        verdict: ChannelVerdict {
                            admitted: true,
                            rule_inputs: Vec::new(),
                            points: Vec::new(),
                        },
                        events: first_channel_tx,
                    },
                ),
                (
                    2,
                    ChannelClient {
                        name: "fixture.sibling".to_owned(),
                        args: BTreeMap::new(),
                        context: Context::query(Actor::user("fixture").unwrap(), BTreeMap::new()),
                        session: Some(session(&sibling_authority)),
                        verdict: ChannelVerdict {
                            admitted: true,
                            rule_inputs: Vec::new(),
                            points: Vec::new(),
                        },
                        events: sibling_channel_tx,
                    },
                ),
            ]),
            ledger: VecDeque::new(),
            next_channel: 3,
            clock_offset_ms: 0,
            restarted_through_seq: 0,
            stop: Arc::new(AtomicBool::new(false)),
            owner: OwnerInfo {
                pid: 0,
                port: 0,
                url: String::new(),
                secret: String::new(),
                generation: String::new(),
                started_at: issued_at,
                mode: "dev".to_owned(),
                project: PathBuf::new(),
            },
            exited: false,
            effects_wake: None,
        };

        state
            .sweep_expired_sessions_at(first.expires_at - 1)
            .unwrap();
        assert_eq!(state.live.len(), 2);
        assert_eq!(state.channels.len(), 2);
        state.clock_offset_ms = first.expires_at.saturating_sub(unix_millis());
        assert!(matches!(
            state.resolve_authority(Identity::Bearer(first.token)),
            Err(ref refusal) if refusal.code == "E_AUTH_SESSION"
        ));
        assert_eq!(state.live.keys().copied().collect::<Vec<_>>(), vec![2]);
        assert_eq!(state.channels.keys().copied().collect::<Vec<_>>(), vec![2]);
        for event in [
            first_live_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            first_channel_rx
                .recv_timeout(Duration::from_secs(1))
                .unwrap(),
        ] {
            assert!(event.terminal);
            assert_eq!(event.data["code"], "E_AUTH_SESSION");
        }
        let retained = state
            .resolve_authority(Identity::Bearer(sibling.token))
            .unwrap();
        assert_eq!(retained.session.unwrap().auth_epoch, sibling.auth_epoch);
    }
}
