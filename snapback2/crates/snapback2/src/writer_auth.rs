//! Session authority resolution and exact-epoch stream fencing.
// @ref LLP 1002#5-the-owner — bearer streams retain and fence the exact authenticated session epoch.

use super::*;
use snapback2_core::{IdentityError, Principal, SessionAuthority};
use std::time::Duration;

const MAX_SESSION_POLL: Duration = Duration::from_secs(1);
pub(super) const ASSET_CARRIER_LIFETIME_MS: i64 = 30 * 60 * 1_000;

pub(super) fn actor(principal: &Principal) -> Result<Actor, Refusal> {
    Actor::try_from(principal).map_err(|error| {
        Refusal::new(
            "E_AUTH_RESERVED",
            "auth",
            error.to_string(),
            "authenticate as a user, guest, or development persona",
            "auth/identity",
        )
    })
}

#[derive(Clone)]
pub(super) struct ResolvedAuthority {
    pub(super) principal: Principal,
    pub(super) session: Option<SessionFence>,
    session_expires_at: Option<i64>,
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
            session_expires_at: Some(authority.expires_at),
        }
    }

    fn persona(principal: Principal) -> Self {
        Self {
            principal,
            session: None,
            session_expires_at: None,
        }
    }

    pub(super) fn auth_epoch(&self) -> u64 {
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

#[derive(Clone)]
pub(super) struct AssetCarrier {
    authority: ResolvedAuthority,
    expires_at: i64,
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
                let authority = self
                    .runtime()
                    .authenticate(&token, now)
                    .map_err(|error| Refusal::from_identity(&error))?;
                if authority.principal.kind == "persona"
                    && let Err(refusal) = self.require_dev_personas()
                {
                    // @ref LLP 1002#1-decisions — personas never reach production, including through persisted bearer sessions.
                    // A persisted development persona must never cross the
                    // serve boundary through the otherwise-valid bearer lane.
                    // Revoke the exact epoch as it is refused so the token
                    // cannot be retried against this or a later owner.
                    let revoked = self
                        .runtime_mut()
                        .logout(&token, now)
                        .map_err(|error| Refusal::from_identity(&error))?;
                    self.fence_session(&revoked);
                    return Err(refusal);
                }
                Ok(ResolvedAuthority::from_session(authority))
            }
            Identity::Persona(name) => {
                self.require_dev_personas()?;
                let now = self.now();
                self.runtime_mut()
                    .ensure_persona(&name, now)
                    .map(ResolvedAuthority::persona)
                    .map_err(|error| Refusal::from_identity(&error))
            }
            Identity::Carrier(_) => Err(Refusal::new(
                "E_AUTH_AMBIGUOUS",
                "auth",
                "an asset session carrier is valid only on the asset delivery route",
                "send the carrier as ?s= on GET /api/asset/<id>",
                "auth/asset-session",
            )),
            Identity::Operator { .. } => Err(Refusal::operator_required()),
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

    /// Age out replay grants and intents past thirty days. Runs after every
    /// commit and on each development clock advance, not on every request:
    /// a replay under an expired grant is refused by its own timestamps.
    // @ref LLP 1012#7-writes-offline — the ledger is swept after thirty days by the same sweep that ages grants.
    pub(super) fn sweep_offline_now(&mut self) -> Result<(), Refusal> {
        let now = self.now();
        self.runtime()
            .sweep_offline(now)
            .map_err(|error| Refusal::from_runtime(&error))
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
        self.asset_carriers.retain(|_, carrier| {
            !carrier
                .authority
                .session
                .as_ref()
                .is_some_and(|session| session.matches(authority))
        });
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

    // @ref LLP 1006#2b-the-session-carrier-author-ruling-2026-09-03 — the
    // opaque in-memory carrier reproduces the exact persona or bearer authority,
    // expires within thirty minutes, and never outlives its bearer epoch.
    pub(super) fn mint_asset_carrier(&mut self, identity: Identity) -> Result<Json, Refusal> {
        let authority = self.resolve_authority(identity)?;
        let now = self.now();
        let expires_at = authority
            .session_expires_at
            .unwrap_or(i64::MAX)
            .min(now.saturating_add(ASSET_CARRIER_LIFETIME_MS));
        let token = random_carrier()?;
        self.asset_carriers.insert(
            token.clone(),
            AssetCarrier {
                authority,
                expires_at,
            },
        );
        Ok(json!({ "token": token, "expiresAt": expires_at }))
    }

    pub(super) fn resolve_asset_carrier(
        &mut self,
        token: &str,
    ) -> Result<Option<ResolvedAuthority>, Refusal> {
        let now = self.now();
        self.sweep_expired_sessions_at(now)?;
        self.asset_carriers
            .retain(|_, carrier| carrier.expires_at > now);
        Ok(self
            .asset_carriers
            .get(token)
            .map(|carrier| carrier.authority.clone()))
    }
}

fn random_carrier() -> Result<String, Refusal> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| {
        Refusal::new(
            "E_ASSET_NOT_READY",
            "input",
            format!("cannot mint an asset session carrier: {error}"),
            "retry after restoring operating-system randomness",
            "auth/asset-session",
        )
    })?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    Ok(bytes
        .iter()
        .flat_map(|byte| {
            [
                HEX[usize::from(byte >> 4)] as char,
                HEX[usize::from(byte & 0x0f)] as char,
            ]
        })
        .collect())
}

fn send_session_terminal(events: &SseSender, seq: u64) {
    let refusal = Refusal::from_identity(&IdentityError::Session);
    let (data, terminal) = refusal_frame(refusal, seq);
    // A session fence is terminal authority state, so it replaces any queued
    // live frame instead of being dropped when the bounded slot is occupied.
    let _ = events.send_latest(SseEvent {
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
                schedules: Vec::new(),
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
        let (first_live_tx, first_live_rx) = sse_queue();
        let (first_channel_tx, first_channel_rx) = sse_queue();
        let (sibling_live_tx, _sibling_live_rx) = sse_queue();
        let (sibling_channel_tx, _sibling_channel_rx) = sse_queue();
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
        let asset_root = std::env::temp_dir().join(format!(
            "snapback2-writer-auth-{}-{}",
            std::process::id(),
            issued_at
        ));
        std::fs::create_dir_all(asset_root.join(".snapback")).unwrap();
        let blobs: Arc<dyn crate::blob_store::BlobStore> =
            Arc::new(crate::blob_store::FileBlobStore::open(&asset_root).unwrap());
        let staging = Arc::new(crate::blob_store::LocalStaging::open(&asset_root).unwrap());
        let mut state = State {
            runtime: Some(runtime),
            compiled: CompiledProject {
                project,
                generation,
                api_dts: String::new(),
                compiler_ms: 0.0,
                quarry: Vec::new(),
            },
            seed: SeedData::default(),
            root: asset_root.clone(),
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
                        offline: false,
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
                        offline: false,
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
            operator_rejection: None,
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
            asset_carriers: BTreeMap::new(),
            blobs,
            staging,
            pending_asset_deletes: BTreeSet::new(),
            next_asset_sweep: Instant::now() + ASSET_SWEEP_INTERVAL,
        };

        for events in [
            &state.live.get(&1).unwrap().events,
            &state.channels.get(&1).unwrap().events,
        ] {
            assert!(
                events
                    .send_latest(SseEvent {
                        seq: Some(0),
                        data: json!({ "state": "complete" }),
                        terminal: false,
                    })
                    .is_ok()
            );
        }

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
        std::fs::remove_dir_all(asset_root).unwrap();
    }
}
