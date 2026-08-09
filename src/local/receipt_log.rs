use super::*;

/// Receipt retention (LLP 0034 §3 / ENG-22478): bounded in-memory rings — one
/// global ring for connectionless facts (mutation receipts, disposed-on-
/// disconnect markers) and one ring per live connection (subscription
/// lifecycle). Dropped with the connection; never durable.
///
/// Privacy (§3.3): receipts carry opaque ids, versions, table names, and the
/// verbatim adapter correlation object — never ephemeral payload values and
/// never auth identities beyond what the adapter itself chose to put in its
/// opaque correlation.
const RECEIPT_RING_CAP: usize = 256;

#[derive(Default)]
pub(super) struct ReceiptLog {
    global: VecDeque<Value>,
    per_connection: BTreeMap<String, VecDeque<Value>>,
}

impl ReceiptLog {
    pub(super) fn push_global(&mut self, receipt: Value) {
        push_capped(&mut self.global, receipt);
    }

    pub(super) fn push_connection(&mut self, connection_id: &str, receipt: Value) {
        push_capped(
            self.per_connection
                .entry(connection_id.to_owned())
                .or_default(),
            receipt,
        );
    }

    pub(super) fn drop_connection(&mut self, connection_id: &str) {
        self.per_connection.remove(connection_id);
    }

    pub(super) fn snapshot(&self, connection_id: Option<&str>) -> Value {
        match connection_id {
            Some(id) => json!({
                "connection": id,
                "receipts": self
                    .per_connection
                    .get(id)
                    .map(|ring| ring.iter().cloned().collect::<Vec<_>>())
                    .unwrap_or_default(),
            }),
            None => json!({
                "global": self.global.iter().cloned().collect::<Vec<_>>(),
                "connections": self
                    .per_connection
                    .iter()
                    .map(|(id, ring)| (id.clone(), Value::Array(ring.iter().cloned().collect())))
                    .collect::<serde_json::Map<_, _>>(),
            }),
        }
    }
}

fn push_capped(ring: &mut VecDeque<Value>, receipt: Value) {
    ring.push_back(receipt);
    while ring.len() > RECEIPT_RING_CAP {
        ring.pop_front();
    }
}
