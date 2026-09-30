use serde::{Deserialize, Serialize};
// @ref LLP 3000.022#14 — generated operations alone may write receipt progress.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiptFamily {
    pub members: String,
    pub group: String,
    pub delivered: String,
    pub seen: String,
}
