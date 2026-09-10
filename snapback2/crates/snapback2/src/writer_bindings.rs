//! Provider bindings of a `test` owner: a journey's loopback stand-in for the
//! third party its effect names. Bindings belong to one journey epoch, which
//! the supervisor opens before the journey runs and closes after it ends —
//! whatever the journey did — so revocation never waits on journey cleanup.
// @ref LLP 1021#3-a-provider-stand-in-and-nothing-else-answers — journeys only; the supervisor owns the lifetime; no fallback anywhere in the test owner.

use super::*;

/// The registry a test owner carries. A dev or serve owner has none, and its
/// rows claim with no binding table: production transport.
#[derive(Default)]
pub(super) struct Bindings {
    epoch: Option<Epoch>,
}

struct Epoch {
    id: String,
    /// The commit seq when the epoch opened. Rows emitted after it are the
    /// journey's; every earlier row — a derived check's, an earlier journey's
    /// leftover, a retry of either — claims an empty table.
    since: u64,
    origins: BTreeMap<String, String>,
}

impl State {
    fn bindings_mut(&mut self) -> Result<&mut Bindings, Refusal> {
        self.outbox_dev()?;
        self.effect_bindings.as_mut().ok_or_else(journeys_only)
    }

    fn commit_seq(&self) -> Result<u64, Refusal> {
        self.runtime()
            .store()
            .commit_seq()
            .map_err(|error| Refusal::from_runtime(&error))
    }

    /// Open (`Some`) or close (`None`) the live journey epoch. Opening drops
    /// the previous epoch's bindings; closing revokes them. The reply carries
    /// the commit seq at the boundary: `since` on open, `until` on close.
    pub(super) fn effects_epoch(&mut self, epoch: Option<String>) -> Result<Json, Refusal> {
        let seq = self.commit_seq()?;
        let bindings = self.bindings_mut()?;
        match epoch {
            Some(id) => {
                if id.is_empty() || id.len() > 200 {
                    return Err(Refusal::input(
                        "epoch must be 1 to 200 characters",
                        "pass the supervisor's epoch token",
                    ));
                }
                bindings.epoch = Some(Epoch {
                    id: id.clone(),
                    since: seq,
                    origins: BTreeMap::new(),
                });
                Ok(json!({ "epoch": id, "since": seq }))
            }
            None => {
                let closed = bindings.epoch.take();
                Ok(json!({ "epoch": closed.map(|epoch| epoch.id), "until": seq }))
            }
        }
    }

    /// Register `origin → to` in the live epoch, which must be `epoch`: a
    /// runner that outlived its supervision cannot bind into a later journey.
    pub(super) fn bind_effect(
        &mut self,
        origin: &str,
        to: &str,
        epoch: &str,
    ) -> Result<Json, Refusal> {
        let origin = logical_origin(origin)?;
        let to = loopback_origin(to)?;
        let bindings = self.bindings_mut()?;
        let live = bindings
            .epoch
            .as_mut()
            .filter(|live| live.id == epoch)
            .ok_or_else(|| {
                Refusal::input(
                    format!("epoch {epoch:?} is not the live journey epoch"),
                    "bind from the journey the supervisor is running: effects.provider(origin, handler)",
                )
            })?;
        live.origins.insert(origin.clone(), to.clone());
        Ok(json!({ "origin": origin, "to": to, "epoch": epoch }))
    }

    /// The binding table a claimed row may use: `None` outside a test owner
    /// (production transport); otherwise the live epoch's table when the row
    /// was emitted inside it, and an empty table for every other row.
    pub(super) fn claim_bindings(&self, seq: u64) -> Option<Json> {
        let bindings = self.effect_bindings.as_ref()?;
        let origins = bindings
            .epoch
            .as_ref()
            .filter(|epoch| seq > epoch.since)
            .map(|epoch| epoch.origins.clone())
            .unwrap_or_default();
        Some(json!(origins))
    }
}

fn journeys_only() -> Refusal {
    Refusal::input(
        "provider bindings belong to a snapback2 test journey epoch; this owner serves dev",
        "declare effects.provider(origin, handler) in a journey and run snapback2 test",
    )
}

