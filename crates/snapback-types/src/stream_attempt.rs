use serde::{Deserialize, Serialize};

/// Stable privacy identity for a streaming action. Session reconnects compare
/// the user id, service reconnects the credential id, while anonymous access
/// remains connection-bound.
///
/// @ref LLP 0204#d91--streaming-conversations — possession of a
/// room key is never stream read authority.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", content = "key", rename_all = "snake_case")]
pub enum StreamInitiator {
    SessionUser(String),
    ServiceCredential(String),
    AnonymousConnection(String),
}
