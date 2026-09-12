use serde::{Deserialize, Serialize};
use std::borrow::Borrow;
use std::fmt;

/// A nominal authority subject carried by trusted host code.
///
/// `PrincipalId` is a value type, not authentication evidence. Its public
/// constructors support the embedded core API and tests; a served request
/// must create it only after the identity/session boundary has verified the
/// caller. Application arguments and row ids never authenticate a viewer.
// @ref LLP 1001#6-identity-identityrs — Acting principals are nominal, not application row IDs or caller claims.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PrincipalId(String);

impl PrincipalId {
    /// Constructs a principal in a trusted host/test boundary.
    ///
    /// Do not use an unverified request value as the acting principal.
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn system() -> Self {
        Self("system".to_owned())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }

    pub fn is_system(&self) -> bool {
        self.0 == "system"
    }
}

impl From<String> for PrincipalId {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

impl From<&str> for PrincipalId {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl From<PrincipalId> for String {
    fn from(value: PrincipalId) -> Self {
        value.into_inner()
    }
}

impl AsRef<str> for PrincipalId {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl Borrow<str> for PrincipalId {
    fn borrow(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for PrincipalId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}
