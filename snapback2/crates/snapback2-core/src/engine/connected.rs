use super::*;

impl Runner<'_> {
    // @ref LLP 1001#51-connected — trace an exact key, never a durable row or absence receipt.
    pub(super) fn connected_read(
        &mut self,
        read: &Read,
        key: Vec<Value>,
    ) -> Result<TrackedValue, RuntimeError> {
        if self.rule_authority == RuleAuthority::ReceiptOnly {
            self.missing_authority = true;
            self.authority_miss_serial = self.authority_miss_serial.saturating_add(1);
            return Ok(TrackedValue::plain(Value::Null));
        }
        let [Value::Id(principal)] = key.as_slice() else {
            return Err(RuntimeError::Input(
                "connected requires one principal".to_owned(),
            ));
        };
        let count = self.context.connected.get(principal).copied().unwrap_or(0);
        let value = if count == 0 {
            Value::Null
        } else {
            object([
                ("id", Value::Id(principal.clone())),
                ("principal", Value::Id(principal.clone())),
                ("value", Value::int(i128::from(count))?),
            ])
        };
        self.trace.rule_probes += 1;
        self.trace.points.push(PointTrace {
            site: read.site.clone(),
            table: read.table.clone(),
            index: read.index.clone(),
            key,
            examined: false,
            visible: count > 0,
            digest: Some(digest(&count)),
        });
        Ok(TrackedValue::plain(value))
    }
}