/// `scheme://host[:port]` for http or https — lowercased, the scheme's default
/// port elided, nothing after the authority: the origin `fetch` computes and
/// the grant compares.
pub(crate) fn logical_origin(text: &str) -> Result<String, Refusal> {
    let invalid = || {
        Refusal::input(
            format!("{text:?} is not an http(s) origin"),
            "pass scheme://host[:port] with no path, such as https://api.example.com",
        )
    };
    let (scheme, authority) = text.split_once("://").ok_or_else(invalid)?;
    let scheme = scheme.to_ascii_lowercase();
    let default_port = match scheme.as_str() {
        "http" => 80,
        "https" => 443,
        _ => return Err(invalid()),
    };
    if authority.is_empty()
        || authority.contains(['/', '?', '#', '@', ' ', '\\'])
        || authority.ends_with(':')
    {
        return Err(invalid());
    }
    let (host, port) = if let Some(rest) = authority.strip_prefix('[') {
        let (host, tail) = rest.split_once(']').ok_or_else(invalid)?;
        let port = match tail.strip_prefix(':') {
            Some(port) => Some(port),
            None if tail.is_empty() => None,
            None => return Err(invalid()),
        };
        (format!("[{host}]"), port)
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) if !host.contains(':') => (host.to_owned(), Some(port)),
            Some(_) => return Err(invalid()),
            None => (authority.to_owned(), None),
        }
    };
    if host.len() <= 2 && host.starts_with('[') || host.is_empty() {
        return Err(invalid());
    }
    let port = port
        .map(|port| port.parse::<u16>().map_err(|_| invalid()))
        .transpose()?;
    let host = host.to_ascii_lowercase();
    Ok(match port {
        Some(port) if port != default_port => format!("{scheme}://{host}:{port}"),
        _ => format!("{scheme}://{host}"),
    })
}

/// The journey's stand-in listens on the loopback, over plain HTTP: the one
/// place a test owner's transport may reach.
fn loopback_origin(text: &str) -> Result<String, Refusal> {
    let origin = logical_origin(text)?;
    if origin == "http://127.0.0.1" || origin.starts_with("http://127.0.0.1:") {
        Ok(origin)
    } else {
        Err(Refusal::input(
            format!("{text:?} is not a loopback http origin"),
            "bind to http://127.0.0.1:<port>, the journey's own provider server",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_owner_state(label: &str) -> State {
        let mut state = super::super::writer_live_tests::state(label);
        state.effect_bindings = Some(Bindings::default());
        state
    }

    #[test]
    fn origins_normalize_like_the_grant_and_refuse_paths() {
        for (text, expected) in [
            ("https://api.example.com", "https://api.example.com"),
            ("HTTPS://API.Example.com:443", "https://api.example.com"),
            ("http://127.0.0.1:80", "http://127.0.0.1"),
            ("http://127.0.0.1:49152", "http://127.0.0.1:49152"),
            (
                "https://api.example.com:8443",
                "https://api.example.com:8443",
            ),
            ("http://[::1]:3000", "http://[::1]:3000"),
        ] {
            assert_eq!(logical_origin(text).unwrap(), expected, "{text}");
        }
        for text in [
            "api.example.com",
            "https://api.example.com/",
            "https://api.example.com/send",
            "https://api.example.com?x",
            "ftp://api.example.com",
            "https://",
            "https://api.example.com:",
            "https://api.example.com:notaport",
            "https://user@api.example.com",
            "http://[::1",
        ] {
            let refusal = logical_origin(text).unwrap_err();
            assert_eq!(refusal.code, "E_INPUT", "{text}");
            assert!(
                refusal.message.contains("origin"),
                "{text}: {}",
                refusal.message
            );
        }
        assert_eq!(
            loopback_origin("http://127.0.0.1:5000").unwrap(),
            "http://127.0.0.1:5000"
        );
        for text in [
            "https://127.0.0.1:5000",
            "http://localhost:5000",
            "http://10.0.0.1:5000",
        ] {
            assert!(loopback_origin(text).is_err(), "{text}");
        }
    }

    #[test]
    fn a_dev_owner_has_no_binding_route_and_claims_with_no_table() {
        let mut state = super::super::writer_live_tests::state("bindings-dev");
        let refusal = state
            .handle(Action::EffectsEpoch {
                epoch: Some("j1".into()),
            })
            .unwrap_err();
        assert_eq!(refusal.code, "E_INPUT");
        assert!(
            refusal.message.contains("journey epoch"),
            "{}",
            refusal.message
        );
        assert!(
            refusal
                .rewrite
                .as_deref()
                .unwrap()
                .contains("effects.provider")
        );
        let refusal = state
            .handle(Action::EffectsBind {
                origin: "https://api.example.com".into(),
                to: "http://127.0.0.1:4000".into(),
                epoch: "j1".into(),
            })
            .unwrap_err();
        assert_eq!(refusal.code, "E_INPUT");
        assert_eq!(state.claim_bindings(1), None);
        std::fs::remove_dir_all(&state.root).unwrap();
    }

    #[test]
    fn bindings_belong_to_the_live_epoch_and_rows_emitted_before_it_claim_an_empty_table() {
        let mut state = test_owner_state("bindings-epochs");
        // Before any epoch: every row claims an empty table, never production.
        assert_eq!(state.claim_bindings(1), Some(json!({})));
        let stale = state
            .handle(Action::EffectsBind {
                origin: "https://api.example.com".into(),
                to: "http://127.0.0.1:4000".into(),
                epoch: "j1".into(),
            })
            .unwrap_err();
        assert!(
            stale.message.contains("not the live journey epoch"),
            "{}",
            stale.message
        );

        let opened = state
            .handle(Action::EffectsEpoch {
                epoch: Some("j1".into()),
            })
            .unwrap();
        assert_eq!(opened["epoch"], "j1");
        let since = opened["since"].as_u64().unwrap();
        let bound = state
            .handle(Action::EffectsBind {
                origin: "HTTPS://API.example.com:443".into(),
                to: "http://127.0.0.1:4000".into(),
                epoch: "j1".into(),
            })
            .unwrap();
        assert_eq!(
            bound,
            json!({ "origin": "https://api.example.com", "to": "http://127.0.0.1:4000", "epoch": "j1" })
        );
        // Another epoch's runner cannot bind into the live one.
        assert!(
            state
                .handle(Action::EffectsBind {
                    origin: "https://other.example.com".into(),
                    to: "http://127.0.0.1:4001".into(),
                    epoch: "j0".into(),
                })
                .is_err()
        );
        // A row at the opening seq is not the journey's; one after it is.
        assert_eq!(state.claim_bindings(since), Some(json!({})));
        assert_eq!(
            state.claim_bindings(since + 1),
            Some(json!({ "https://api.example.com": "http://127.0.0.1:4000" }))
        );
        for (to, reason) in [
            ("https://127.0.0.1:4000", "loopback http"),
            ("http://localhost:4000", "loopback http"),
            ("http://127.0.0.1:4000/path", "origin"),
        ] {
            let refusal = state
                .handle(Action::EffectsBind {
                    origin: "https://api.example.com".into(),
                    to: to.into(),
                    epoch: "j1".into(),
                })
                .unwrap_err();
            assert!(
                refusal.message.contains(reason),
                "{to}: {}",
                refusal.message
            );
        }

        // Closing revokes; a second epoch starts empty, and rows from before
        // it — the first journey's, retried later — claim nothing.
        let closed = state.handle(Action::EffectsEpoch { epoch: None }).unwrap();
        assert_eq!(closed, json!({ "epoch": "j1", "until": since }));
        assert_eq!(state.claim_bindings(since + 1), Some(json!({})));
        state
            .handle(Action::EffectsEpoch {
                epoch: Some("j2".into()),
            })
            .unwrap();
        assert_eq!(state.claim_bindings(since + 1), Some(json!({})));
        state
            .handle(Action::EffectsBind {
                origin: "https://api.example.com".into(),
                to: "http://127.0.0.1:4002".into(),
                epoch: "j2".into(),
            })
            .unwrap();
        assert_eq!(
            state.claim_bindings(since + 1),
            Some(json!({ "https://api.example.com": "http://127.0.0.1:4002" }))
        );
        let closed_again = state.handle(Action::EffectsEpoch { epoch: None }).unwrap();
        assert_eq!(closed_again["epoch"], "j2");
        assert_eq!(
            state.handle(Action::EffectsEpoch { epoch: None }).unwrap()["epoch"],
            Json::Null
        );
        std::fs::remove_dir_all(&state.root).unwrap();
    }
}
